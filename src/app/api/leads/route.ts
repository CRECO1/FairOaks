import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { rateLimit } from '@/lib/ratelimit';

const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@fairoaksrealtygroup.com';
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

    const body = await req.json();
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

    // ── Save lead to Supabase ───────────────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // must be service role — publishable key is blocked by RLS

    if (!serviceKey) {
      console.error('[leads] SUPABASE_SERVICE_ROLE_KEY is not set — skipping DB write');
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
      }]);
      if (leadsErr) console.error('[leads] leads table insert error:', leadsErr);
    }

    // ── Auto-create CRM client from lead ────────────────────────────────────────
    if (supabaseUrl && serviceKey) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, serviceKey);

        // Find admin to assign as default owner
        const { data: adminProfile, error: adminErr } = await supabaseAdmin
          .from('crm_profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
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
              lead_source: 'Website',
              prospect_status: 'new',
              business_unit: unit,
              tags: unit === 'commercial' ? ['New Lead', 'Website Lead', 'CRECO'] : ['New Lead', 'Website Lead'],
              unsubscribe_token,
            }]).select('id').single();

            if (crmInsertErr) {
              console.error('[leads] crm_clients insert error:', JSON.stringify(crmInsertErr));
            } else {
              console.log(`[leads] CRM client created: ${first_name} ${last_name} (${email ?? phone})`);
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
              }]);
            }
          } else {
            console.log(`[leads] CRM client already exists for email: ${email}`);
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
      await resend.emails.send({
        from: FROM_EMAIL,
        to: NOTIFICATION_EMAIL,
        subject: `📬 New Lead: ${name} — ${source ?? 'Contact Form'}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px">
            <h2 style="color:#1a1a2e">New Lead — Fair Oaks Realty Group</h2>
            <table style="border-collapse:collapse;width:100%">
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Name</td><td style="padding:8px 12px;border:1px solid #eee">${esc(name)}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Email</td><td style="padding:8px 12px;border:1px solid #eee"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Phone</td><td style="padding:8px 12px;border:1px solid #eee">${esc(phone) || '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Source</td><td style="padding:8px 12px;border:1px solid #eee">${esc(source) || 'contact'}</td></tr>
              ${property_interest ? `<tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Property</td><td style="padding:8px 12px;border:1px solid #eee">${esc(property_interest)}</td></tr>` : ''}
              ${message ? `<tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Message</td><td style="padding:8px 12px;border:1px solid #eee">${esc(message)}</td></tr>` : ''}
            </table>
          </div>
        `,
      });

      // Auto-reply to the lead (only if they provided an email)
      if (email) await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'We received your inquiry — Fair Oaks Realty Group',
        html: `
          <div style="font-family:sans-serif;max-width:600px">
            <h2 style="color:#1a1a2e">Hi ${esc(name)},</h2>
            <p>Thank you for reaching out to <strong>Fair Oaks Realty Group</strong>!</p>
            <p>A member of our team will be in touch within 1 business day.</p>
            <p>In the meantime, feel free to browse our latest listings or call us directly at <a href="tel:+12103909997">210-390-9997</a>.</p>
            <br/>
            <p>— The Fair Oaks Realty Group Team</p>
          </div>
        `,
      });
    }

    return NextResponse.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('Lead submission error:', err);
    return NextResponse.json({ error: 'Failed to submit lead' }, { status: 500 });
  }
}
