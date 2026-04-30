import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';
const REDIRECT_URL = 'https://www.fairoaksrealtygroup.com/crm/setup';

export async function POST(req: NextRequest) {
  try {
    const { email, firstName, lastName, phone, license } = await req.json();

    if (!email || !firstName || !lastName) {
      return NextResponse.json({ error: 'Email, first name and last name are required' }, { status: 400 });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    if (!serviceRoleKey || !anonKey) {
      return NextResponse.json({ error: 'Server misconfigured — missing Supabase keys' }, { status: 500 });
    }

    if (!resendKey) {
      return NextResponse.json({ error: 'Server misconfigured — missing Resend key' }, { status: 500 });
    }

    // Step 1: Generate a magic invite link (does NOT send an email — we'll do that via Resend)
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        type: 'invite',
        email,
        redirect_to: REDIRECT_URL,
        data: { firstName, lastName, phone: phone ?? '', license: license ?? '', role: 'agent' },
      }),
    });

    const linkData = await linkRes.json();

    if (!linkRes.ok) {
      console.error('Generate link error:', linkData);
      return NextResponse.json({
        error: linkData.msg || linkData.message || linkData.error_description || JSON.stringify(linkData),
      }, { status: 400 });
    }

    const inviteLink: string = linkData.action_link;
    const invitedUserId: string = linkData.user?.id ?? linkData.id;

    // Step 2: Send the invite email ourselves via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'CRECO / Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
        to: [email],
        subject: 'You\'ve been invited to CRECO — Fair Oaks Realty Group CRM',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="font-family: 'Georgia', serif; color: #1a2e1a; margin: 0;">
                Fair Oaks <span style="color: #c9a84c;">Realty Group</span>
              </h1>
              <p style="color: #6b7280; margin: 4px 0 0;">CRECO Agent Portal</p>
            </div>

            <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>

            <p style="color: #374151; font-size: 16px;">
              You've been invited to join the <strong>CRECO / Fair Oaks Realty Group</strong> agent portal.
              Click the button below to set your password and access the CRM.
            </p>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${inviteLink}"
                style="background-color: #c9a84c; color: #fff; padding: 14px 32px; border-radius: 8px;
                       text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                Accept Invitation & Set Password
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              This link will expire in 24 hours. If you didn't expect this invite, you can ignore this email.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              © ${new Date().getFullYear()} Fair Oaks Realty Group · 7510 FM 1560 N, Suite 101, Fair Oaks Ranch, TX 78015
            </p>
          </div>
        `,
      }),
    });

    const emailData = await emailRes.json();

    if (!emailRes.ok) {
      console.error('Resend email error:', emailData);
      return NextResponse.json({
        error: 'Invite link created but email failed to send: ' + (emailData.message || JSON.stringify(emailData)),
      }, { status: 500 });
    }

    // Step 3: Save the agent profile
    if (invitedUserId) {
      await fetch(`${SUPABASE_URL}/rest/v1/crm_profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          id: invitedUserId,
          email,
          first_name: firstName,
          last_name: lastName,
          phone: phone ?? null,
          license: license ?? null,
          role: 'agent',
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Invite route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
