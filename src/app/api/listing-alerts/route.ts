import { NextRequest, NextResponse } from 'next/server';
import { createLeadFollowUpTask } from '@/lib/lead-followup';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { recordIntegrationFailure, recordIntegrationSuccess, LEAD_NOTIFY_KEY } from '@/lib/integration-alert';
import { rateLimit } from '@/lib/ratelimit';
import { verifyRecaptcha, RECAPTCHA_REJECTED } from '@/lib/recaptcha';
import { screenSubmission } from '@/lib/bot-guard';
import { contactAllowed } from '@/lib/public-form-guard';
import { buildLeadContext } from '@/lib/lead-context';
import crypto from 'crypto';
import { chicagoToday } from '@/lib/chicago-time';

const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@crecotx.com';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, 'listing-alerts');
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests — please wait a few minutes.' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    // Honeypot, mandatory fill time, gibberish name (lib/bot-guard.ts). Looks
    // successful to the bot; nothing is stored.
    if (screenSubmission(body, { route: 'listing-alerts', browserForm: true, names: [body.name], email: body.email })) {
      return NextResponse.json({ ok: true });
    }

    // Per-address budget across all public forms: someone can't use this form to mail-bomb one victim from many IPs.
    if (!(await contactAllowed(body.email, null))) {
      return NextResponse.json({ error: 'Too many requests — please wait a while and try again.' }, { status: 429 });
    }

    // reCAPTCHA v3 — a no-op until RECAPTCHA_SECRET_KEY is set (see lib/recaptcha.ts).
    const captcha = await verifyRecaptcha(
      body.recaptchaToken,
      'listing_alerts',
      req.headers.get('x-forwarded-for')?.split(',')[0].trim(),
    );
    if (!captcha.ok) {
      console.warn('[listing_alerts] reCAPTCHA rejected', captcha.reason, captcha.score);
      return NextResponse.json(RECAPTCHA_REJECTED, { status: 403 });
    }
    const { name, email, cities, min_price, max_price, min_beds, min_baths, search } = body;

    // Email is the only thing an alert needs. Requiring a name cost signups on
    // the footer capture, where someone is one field away from subscribing.
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (typeof email !== 'string' || email.length > 254) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (typeof name === 'string' && name.length > 200) {
      return NextResponse.json({ error: 'Name too long' }, { status: 400 });
    }
    if (min_price !== undefined && (typeof min_price !== 'number' || min_price < 0)) {
      return NextResponse.json({ error: 'Invalid min_price' }, { status: 400 });
    }
    if (max_price !== undefined && (typeof max_price !== 'number' || max_price < 0)) {
      return NextResponse.json({ error: 'Invalid max_price' }, { status: 400 });
    }
    if (min_beds !== undefined && (typeof min_beds !== 'number' || min_beds < 0)) {
      return NextResponse.json({ error: 'Invalid min_beds' }, { status: 400 });
    }
    if (min_baths !== undefined && (typeof min_baths !== 'number' || min_baths < 0)) {
      return NextResponse.json({ error: 'Invalid min_baths' }, { status: 400 });
    }
    if (search !== undefined && search !== null && typeof search !== 'string') {
      return NextResponse.json({ error: 'Invalid search' }, { status: 400 });
    }

    const safeCities: string[] = Array.isArray(cities) ? cities.slice(0, 20).map(String).filter(c => c.length <= 100) : [];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;   // service role only — the publishable key would fail silently under RLS
    const supabase = createClient(supabaseUrl, serviceKey);

    const safeSearch = typeof search === 'string' ? search.slice(0, 200).trim() : null;

    // Double opt-in. The address is NOT subscribed until its owner clicks the link we mail them: anyone could otherwise
    // type a victim's address here and have the brand mail them daily. One row per address (unique index), and a
    // confirmed subscription is never changed by an anonymous form post.
    const alertEmail = email.toLowerCase().trim();
    const criteriaRow = {
      name: typeof name === 'string' ? name.trim() : '',
      cities: safeCities,
      min_price: min_price ?? null,
      max_price: max_price ?? null,
      min_beds: min_beds ?? null,
      min_baths: min_baths ?? null,
      search: safeSearch || null,
    };
    let confirmToken: string | null = null;   // set when a confirmation email should go out
    let isNewAlert = false;
    const { data: prior, error: priorErr } = await supabase.from('listing_alerts').select('id, confirmed_at, confirm_token').eq('email', alertEmail).maybeSingle();
    if (priorErr && (priorErr as { code?: string }).code === '42703') {
      // Migration 20261024_security_audit_2026_10.sql not applied yet: behave exactly as before rather than break sign-ups.
      const { error: legacyErr } = await supabase.from('listing_alerts').insert([{ ...criteriaRow, email: alertEmail }]);
      if (legacyErr) { console.error('listing_alerts insert error:', legacyErr.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); }
      isNewAlert = true;
    } else if (priorErr) {
      console.error('listing_alerts lookup error:', priorErr.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } else if (!prior) {
      const { data: ins, error: dbErr } = await supabase.from('listing_alerts').insert([{ ...criteriaRow, email: alertEmail }]).select('confirm_token').single();
      if (dbErr || !ins) {
        console.error('listing_alerts insert error:', dbErr?.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
      confirmToken = ins.confirm_token as string; isNewAlert = true;
    } else if (!prior.confirmed_at) {
      await supabase.from('listing_alerts').update(criteriaRow).eq('id', prior.id);   // still waiting for the click
      confirmToken = prior.confirm_token as string;
    }
    // else: already a confirmed subscriber — leave it alone (same response, nothing sent).

    // ── Also register the signup as a CRM lead ───────────────────────────────
    // Someone asking to be told about new homes matching a price, bed count and
    // set of cities is a self-qualified buyer. Until now that person became a
    // row in listing_alerts and nothing else: no CRM contact, no attribution,
    // invisible to the Lead Attribution dashboard and to any follow-up.
    //
    // This is purely additive — the alert row above is written first and is
    // untouched, and every failure here is swallowed so a CRM problem can never
    // cost someone their alert subscription or return them an error.
    try {
      const attr = buildLeadContext(req, { ...(body as Record<string, unknown>), surface: 'listing-alerts' });
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: adminProfile } = await admin
        .from('crm_profiles').select('id').in('role', ['admin', 'super_admin'])
          // The broker (super_admin) first — .limit(1) alone returned whichever admin came back first.
          .order('role', { ascending: false }).limit(1).maybeSingle();
      const adminId = adminProfile?.id;
      const cleanEmail = email.toLowerCase().trim();

      if (adminId) {
        const { data: existing } = await admin
          .from('crm_clients').select('id').ilike('email', cleanEmail).maybeSingle();

        // The criteria are the most useful thing about this lead — what they
        // want and where — so they go in the notes rather than being dropped.
        const criteria = [
          safeCities.length && safeCities[0] !== 'All Areas' ? `Areas: ${safeCities.join(', ')}` : 'Areas: all',
          safeSearch ? `Search: "${safeSearch}"` : '',
          min_price ? `Min price: $${Number(min_price).toLocaleString()}` : '',
          max_price ? `Max price: $${Number(max_price).toLocaleString()}` : '',
          min_beds ? `Min beds: ${min_beds}` : '',
          min_baths ? `Min baths: ${min_baths}` : '',
        ].filter(Boolean);

        if (existing?.id) {
          // Already a contact — append the criteria rather than creating a twin.
          const { data: prior } = await admin.from('crm_clients').select('notes').eq('id', existing.id).maybeSingle();
          const appended = [String(prior?.notes ?? '').trim(), `🔔 Listing alert signup — ${chicagoToday()}`, ...criteria]
            .filter(Boolean).join('\n');
          await admin.from('crm_clients').update({ notes: appended }).eq('id', existing.id);
          console.log(`[listing_alerts] existing contact ${existing.id} updated with alert criteria`);
        } else {
          const rawName = typeof name === 'string' ? name.trim() : '';
          // Footer signup asks for email only, so derive something usable rather
          // than filing a nameless contact.
          const display = rawName || cleanEmail.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
          const parts = display.split(/\s+/);

          const { data: created, error: crmErr } = await admin.from('crm_clients').insert([{
            first_name: parts[0] ?? display,
            last_name: parts.slice(1).join(' '),
            email: cleanEmail,
            phone: '',
            type: 'Buyer',
            notes: ['🔔 Listing alert signup — fairoaksrealtygroup.com', ...criteria].join('\n'),
            agent_id: adminId,
            assigned_agent_ids: [],
            lead_source: 'Listing alerts — fairoaksrealtygroup.com',
            prospect_status: 'new',
            business_unit: 'residential',
            tags: ['New Lead', 'Website Lead', 'Listing Alerts'],
            unsubscribe_token: crypto.randomUUID(),
            utm_source: attr.utm_source, utm_medium: attr.utm_medium, utm_campaign: attr.utm_campaign,
            utm_term: attr.utm_term, utm_content: attr.utm_content,
            referrer: attr.referrer, landing_page: attr.landing_page,
            page_path: attr.page_path, page_title: attr.page_title,
            surface: attr.surface, geo: attr.geo, device: attr.device,
            channel: attr.channel,
            lead_site: 'fairoaksrealtygroup.com',
          }]).select('id').single();

          if (crmErr) {
            console.error('[listing_alerts] crm_clients insert error:', JSON.stringify(crmErr));
          } else {
            console.log(`[listing_alerts] CRM lead created: ${cleanEmail}`);
            await createLeadFollowUpTask(admin, {
              clientId: created?.id ?? '',
              name: display, email: cleanEmail,
              channel: attr.channel, leadSite: 'fairoaksrealtygroup.com',
              campaign: attr.utm_campaign, source: 'Listing alerts',
              businessUnit: 'residential',
              detail: criteria.join('\n'),
            });
            // Surfaces it in the Prospects tab straight away, same as web leads.
            await admin.from('email_lead_imports').insert([{
              gmail_message_id:    `listing-alerts-${crypto.randomUUID()}`,
              gmail_connection_id: null,
              source:              'Website',
              business_unit:       'residential',
              client_id:           created?.id ?? null,
              raw_subject:         `Listing alert signup: ${display}`,
              parsed_name:         display,
              parsed_email:        cleanEmail,
              parsed_message:      criteria.join(' · '),
              channel:             attr.channel,
              lead_site:           'fairoaksrealtygroup.com',
            }]);
          }
        }
      }
    } catch (e) {
      // Never fail the subscription because the CRM side had a problem.
      console.error('[listing_alerts] CRM forward failed (alert itself is unaffected):', e);
    }

    // Send confirmation email
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const filterParts = [
        safeCities.length > 0 && safeCities[0] !== 'All Areas' ? safeCities.join(', ') : 'All Areas',
        safeSearch ? `"${safeSearch}"` : null,
        min_price ? `$${(min_price / 1000).toFixed(0)}k+` : null,
        max_price ? `up to $${(max_price / 1000).toFixed(0)}k` : null,
        min_beds ? `${min_beds}+ beds` : null,
        min_baths ? `${min_baths}+ baths` : null,
      ].filter(Boolean).join(' · ');

      if (confirmToken) {
        const confirmUrl = `https://www.fairoaksrealtygroup.com/api/listing-alerts/manage?action=confirm&token=${encodeURIComponent(confirmToken)}`;
        await resend.emails.send({
          from: `Fair Oaks Realty Group <${FROM_EMAIL}>`,
          to: alertEmail,
          subject: 'Please confirm your listing alert',
          html: `
          <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a2e;">
            <div style="margin-bottom: 32px; border-bottom: 2px solid #c9a84c; padding-bottom: 24px;">
              <p style="font-size: 22px; font-weight: bold; margin: 0;">Fair Oaks <span style="color: #c9a84c;">Realty Group</span></p>
            </div>
            <h1 style="font-size: 22px; font-weight: bold; margin: 0 0 8px;">One more step${name?.trim() ? `, ${esc(name.trim())}` : ''}</h1>
            <p style="color: #666; margin: 0 0 24px;">Someone asked us to email new listings matching this search to this address. Please confirm it was you:</p>
            <div style="background: #f8f5ee; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; font-weight: 600;">
              ${esc(filterParts)}
            </div>
            <a href="${confirmUrl}" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; border-radius: 8px; padding: 12px 24px; font-weight: bold;">Yes, send me new listings</a>
            <p style="color: #666; font-size: 14px; margin: 24px 0 0;">
              If this wasn&rsquo;t you, ignore this email &mdash; you won&rsquo;t receive anything.
            </p>
            <p style="margin-top: 40px; font-size: 13px; color: #999;">
              Fair Oaks Realty Group &middot; 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015<br />
              <a href="tel:+12103909997" style="color: #c9a84c;">210-390-9997</a>
            </p>
          </div>`,
        }).catch(e => console.error('Resend confirmation error:', e));
      }

      // Internal notification: a listing-alert signup is a lead, and nobody was
      // told about it — the subscriber got a confirmation and that was that.
      if (isNewAlert) await resend.emails.send({
        from: `Fair Oaks Realty Group <${FROM_EMAIL}>`,
        to: NOTIFICATION_EMAIL,
        replyTo: email,
        subject: `🔔 New listing alert signup: ${email}`,
        html: `
          <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; color:#1a1a2e">
            <h2 style="margin:0 0 12px;font-size:18px">New listing-alert signup</h2>
            <table style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 12px 6px 0;color:#666">Name</td><td>${esc(name?.trim() || '—')}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#666">Search</td><td>${esc(filterParts)}</td></tr>
            </table>
            <p style="font-size:13px;color:#666;margin-top:16px">Reply to this email to reach them directly.</p>
          </div>`,
      }).catch(e => console.error('Resend internal notification error:', e));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('listing-alerts POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
