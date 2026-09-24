import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/ratelimit';
import { verifyRecaptcha, RECAPTCHA_REJECTED } from '@/lib/recaptcha';
import { createRecruitContact } from '@/lib/recruiting-crm';

// Agent applications are recruiting mail, not sales mail, so they get their own
// recipient. Set RECRUITING_NOTIFICATION_EMAIL to a leadership-only address to keep
// applications out of the shared leads inbox. Falls back to the leads address when
// unset, which preserves the previous behavior.
const NOTIFICATION_EMAIL =
  process.env.RECRUITING_NOTIFICATION_EMAIL ??
  process.env.LEAD_NOTIFICATION_EMAIL ??
  'info@fairoaksrealtygroup.com';
const FROM_EMAIL = 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, 'agent-apply');
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    // reCAPTCHA v3 — a no-op until RECAPTCHA_SECRET_KEY is set (see lib/recaptcha.ts).
    const captcha = await verifyRecaptcha(
      body.recaptchaToken,
      'agent_apply',
      req.headers.get('x-forwarded-for')?.split(',')[0].trim(),
    );
    if (!captcha.ok) {
      console.warn('[agent_apply] reCAPTCHA rejected', captcha.reason, captcha.score);
      return NextResponse.json(RECAPTCHA_REJECTED, { status: 403 });
    }
    const { name, email, phone, license, experience, current_brokerage, production, message } = body;

    if (!name || !email || !phone) {
      return NextResponse.json({ error: 'Name, email, and phone are required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // ── File the applicant in the CRM recruiting funnel ──────────────────────
    // Tagged Recruiting + Recruiting: Prospect, owned by the broker. Capture
    // must never break the submission, so failures are logged inside the helper.
    let crmContactId: string | null = null;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      const result = await createRecruitContact(createClient(supabaseUrl, serviceKey), {
        name, email, phone, license, experience, current_brokerage, production, message,
        sourceLabel: 'Agent application — fairoaksrealtygroup.com',
        businessUnit: 'residential',
      });
      crmContactId = result.id;
    } else {
      console.error('[agent_apply] Supabase env missing — applicant not filed in the CRM');
    }

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Notify the broker. Applicants are NOT auto-replied to — Zack answers
      // these personally, so the only mail this route sends is internal.
      await resend.emails.send({
        from: FROM_EMAIL,
        to: NOTIFICATION_EMAIL,
        // Hitting reply in the broker's inbox goes straight to the applicant.
        replyTo: email,
        subject: `New agent application: ${esc(name)}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;color:#1A1A1A">
            <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;color:#C9A962;font-size:20px;font-family:Georgia,'Times New Roman',serif">New Agent Application</h2>
              <p style="margin:4px 0 0;color:#ffffff99;font-size:14px">Fair Oaks Realty Group · Recruiting</p>
            </div>
            <div style="background:#F5F0E6;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #E5DCC8">
              <table style="border-collapse:collapse;width:100%;font-size:14px;background:#fff">
                <tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8;width:180px">Name</td><td style="padding:10px 12px;border:1px solid #E5DCC8">${esc(name)}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8">Email</td><td style="padding:10px 12px;border:1px solid #E5DCC8"><a href="mailto:${esc(email)}" style="color:#8A6D2F">${esc(email)}</a></td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8">Phone</td><td style="padding:10px 12px;border:1px solid #E5DCC8"><a href="tel:${esc(phone)}" style="color:#8A6D2F">${esc(phone)}</a></td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8">TX License #</td><td style="padding:10px 12px;border:1px solid #E5DCC8">${esc(license) || '—'}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8">Experience</td><td style="padding:10px 12px;border:1px solid #E5DCC8">${esc(experience) || '—'}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8">Current Brokerage</td><td style="padding:10px 12px;border:1px solid #E5DCC8">${esc(current_brokerage) || '—'}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8">Annual Production</td><td style="padding:10px 12px;border:1px solid #E5DCC8">${esc(production) || '—'}</td></tr>
                ${message ? `<tr><td style="padding:10px 12px;font-weight:600;border:1px solid #E5DCC8">Message</td><td style="padding:10px 12px;border:1px solid #E5DCC8">${esc(message)}</td></tr>` : ''}
              </table>
              <p style="margin:16px 0 0;font-size:13px;color:#6B6B6B">
                ${crmContactId
                  ? 'Filed in the CRM as a recruiting prospect (tagged <strong>Recruiting</strong> → <strong>Recruiting: Prospect</strong>).'
                  : '⚠️ Could not be filed in the CRM automatically — add this applicant by hand.'}
                No automatic reply was sent to the applicant.
              </p>
              <div style="margin-top:20px">
                <a href="mailto:${esc(email)}" style="display:inline-block;background:#C9A962;color:#1A1A1A;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px">Reply to Applicant</a>
              </div>
              <p style="margin:24px 0 0;font-size:12px;color:#8A8A8A;border-top:1px solid #E5DCC8;padding-top:12px">
                Fair Oaks Realty Group · 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015 · 210-390-9997
              </p>
            </div>
          </div>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Agent apply error:', err);
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 });
  }
}
