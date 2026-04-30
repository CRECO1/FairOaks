import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';
const REDIRECT_URL = 'https://www.fairoaksrealtygroup.com/crm/setup';

export async function POST(req: NextRequest) {
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

    // Generate a password reset link via Supabase admin API (does NOT send email)
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        type: 'recovery',
        email,
        redirect_to: REDIRECT_URL,
      }),
    });

    const linkData = await linkRes.json();

    if (!linkRes.ok) {
      console.error('Generate reset link error:', linkData);
      return NextResponse.json({
        error: linkData.msg || linkData.message || JSON.stringify(linkData),
      }, { status: 400 });
    }

    const resetLink: string = linkData.action_link;

    // Send the reset email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'CRECO / Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
        to: [email],
        subject: 'Reset your CRECO password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="font-family: 'Georgia', serif; color: #1a2e1a; margin: 0;">
                Fair Oaks <span style="color: #c9a84c;">Realty Group</span>
              </h1>
              <p style="color: #6b7280; margin: 4px 0 0;">CRECO Agent Portal</p>
            </div>

            <p style="color: #374151; font-size: 16px;">Hi${firstName ? ` ${firstName}` : ''},</p>

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
              © ${new Date().getFullYear()} Fair Oaks Realty Group · 7510 FM 1560 N, Suite 101, Fair Oaks Ranch, TX 78015
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Reset password route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
