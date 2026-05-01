import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

function applyMergeFields(template: string, ctx: {
  client: { first_name: string; last_name: string; email: string; type: string; unsubscribe_token: string };
  agent: { first_name: string; last_name: string; email: string; phone?: string };
}): string {
  const BASE_URL = 'https://www.fairoaksrealtygroup.com';
  const unsubscribeUrl = `${BASE_URL}/api/campaigns/unsubscribe?token=${ctx.client.unsubscribe_token}`;
  return template
    .replaceAll('{{first_name}}', ctx.client.first_name || '')
    .replaceAll('{{last_name}}', ctx.client.last_name || '')
    .replaceAll('{{full_name}}', `${ctx.client.first_name} ${ctx.client.last_name}`.trim())
    .replaceAll('{{email}}', ctx.client.email || '')
    .replaceAll('{{client_type}}', ctx.client.type || '')
    .replaceAll('{{agent_name}}', `${ctx.agent.first_name} ${ctx.agent.last_name}`.trim())
    .replaceAll('{{agent_email}}', ctx.agent.email || '')
    .replaceAll('{{agent_phone}}', ctx.agent.phone || '(210) 390-9997')
    .replaceAll('{{brokerage}}', 'Fair Oaks Realty Group')
    .replaceAll('{{unsubscribe_url}}', unsubscribeUrl);
}

function computeNextSend(frequency: string): string | null {
  if (frequency === 'one-time') return null; // one-time campaigns don't recur
  const now = new Date();
  switch (frequency) {
    case 'monthly':     now.setMonth(now.getMonth() + 1); break;
    case 'quarterly':   now.setMonth(now.getMonth() + 3); break;
    case 'semi-annual': now.setMonth(now.getMonth() + 6); break;
    case 'annual':      now.setFullYear(now.getFullYear() + 1); break;
  }
  return now.toISOString();
}

export async function POST(req: NextRequest) {
  // Secure the cron endpoint
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = adminClient();
  const resend = new Resend(process.env.RESEND_API_KEY!);

  // Get all due active enrollments (limit 50 per run to stay within Vercel timeout)
  // next_send_at is set to the exact send datetime (CT converted to UTC) at enrollment time,
  // so a simple lte check handles both recurring and one-time campaigns correctly.
  const now = new Date().toISOString();
  const { data: enrollments, error: fetchErr } = await supabase
    .from('crm_campaign_enrollments')
    .select(`
      id, campaign_id, client_id, next_send_at,
      campaign:crm_campaigns!inner(id, name, type, frequency, send_date, send_time, status, email_subject, email_body, sms_body, sender_agent_id),
      client:crm_clients!inner(id, first_name, last_name, email, phone, cell_phone, type, agent_id, unsubscribe_token, unsubscribed_at)
    `)
    .eq('active', true)
    .eq('campaign.status', 'active')
    .is('client.unsubscribed_at', null)
    .not('next_send_at', 'is', null)
    .lte('next_send_at', now)
    .limit(50);

  if (fetchErr) {
    console.error('Cron fetch error:', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!enrollments?.length) return NextResponse.json({ processed: 0, sent: 0, failed: 0 });

  // Get agent profiles for all unique agent_ids (client's assigned agent) + sender_agent_ids (campaign override)
  const clientAgentIds = [...new Set((enrollments as any[]).map((e: any) => e.client?.agent_id).filter(Boolean))];
  const senderAgentIds = [...new Set((enrollments as any[]).map((e: any) => e.campaign?.sender_agent_id).filter(Boolean))];
  const allAgentIds = [...new Set([...clientAgentIds, ...senderAgentIds])];
  const { data: agents } = await supabase.from('crm_profiles').select('id, first_name, last_name, email, phone').in('id', allAgentIds);
  const agentMap = Object.fromEntries((agents ?? []).map((a: any) => [a.id, a]));

  let sent = 0;
  let failed = 0;

  for (const enrollment of (enrollments as any[])) {
    const campaign = enrollment.campaign;
    const client = enrollment.client;
    if (!campaign || !client) continue;

    // Use campaign's sender_agent if set, otherwise fall back to client's assigned agent
    const senderAgent = campaign.sender_agent_id
      ? agentMap[campaign.sender_agent_id]
      : agentMap[client.agent_id];
    const agent = senderAgent ?? { first_name: 'Your', last_name: 'Agent', email: 'info@fairoaksrealtygroup.com', phone: '(210) 390-9997' };

    const ctx = {
      client: {
        first_name: client.first_name,
        last_name: client.last_name,
        email: client.email,
        type: client.type,
        unsubscribe_token: client.unsubscribe_token ?? '',
      },
      agent: {
        first_name: agent.first_name,
        last_name: agent.last_name,
        email: agent.email,
        phone: agent.phone,
      },
    };

    let status: 'sent' | 'failed' | 'skipped' = 'sent';
    let providerId: string | null = null;
    let errorMessage: string | null = null;
    let subjectRendered = '';
    let bodyPreview = '';

    try {
      if (campaign.type === 'email') {
        if (!client.email) {
          status = 'skipped';
          errorMessage = 'No email address';
        } else {
          subjectRendered = applyMergeFields(campaign.email_subject || '', ctx);
          const renderedBody = applyMergeFields(campaign.email_body || '', ctx);
          bodyPreview = renderedBody.replace(/<[^>]*>/g, '').slice(0, 200);

          // Use sender agent's email as reply-to if they have one
          const replyTo = agent.email && agent.email !== 'info@fairoaksrealtygroup.com'
            ? `${agent.first_name} ${agent.last_name} <${agent.email}>`
            : undefined;

          const emailResult = await resend.emails.send({
            from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
            to: client.email,
            subject: subjectRendered,
            html: renderedBody,
            ...(replyTo ? { reply_to: replyTo } : {}),
          });
          providerId = emailResult.data?.id ?? null;
        }
      } else if (campaign.type === 'sms') {
        const toPhone = client.cell_phone || client.phone;
        if (!toPhone) {
          status = 'skipped';
          errorMessage = 'No mobile number';
        } else if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
          status = 'skipped';
          errorMessage = 'Twilio not configured';
        } else {
          // SMS via Twilio — skipped until Twilio is configured
          status = 'skipped';
          errorMessage = 'SMS not yet configured — add Twilio credentials to enable';
        }
      }
    } catch (err: any) {
      status = 'failed';
      errorMessage = err?.message ?? String(err);
    }

    // Log the send
    await supabase.from('crm_campaign_sends').insert([{
      campaign_id: campaign.id,
      client_id: client.id,
      enrollment_id: enrollment.id,
      type: campaign.type,
      status,
      provider_id: providerId,
      error_message: errorMessage,
      subject: subjectRendered || null,
      body_preview: bodyPreview || null,
    }]);

    // Advance next_send_at — for one-time campaigns, deactivate the enrollment
    const nextSend = computeNextSend(campaign.frequency);
    if (campaign.frequency === 'one-time') {
      await supabase.from('crm_campaign_enrollments').update({ active: false, next_send_at: null }).eq('id', enrollment.id);
      // Also pause the campaign itself so it doesn't re-trigger
      await supabase.from('crm_campaigns').update({ status: 'paused' }).eq('id', campaign.id);
    } else {
      await supabase.from('crm_campaign_enrollments').update({ next_send_at: nextSend }).eq('id', enrollment.id);
    }

    if (status === 'sent') sent++;
    else if (status === 'failed') failed++;
  }

  return NextResponse.json({ processed: enrollments.length, sent, failed });
}
