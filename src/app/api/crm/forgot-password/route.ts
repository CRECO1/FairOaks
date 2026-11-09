import { NextRequest, NextResponse } from 'next/server';
import { SUPABASE_URL, REDIRECT_URL } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/ratelimit';

/**
 * Public "Forgot password?" for the CRM login page.
 *
 * Why not supabase.auth.resetPasswordForEmail: this project has no custom SMTP on Supabase's own mailer, so those
 * emails are not delivered to normal addresses. Same approach as /api/crm/invite and /api/crm/reset-password:
 * generate the recovery link with the admin API and send it ourselves through Resend.
 *
 * The answer is identical whether or not the address has an account, so this can't be used to find out who has one.
 * The link goes only to the account's own address. Limited per IP.
 */
const GENERIC = { ok: true, message: 'If that email has an account, a reset link is on its way.' };

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, 'forgot-password');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Try again in a little while.' }, { status: 429 });

  let email = '';
  try { email = String((await req.json())?.email ?? '').trim().toLowerCase().slice(0, 200); } catch { /* fall through */ }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json(GENERIC);

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceRoleKey || !anonKey || !resendKey) { console.error('[forgot-password] missing keys'); return NextResponse.json(GENERIC); }

  try {
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ type: 'recovery', email, redirect_to: REDIRECT_URL }),
    });
    const linkData = await linkRes.json().catch(() => null) as { action_link?: string } | null;
    if (!linkRes.ok || !linkData?.action_link) return NextResponse.json(GENERIC);   // no such account: say nothing

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'CRECO / Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
        to: [email],
        subject: 'Reset your CRECO password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <p style="color: #374151; font-size: 16px;">Someone asked to reset the password for your <strong>CRECO / Fair Oaks Realty Group</strong> CRM login. Click below to choose a new one.</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${linkData.action_link}" style="background-color: #c9a84c; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">Reset My Password</a>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center;">This link expires in 24 hours. If you didn't ask for this, ignore this email — your password stays as it is.</p>
          </div>`,
      }),
    });
    if (!emailRes.ok) console.error('[forgot-password] Resend error', emailRes.status);
  } catch (e) {
    console.error('[forgot-password]', e instanceof Error ? e.message : e);
  }
  return NextResponse.json(GENERIC);
}
