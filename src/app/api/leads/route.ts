import { NextRequest, NextResponse } from 'next/server';
import { createLeadFollowUpTask } from '@/lib/lead-followup';
import { fairOaksEmail } from '@/lib/fair-oaks-email';
import { maybeAutoEnrollLead } from '@/lib/lead-autoenroll';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendMonitored, recordIntegrationFailure, recordIntegrationSuccess, LEAD_NOTIFY_KEY, LEAD_WRITE_KEY } from '@/lib/integration-alert';
import { rateLimit } from '@/lib/ratelimit';
import { verifyRecaptcha, RECAPTCHA_REJECTED } from '@/lib/recaptcha';
import { screenSubmission } from '@/lib/bot-guard';
import { buildLeadContext } from '@/lib/lead-context';

const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@crecotx.com';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, 'leads');
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests — please wait a few minutes and try again.' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    // Honeypot, mandatory fill time, gibberish name (lib/bot-guard.ts). A blocked
    // bot gets the same 200 a real lead does, so it has nothing to adapt to, and
    // nothing is stored.
    if (screenSubmission(body, { route: 'leads', browserForm: true, names: [body.name], email: body.email })) {
      return NextResponse.json({ success: true, message: 'Lead received' });
    }

    // reCAPTCHA v3 — a no-op until RECAPTCHA_SECRET_KEY is set (see lib/recaptcha.ts).
    const captcha = await verifyRecaptcha(
      body.recaptchaToken,
      'lead_form',
      req.headers.get('x-forwarded-for')?.split(',')[0].trim(),
    );
    if (!captcha.ok) {
      console.warn('[lead_form] reCAPTCHA rejected', captcha.reason, captcha.score);
      return NextResponse.json(RECAPTCHA_REJECTED, { status: 403 });
    }
    const { name, email, phone, message, property_interest, source, business_unit } = body;

    // Name is required; email OR phone must be provided for contact
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!email && !phone) {
      return NextResponse.json({ error: 'Email or phone is required' }, { status: 400 });
    }

    const unit: 'residential' | 'commercial' = business_unit === 'commercial' ? 'commercial' : 'residential';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    if (typeof name === 'string' && name.length > 200) {
      return NextResponse.json({ error: 'Name must be 200 characters or fewer' }, { status: 400 });
    }
    if (typeof phone === 'string' && phone.length > 30) {
      return NextResponse.json({ error: 'Phone must be 30 characters or fewer' }, { status: 400 });
    }
    if (typeof message === 'string' && message.length > 5000) {
      return NextResponse.json({ error: 'Message must be 5000 characters or fewer' }, { status: 400 });
    }
    if (typeof property_interest === 'string' && property_interest.length > 500) {
      return NextResponse.json({ error: 'Property interest must be 500 characters or fewer' }, { status: 400 });
    }
    if (typeof source === 'string' && source.length > 100) {
      return NextResponse.json({ error: 'Source must be 100 characters or fewer' }, { status: 400 });
    }

    // ── Attribution ─────────────────────────────────────────────────────────────
    // The browser sends utm_*/referrer/landing_page (from the first-party
    // attribution cookie) plus the page it was submitted from; the server adds
    // coarse geo and a device label and derives a channel bucket. Every field is
    // optional — a direct visit with no campaign still yields channel "Direct",
    // which is a real answer rather than a null.
    const attr = buildLeadContext(req, body as Record<string, unknown>);

    // ── Save lead to Supabase ───────────────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // must be service role — publishable key is blocked by RLS

    if (!supabaseUrl || !serviceKey) {
      // FAIL LOUD. This route used to just log the missing key and fall through to a
      // 200 "success", so the form redirected the visitor to /thank-you while nothing
      // was saved — website leads vanished silently for a MONTH (the Aug 2026 outage).
      // A 500 surfaces the break immediately (the form shows an error instead of a
      // phantom success) and recordIntegrationFailure records it to integration-health
      // and emails an alert. The alert email is best-effort (the status-row write needs
      // the same service key that is missing), but the 500 is the reliable loud signal.
      console.error('[leads] SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_URL missing — cannot save lead');
      await recordIntegrationFailure(LEAD_WRITE_KEY,
        'Lead NOT saved — SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is missing in this deployment. Every website submission is being lost.',
        { subject: '⚠️ Lead capture is DOWN — Supabase service-role key missing' });
      return NextResponse.json({ error: 'We could not save your message right now. Please call or text 210-390-9997.' }, { status: 500 });
    }

    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey);
      const { error: leadsErr } = await supabase.from('leads').insert([{
        name,
        email: email ?? null,
        phone: phone ?? null,
        message: message ?? null,
        property_interest: property_interest ?? null,
        source: source ?? 'contact',
        status: 'new',
        utm_source: attr.utm_source, utm_medium: attr.utm_medium, utm_campaign: attr.utm_campaign,
        utm_term: attr.utm_term, utm_content: attr.utm_content,
        referrer: attr.referrer, landing_page: attr.landing_page,
        page_path: attr.page_path, page_url: attr.page_url, page_title: attr.page_title,
        surface: attr.surface, geo: attr.geo, device: attr.device, channel: attr.channel,
        journey: attr.journey, time_on_site_sec: attr.time_on_site_sec, page_views: attr.page_views,
        // Stamp the site here too. crm_clients already carried it; leaving it off
        // the raw row meant the dashboard had to infer the site from the source
        // text for every FORG lead instead of reading it.
        lead_site: 'fairoaksrealtygroup.com',
      }]);
      if (leadsErr) {
        // FAIL LOUD — the primary lead record did not save. Alert + 500, instead of
        // the old swallow-and-return-200 that hid the outage behind a phantom success.
        console.error('[leads] leads table insert error:', leadsErr);
        await recordIntegrationFailure(LEAD_WRITE_KEY,
          `Lead NOT saved — public.leads insert failed: ${leadsErr.message ?? JSON.stringify(leadsErr)}`,
          { subject: '⚠️ Lead capture is failing — public.leads insert error' });
        return NextResponse.json({ error: 'We could not save your message right now. Please call or text 210-390-9997.' }, { status: 500 });
      }
      // Saved. Flip the capture monitor back to healthy (and fire the one-time
      // recovery note if it had been failing).
      await recordIntegrationSuccess(LEAD_WRITE_KEY);
    }

    // ── Auto-create CRM client from lead ────────────────────────────────────────
    if (supabaseUrl && serviceKey) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, serviceKey);

        // Find admin to assign as default owner
        const { data: adminProfile, error: adminErr } = await supabaseAdmin
          .from('crm_profiles').select('id').in('role', ['admin', 'super_admin']).limit(1).maybeSingle();
        if (adminErr) console.error('[leads] crm_profiles lookup error:', adminErr);
        const adminId = adminProfile?.id;

        if (adminId) {
          // Skip duplicate — if a client with this email already exists don't double-create
          let existing = null;
          if (email) {
            const { data } = await supabaseAdmin
              .from('crm_clients').select('id').eq('email', email).maybeSingle();
            existing = data;
          }

          if (!existing) {
            const nameParts = name.trim().split(/\s+/);
            const first_name = nameParts[0] ?? name;
            const last_name = nameParts.slice(1).join(' ') ?? '';

            // A home-valuation request is an owner telling us what they hold
            // and hinting they may sell — tag it so it never sits in the
            // general pile.
            const isValuation = source === 'valuation' && unit !== 'commercial';
            // A /market-reports sign-up joins the "Market Report Subscribers" list,
            // which filters on the "Market Report" tag.
            const isMarketReport = source === 'market-report';

            // Map source → client type
            const clientType = source === 'valuation' ? 'Seller'
              : source === 'landlord' ? 'Landlord/Investor'
              : source === 'tenant' ? 'Tenant'
              : unit === 'commercial' ? 'Tenant'
              : 'Buyer';

            const noteLines = [
              `📩 Website lead — ${source ?? 'contact form'}`,
              message ? `Message: ${message}` : '',
              property_interest ? `Property interest: ${property_interest}` : '',
            ].filter(Boolean);

            const unsubscribe_token = crypto.randomUUID();

            const { data: newClient, error: crmInsertErr } = await supabaseAdmin.from('crm_clients').insert([{
              first_name,
              last_name,
              email: email ?? null,
              phone: phone ?? '',
              type: clientType,
              notes: noteLines.join('\n'),
              agent_id: adminId,
              assigned_agent_ids: [],
              lead_source: isValuation
                ? 'Home valuation — fairoaksrealtygroup.com/home-valuation'
                : isMarketReport
                  ? 'Market report — fairoaksrealtygroup.com/market-reports'
                  : 'Website',
              prospect_status: 'new',
              business_unit: unit,
              tags: isValuation
                ? ['New Lead', 'Website Lead', 'Valuation', 'Seller', 'Fair Oaks']
                : isMarketReport
                  ? ['New Lead', 'Website Lead', 'Market Report', 'Fair Oaks']
                : unit === 'commercial' ? ['New Lead', 'Website Lead', 'CRECO'] : ['New Lead', 'Website Lead'],
              unsubscribe_token,
              // Attribution travels with the contact, not just the raw lead row —
              // crm_clients is what the Lead Attribution dashboard charts.
              utm_source: attr.utm_source, utm_medium: attr.utm_medium, utm_campaign: attr.utm_campaign,
              utm_term: attr.utm_term, utm_content: attr.utm_content,
              referrer: attr.referrer, landing_page: attr.landing_page,
              page_path: attr.page_path, page_title: attr.page_title,
              surface: attr.surface, geo: attr.geo, device: attr.device,
              channel: attr.channel,
              journey: attr.journey, time_on_site_sec: attr.time_on_site_sec, page_views: attr.page_views,
              lead_site: 'fairoaksrealtygroup.com',
            }]).select('id').single();

            if (crmInsertErr) {
              console.error('[leads] crm_clients insert error:', JSON.stringify(crmInsertErr));
              // The lead IS saved (public.leads) and the team is still emailed, so this
              // does NOT fail the request — but alert (degraded), because the contact is
              // missing from the CRM dashboard and needs a manual backfill.
              await recordIntegrationFailure(LEAD_WRITE_KEY,
                `Lead saved to public.leads but crm_clients insert failed — contact missing from CRM: ${crmInsertErr.message ?? JSON.stringify(crmInsertErr)}`,
                { severity: 'degraded', subject: '⚠️ Lead saved but CRM contact insert failed' });
            } else {
              console.log(`[leads] CRM client created: ${first_name} ${last_name} (${email ?? phone})`);
              // Speed-to-lead: put it on the owner's list the moment it lands.
              if (newClient?.id) await createLeadFollowUpTask(supabaseAdmin, {
                clientId: newClient.id,
                name, email, phone,
                channel: attr.channel, leadSite: 'fairoaksrealtygroup.com',
                campaign: attr.utm_campaign, source: source ?? 'contact',
                businessUnit: unit,
                detail: [message ? `Message: ${message}` : '', property_interest ? `Interested in: ${property_interest}` : ''].filter(Boolean).join('\n'),
              });
              // Welcome sequence: off unless LEAD_AUTOENROLL_UNITS names this unit.
              if (newClient?.id) await maybeAutoEnrollLead(supabaseAdmin, { clientId: newClient.id, agentId: adminId ?? null, businessUnit: unit as 'commercial' | 'residential' });
              // Write to email_lead_imports so the Prospects tab shows this lead immediately
              await supabaseAdmin.from('email_lead_imports').insert([{
                gmail_message_id:    `website-${crypto.randomUUID()}`,
                gmail_connection_id: null,
                source:              'Website',
                business_unit:       unit,
                client_id:           newClient?.id ?? null,
                raw_subject:         `New Lead: ${name}`,
                parsed_name:         name,
                parsed_email:        email ?? null,
                parsed_phone:        phone ?? null,
                parsed_property:     property_interest ?? null,
                parsed_message:      message ?? null,
                channel:             attr.channel,
                lead_site:           'fairoaksrealtygroup.com',
              }]);
            }
          } else {
            console.log(`[leads] CRM client already exists for email: ${email}`);
            // An existing contact signing up for market updates still joins the list.
            if (source === 'market-report') {
              const { data: cur } = await supabaseAdmin.from('crm_clients').select('tags').eq('id', existing.id).maybeSingle();
              const tags: string[] = Array.isArray(cur?.tags) ? cur.tags : [];
              if (!tags.includes('Market Report')) {
                const { error: tagErr } = await supabaseAdmin.from('crm_clients').update({ tags: [...tags, 'Market Report'] }).eq('id', existing.id);
                if (tagErr) console.error('[leads] market-report tag on existing client failed:', tagErr);
              }
            }
          }
        } else {
          console.error('[leads] No admin profile found in crm_profiles — cannot assign CRM client');
        }
      } catch (crmErr) {
        // Non-fatal — lead is already saved, CRM sync failure logged
        console.error('[leads] CRM client sync exception:', crmErr);
      }
    }

    // ── Send email notifications via Resend ────────────────────────────────────
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Notify the team
      await sendMonitored(resend, {
        from: FROM_EMAIL,
        to: NOTIFICATION_EMAIL,
        replyTo: email || undefined,
        subject: source === 'valuation'
          ? `🏡 Home valuation request: ${name}`
          : `📬 New Lead: ${name} — ${source ?? 'Contact Form'}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#1A1A1A">
            <div style="background:#1A1A1A;padding:18px 22px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;color:#C9A962;font-size:19px;font-family:Georgia,'Times New Roman',serif">${source === 'valuation' ? 'Home Valuation Request' : 'New Lead'}</h2>
              <p style="margin:4px 0 0;color:#ffffff99;font-size:13px">Fair Oaks Realty Group</p>
            </div>
            <table style="border-collapse:collapse;width:100%">
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Name</td><td style="padding:8px 12px;border:1px solid #eee">${esc(name)}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Email</td><td style="padding:8px 12px;border:1px solid #eee"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Phone</td><td style="padding:8px 12px;border:1px solid #eee">${esc(phone) || '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Source</td><td style="padding:8px 12px;border:1px solid #eee">${esc(source) || 'contact'}</td></tr>
              ${property_interest ? `<tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Property</td><td style="padding:8px 12px;border:1px solid #eee">${esc(property_interest)}</td></tr>` : ''}
              ${message ? `<tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Message</td><td style="padding:8px 12px;border:1px solid #eee">${esc(message)}</td></tr>` : ''}
            </table>
            <p style="margin:16px 0 0;font-size:12px;color:#8A8A8A">
              Fair Oaks Realty Group · 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015 · 210-390-9997
            </p>
          </div>
        `,
      }, LEAD_NOTIFY_KEY, { failSubject: '⚠️ A lead alert did not send', label: 'Website lead notification (/api/leads)' });  // failure recorded to integration-health; the lead is already saved

      // Auto-reply to the lead (only if they provided an email)
      if (email) await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'We received your inquiry — Fair Oaks Realty Group',
        html: fairOaksEmail({
          preheader: 'We have your message — a member of our team will be in touch personally.',
          heading: 'Thanks for reaching out',
          paragraphs: [
            `Hi ${esc(name)}, thank you for contacting Fair Oaks Realty Group. A member of our team will be in touch with you personally.`,
            'In the meantime you can browse current listings, or call or text us at <a href="tel:+12103909997" style="color:#A68B4B;text-decoration:none;">210-390-9997</a> if it is urgent.',
          ],
          cta: { label: 'Browse homes for sale', href: 'https://www.fairoaksrealtygroup.com/listings' },
          reason: 'You&rsquo;re receiving this because you contacted Fair Oaks Realty Group at fairoaksrealtygroup.com.',
        }),
      }).catch(err => console.error('Lead auto-reply email failed (non-fatal):', err));
    }

    return NextResponse.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('Lead submission error:', err);
    return NextResponse.json({ error: 'Failed to submit lead' }, { status: 500 });
  }
}
