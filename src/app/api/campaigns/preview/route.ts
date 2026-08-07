/**
 * POST /api/campaigns/preview
 *
 * Sends a test/preview email for a campaign to the requesting agent's
 * own email address so they can see how it renders in a real inbox.
 *
 * Body: { subject, body, campaignName?, businessUnit? }
 *
 * SECURITY: the preview always goes to the caller's own address. A client-supplied
 * recipient would turn this into an open relay for HTML sent from the brand domains.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Lazy init so build doesn't fail when RESEND_API_KEY isn't set at compile time
const getResend = () => new Resend(process.env.RESEND_API_KEY);

function applyMergeFields(template: string, agentFirstName: string, agentLastName: string, agentEmail: string, agentPhone: string, brokerage: string): string {
  return template
    .replaceAll('{{first_name}}',    'Jane')
    .replaceAll('{{last_name}}',     'Smith')
    .replaceAll('{{full_name}}',     'Jane Smith')
    .replaceAll('{{email}}',         'jane@example.com')
    .replaceAll('{{client_type}}',   'Buyer')
    .replaceAll('{{agent_name}}',    `${agentFirstName} ${agentLastName}`.trim())
    .replaceAll('{{agent_email}}',   agentEmail)
    .replaceAll('{{agent_phone}}',   agentPhone)
    .replaceAll('{{brokerage}}',     brokerage)
    .replaceAll('{{unsubscribe_url}}', '#preview-unsubscribe');
}

export async function POST(req: NextRequest) {
  // Verify user via Bearer token (CSRF-safe)
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get agent profile for name + email
  const { data: profile } = await admin
    .from('crm_profiles')
    .select('first_name, last_name, email, phone')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // recipientEmail is deliberately NOT read from the body — see the note on toEmail below.
  const { subject, body, campaignName, businessUnit } = await req.json();
  const isCommercial = businessUnit === 'commercial';

  if (!subject && !body) {
    return NextResponse.json({ error: 'subject or body required' }, { status: 400 });
  }

  const agentFirst = profile.first_name ?? 'Agent';
  const agentLast  = profile.last_name ?? '';
  const agentEmail = isCommercial ? 'zack@crecotx.com' : (profile.email ?? user.email ?? '');
  const agentPhone = isCommercial ? '210-817-3443' : (profile.phone ?? '210-390-9997');
  const brokerage  = isCommercial ? 'CRECO' : 'Fair Oaks Realty Group';

  const renderedSubject = applyMergeFields(subject ?? '(no subject)', agentFirst, agentLast, agentEmail, agentPhone, brokerage);
  let renderedBody      = applyMergeFields(body ?? '', agentFirst, agentLast, agentEmail, agentPhone, brokerage);

  // Wrap in a preview banner so it's obvious this is a test
  const previewBanner = `
    <div style="background:#fef3c7;border-bottom:2px solid #f59e0b;padding:10px 20px;font-family:Arial,sans-serif;font-size:13px;color:#92400e;text-align:center;">
      <strong>⚠️ TEST PREVIEW</strong> — This is a test send of <em>${campaignName ?? 'your campaign'}</em>.
      Merge fields are replaced with sample data. Real sends use each contact's actual info.
    </div>
  `;
  renderedBody = previewBanner + renderedBody;

  // Previews go ONLY to the requesting agent's own address — never a client-supplied
  // recipient (that would make this endpoint an open relay for mail sent from the
  // brokerage domains). `agentEmail` above is the brand-facing from/reply-to identity,
  // not a delivery target, so the caller's own profile email is used here.
  const toEmail = profile.email ?? user.email ?? '';
  if (!toEmail) {
    return NextResponse.json({ error: 'No recipient email — add an email to your profile first' }, { status: 400 });
  }

  try {
    await getResend().emails.send({
      from:     isCommercial ? 'CRECO <noreply@crecotx.com>' : 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
      to:       toEmail,
      subject:  `[TEST] ${renderedSubject}`,
      html:     renderedBody,
      replyTo: agentEmail || undefined,
    });

    return NextResponse.json({ success: true, sentTo: toEmail });
  } catch (err: any) {
    console.error('[campaign preview] send error:', err);
    return NextResponse.json({ error: 'Failed to send preview email' }, { status: 500 });
  }
}
