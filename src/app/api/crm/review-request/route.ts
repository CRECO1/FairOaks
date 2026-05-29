import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL ?? '';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 503 });
  }

  if (!GOOGLE_REVIEW_URL) {
    return NextResponse.json({ error: 'GOOGLE_REVIEW_URL is not configured' }, { status: 503 });
  }

  const { clientId } = await req.json().catch(() => ({}));
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });

  const supabase = adminClient();

  // Fetch client
  const { data: client, error: clientErr } = await supabase
    .from('crm_clients')
    .select('id, first_name, last_name, email, review_requested_at, unsubscribed_at')
    .eq('id', clientId)
    .single();

  if (clientErr || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  if (!client.email) {
    return NextResponse.json({ error: 'Client has no email address' }, { status: 400 });
  }

  if (client.unsubscribed_at) {
    return NextResponse.json({ error: 'Client has unsubscribed from emails' }, { status: 400 });
  }

  // Fetch the agent's name for a personalized sign-off
  const { data: agentProfile } = await supabase
    .from('crm_profiles')
    .select('first_name, last_name')
    .eq('id', caller.id)
    .single();

  const agentName = agentProfile
    ? `${agentProfile.first_name} ${agentProfile.last_name}`.trim()
    : 'Your Fair Oaks Realty Group Agent';

  const clientFirst = client.first_name || 'there';

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { error: emailErr } = await resend.emails.send({
    from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
    to: client.email,
    subject: 'Would you share your experience? — Fair Oaks Realty Group',
    html: `
      <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <!-- Header -->
        <div style="background:#1a1a2e;padding:28px 32px">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px">
            Fair Oaks <span style="color:#c9922c">Realty Group</span>
          </p>
        </div>

        <!-- Body -->
        <div style="padding:32px 32px 24px">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1a1a2e;line-height:1.3">
            Hi ${esc(clientFirst)}, we'd love your feedback!
          </h1>
          <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.6">
            It was truly a pleasure working with you. If you had a great experience,
            we'd be incredibly grateful if you took a moment to leave us a Google review —
            it helps other families in the Hill Country find the right agent.
          </p>
          <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.6">
            It only takes about 60 seconds and means the world to our team.
          </p>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:28px">
            <a href="${GOOGLE_REVIEW_URL}"
               style="display:inline-block;background:#c9922c;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.2px">
              ⭐ Leave a Google Review
            </a>
          </div>

          <p style="margin:0 0 6px;font-size:14px;color:#6b7280;line-height:1.6">
            Thank you so much — your support means everything to us.
          </p>
          <p style="margin:0;font-size:14px;color:#6b7280">
            Warmly,<br/>
            <strong style="color:#1a1a2e">${esc(agentName)}</strong><br/>
            Fair Oaks Realty Group<br/>
            <a href="tel:+12103909997" style="color:#c9922c;text-decoration:none">210-390-9997</a>
          </p>
        </div>

        <!-- Footer -->
        <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
          <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5">
            8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015 ·
            <a href="https://www.fairoaksrealtygroup.com" style="color:#9ca3af">fairoaksrealtygroup.com</a>
          </p>
        </div>
      </div>
    `,
  });

  if (emailErr) {
    console.error('[review-request] email error:', emailErr);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }

  // Mark client with timestamp + "Review Requested" tag
  const { data: refreshed } = await supabase
    .from('crm_clients')
    .select('tags')
    .eq('id', clientId)
    .single();

  const existingTags: string[] = refreshed?.tags ?? [];
  const updatedTags = existingTags.includes('Review Requested')
    ? existingTags
    : [...existingTags, 'Review Requested'];

  await supabase
    .from('crm_clients')
    .update({
      review_requested_at: new Date().toISOString(),
      tags: updatedTags,
    })
    .eq('id', clientId);

  return NextResponse.json({ success: true });
}
