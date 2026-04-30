import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@fairoaksrealtygroup.com';
const FROM_EMAIL = 'onboarding@resend.dev'; // works on free Resend plan; swap to noreply@fairoaksrealtygroup.com after domain verification

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, phone, message, property_interest, source } = body;

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    // ── Save lead to Supabase ───────────────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('leads').insert([{
        name,
        email,
        phone: phone ?? null,
        message: message ?? null,
        property_interest: property_interest ?? null,
        source: source ?? 'contact',
        status: 'new',
      }]);
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
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Name</td><td style="padding:8px 12px;border:1px solid #eee">${name}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Email</td><td style="padding:8px 12px;border:1px solid #eee"><a href="mailto:${email}">${email}</a></td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Phone</td><td style="padding:8px 12px;border:1px solid #eee">${phone ?? '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Source</td><td style="padding:8px 12px;border:1px solid #eee">${source ?? 'contact'}</td></tr>
              ${property_interest ? `<tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Property</td><td style="padding:8px 12px;border:1px solid #eee">${property_interest}</td></tr>` : ''}
              ${message ? `<tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Message</td><td style="padding:8px 12px;border:1px solid #eee">${message}</td></tr>` : ''}
            </table>
          </div>
        `,
      });

      // Auto-reply to the lead
      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'We received your inquiry — Fair Oaks Realty Group',
        html: `
          <div style="font-family:sans-serif;max-width:600px">
            <h2 style="color:#1a1a2e">Hi ${name},</h2>
            <p>Thank you for reaching out to <strong>Fair Oaks Realty Group</strong>!</p>
            <p>A member of our team will be in touch within 1 business day.</p>
            <p>In the meantime, feel free to browse our latest listings or call us directly at <a href="tel:+12103909997">(210) 390-9997</a>.</p>
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
