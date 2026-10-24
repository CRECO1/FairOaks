import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, getCrmSuperAdmin, forbidden } from '@/lib/crm-auth';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, REDIRECT_URL } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';

const esc = (v: unknown) => String(v ?? '').slice(0, 100).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Returns the admin user ID if valid, null otherwise. */
async function getAdminId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user } } = await admin.auth.getUser(token);
    if (user) {
      const { data } = await admin.from('crm_profiles').select('role').eq('id', user.id).single();
      return (data?.role === 'admin' || data?.role === 'super_admin') ? user.id : null;
    }
    return null;
  }
  const caller = await getCrmAdmin();
  return caller?.id ?? null;
}

export async function POST(req: NextRequest) {
  const adminId = await getAdminId(req);
  if (!adminId) return forbidden();

  try {
    const { email, firstName } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    if (!serviceRoleKey || !anonKey || !resendKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    if (typeof email !== 'string' || email.length > 320) return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    const targetEmail = email.trim().toLowerCase();

    // Generate a password reset link via Supabase admin API (does NOT send email). It also tells us the
    // target's auth user id, which we use for the role lookup below — looking the profile up by email
    // string (exact, lowercase) could miss a row whose stored email differs in case and skip the check.
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        type: 'recovery',
        email: targetEmail,
        redirect_to: REDIRECT_URL,
      }),
    });

    const linkData = await linkRes.json();

    if (!linkRes.ok) {
      console.error('[reset-password] Generate link failed:', linkData);
      return NextResponse.json({ error: 'Failed to generate reset link. Verify the email exists in the system.' }, { status: 400 });
    }


    const resetLink: string = linkData.action_link;
    const targetId: string | undefined = linkData.id ?? linkData.user?.id;
    if (!targetId || typeof resetLink !== 'string') {
      console.error('[reset-password] Generate link returned no user id');
      return NextResponse.json({ error: 'Failed to generate reset link. Verify the email exists in the system.' }, { status: 400 });
    }

    // Resetting an admin or super_admin is super-admin-only. /crm/delete-agent
    // already draws this line ("stops an admin from deleting the super admin
    // to seize control"); this route did not, so any admin could post the
    // super admin's address and have a recovery link sent. The link lands in
    // the target's own inbox rather than the caller's, so it is not a direct
    // takeover — but info@fairoaksrealtygroup.com is a shared brokerage
    // mailbox, and anyone who can read it could complete the reset. Same rule,
    // same reasoning, applied to the second door into the same account.
    // The role is read by auth user id and compared case-insensitively; the link is only emailed after the check.
    const roleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_profiles?id=eq.${encodeURIComponent(targetId)}&select=role`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!roleRes.ok) return NextResponse.json({ error: 'Could not verify the account. Try again.' }, { status: 500 });
    const roleRows = await roleRes.json().catch(() => null);
    if (!Array.isArray(roleRows)) return NextResponse.json({ error: 'Could not verify the account. Try again.' }, { status: 500 });
    const targetRole = String(roleRows[0]?.role ?? '').trim().toLowerCase();
    if (targetRole === 'admin' || targetRole === 'super_admin') {
      if (!(await getCrmSuperAdmin(req))) {
        return forbidden('Only a super admin can reset an admin’s password.');
      }
    }

    // Send the reset email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'CRECO / Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
        to: [targetEmail],
        subject: 'Reset your CRECO password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="font-family: 'Georgia', serif; color: #1a2e1a; margin: 0;">
                Fair Oaks <span style="color: #c9a84c;">Realty Group</span>
              </h1>
              <p style="color: #6b7280; margin: 4px 0 0;">CRECO Agent Portal</p>
            </div>

            <p style="color: #374151; font-size: 16px;">Hi${firstName ? ` ${esc(firstName)}` : ''},</p>

            <p style="color: #374151; font-size: 16px;">
              Your admin has sent you a password reset for the <strong>CRECO / Fair Oaks Realty Group</strong> agent portal.
              Click the button below to set a new password.
            </p>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetLink}"
                style="background-color: #c9a84c; color: #fff; padding: 14px 32px; border-radius: 8px;
                       text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                Reset My Password
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              This link will expire in 24 hours. If you didn't request this, you can ignore this email.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              © ${new Date().getFullYear()} Fair Oaks Realty Group · 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015
            </p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const emailData = await emailRes.json();
      console.error('Resend error:', emailData);
      return NextResponse.json({ error: 'Failed to send reset email' }, { status: 500 });
    }

    await writeAuditLog({
      actorId: adminId,
      action: 'reset_password',
      targetType: 'agent',
      metadata: { email: targetEmail, firstName: typeof firstName === 'string' ? firstName.slice(0, 100) : null },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[reset-password] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
