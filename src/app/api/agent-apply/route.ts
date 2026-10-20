import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { rateLimit } from '@/lib/ratelimit';

const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@fairoaksrealtygroup.com';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
const MAX_LEN = { name: 200, email: 200, phone: 30, short: 200, message: 5000 };

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, 'agent-apply');
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const { name, email, phone, license, experience, current_brokerage, production, message } = body;

    // Honeypot: bots fill the hidden `website` field — pretend success.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return NextResponse.json({ success: true });
    }

    if (!name || !email || !phone) {
      return NextResponse.json({ error: 'Name, email, and phone are required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const tooLong =
      String(name).length > MAX_LEN.name || String(email).length > MAX_LEN.email ||
      String(phone).length > MAX_LEN.phone ||
      [license, experience, current_brokerage, production].some((v) => String(v ?? '').length > MAX_LEN.short) ||
      String(message ?? '').length > MAX_LEN.message;
    if (tooLong) {
      return NextResponse.json({ error: 'One or more fields are too long' }, { status: 400 });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('[agent-apply] RESEND_API_KEY not set — application cannot be delivered');
      return NextResponse.json({ error: 'Submission failed' }, { status: 500 });
    }

    {
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Notify the team
      const { error: notifyErr } = await resend.emails.send({
        from: FROM_EMAIL,
        to: NOTIFICATION_EMAIL,
        replyTo: email,
        subject: `🏡 New Agent Application: ${esc(name)}`,
        html: `
          <div style="font-family:sans-serif;max-width:620px;color:#1a1a2e">
            <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;color:#d4a843;font-size:20px">New Agent Application</h2>
              <p style="margin:4px 0 0;color:#ffffff99;font-size:14px">Fair Oaks Realty Group</p>
            </div>
            <div style="background:#f9f9f9;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #eee">
              <table style="border-collapse:collapse;width:100%;font-size:14px">
                <tr><td style="padding:10px 12px;font-weight:600;background:#fff;border:1px solid #eee;width:180px">Name</td><td style="padding:10px 12px;border:1px solid #eee;background:#fff">${esc(name)}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;background:#f9f9f9;border:1px solid #eee">Email</td><td style="padding:10px 12px;border:1px solid #eee;background:#f9f9f9"><a href="mailto:${esc(email)}" style="color:#d4a843">${esc(email)}</a></td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;background:#fff;border:1px solid #eee">Phone</td><td style="padding:10px 12px;border:1px solid #eee;background:#fff"><a href="tel:${esc(phone)}" style="color:#d4a843">${esc(phone)}</a></td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;background:#f9f9f9;border:1px solid #eee">TX License #</td><td style="padding:10px 12px;border:1px solid #eee;background:#f9f9f9">${esc(license) || '—'}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;background:#fff;border:1px solid #eee">Experience</td><td style="padding:10px 12px;border:1px solid #eee;background:#fff">${esc(experience) || '—'}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;background:#f9f9f9;border:1px solid #eee">Current Brokerage</td><td style="padding:10px 12px;border:1px solid #eee;background:#f9f9f9">${esc(current_brokerage) || '—'}</td></tr>
                <tr><td style="padding:10px 12px;font-weight:600;background:#fff;border:1px solid #eee">Annual Production</td><td style="padding:10px 12px;border:1px solid #eee;background:#fff">${esc(production) || '—'}</td></tr>
                ${message ? `<tr><td style="padding:10px 12px;font-weight:600;background:#f9f9f9;border:1px solid #eee">Message</td><td style="padding:10px 12px;border:1px solid #eee;background:#f9f9f9">${esc(message)}</td></tr>` : ''}
              </table>
              <div style="margin-top:20px">
                <a href="mailto:${esc(email)}" style="display:inline-block;background:#d4a843;color:#1a1a2e;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px">Reply to Applicant</a>
              </div>
            </div>
          </div>
        `,
      });

      // Without the team notification the application is lost — fail so the form shows the phone fallback.
      if (notifyErr) {
        console.error('[agent-apply] notification email failed:', notifyErr);
        return NextResponse.json({ error: 'Submission failed' }, { status: 500 });
      }

      // Auto-reply to applicant (best effort)
      const { error: replyErr } = await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Your application to Fair Oaks Realty Group',
        html: `
          <div style="font-family:sans-serif;max-width:600px;color:#1a1a2e">
            <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;color:#d4a843;font-size:20px">Fair Oaks Realty Group</h2>
            </div>
            <div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;border:1px solid #eee">
              <p style="margin:0 0 16px;font-size:16px">Hi ${esc(name)},</p>
              <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.6">
                Thank you for applying to join <strong>Fair Oaks Realty Group</strong>! We've received your application and a member of our leadership team will be in touch with you within <strong>1 business day</strong>.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.6">
                In the meantime, feel free to learn more about our team at <a href="https://fairoaksrealtygroup.com/team" style="color:#d4a843">fairoaksrealtygroup.com/team</a> or give us a call at <a href="tel:+12103909997" style="color:#d4a843">210-390-9997</a>.
              </p>
              <p style="margin:0;font-size:15px;color:#444">We look forward to speaking with you!</p>
              <br/>
              <p style="margin:0;font-size:14px;color:#888">— The Fair Oaks Realty Group Team</p>
            </div>
          </div>
        `,
      });
      if (replyErr) console.error('[agent-apply] applicant auto-reply failed:', replyErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Agent apply error:', err);
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 });
  }
}
