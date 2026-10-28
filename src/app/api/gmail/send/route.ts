import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, forbidden, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { createClient } from '@supabase/supabase-js';
import { resolveSignature, withSignature } from '@/lib/agent-signature';
import { chicagoToday } from '@/lib/chicago-time';
import { attachmentParam, encodeHeader, formatAddress, stripLineBreaks } from '@/lib/mime-header';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_TYPE_RE = /^[\w.+-]+\/[\w.+-]+$/;
const MESSAGE_ID_RE = /^<[^<>\s]+>$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_B64 = 20_000_000;   // per file, base64 chars (~15 MB)
const MAX_TOTAL_B64 = 33_000_000;        // all files together (~25 MB, Gmail's message limit)

interface GmailConnection {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string;
}

async function getValidConnection(
  userId: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<{ accessToken: string; agentEmail: string | null } | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  const rows: GmailConnection[] = await res.json();
  if (!rows || rows.length === 0) return null;

  const conn = rows[0];
  const expiresAt = new Date(conn.expires_at).getTime();
  let accessToken = decryptToken(conn.access_token);

  if (Date.now() >= expiresAt - 120_000) {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: decryptToken(conn.refresh_token),
        grant_type: 'refresh_token',
      }),
    });

    const refreshed = await refreshRes.json();
    if (!refreshRes.ok || !refreshed.access_token) return null;

    accessToken = refreshed.access_token;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

    // Scoped to the exact row we read: a user can hold several Gmail connections, and patching by
    // user_id alone wrote this account's token over all of them.
    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${encodeURIComponent(conn.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ access_token: encryptToken(accessToken), expires_at: newExpiry, updated_at: new Date().toISOString() }),
    });
  }

  let agentEmail: string | null = conn.email ?? null;
  if (!agentEmail) {
    try {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        agentEmail = profile.emailAddress ?? null;
        if (agentEmail) {
          await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${encodeURIComponent(conn.id)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: anonKey,
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ email: agentEmail }),
          });
        }
      }
    } catch {
      // non-fatal
    }
  }

  return { accessToken, agentEmail };
}

interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

function buildMimeEmail(headers: string[], htmlBody: string, attachments: Attachment[]): string {
  if (!attachments.length) {
    return [...headers, '', htmlBody].join('\r\n');
  }

  const boundary = `==boundary_${crypto.randomUUID().replace(/-/g, '')}`;

  // Replace Content-Type header with multipart/mixed
  const baseHeaders = headers.filter(h => !h.toLowerCase().startsWith('content-type:'));
  baseHeaders.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const parts: string[] = [
    ...baseHeaders,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ];

  for (const att of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; ${attachmentParam('name', att.name)}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${attachmentParam('filename', att.name)}`,
      '',
      // chunk base64 into 76-char lines per RFC 2045
      att.data.match(/.{1,76}/g)?.join('\r\n') ?? att.data,
    );
  }

  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

export async function POST(req: NextRequest) {
  try {
    // Auth first, before the body is even inspected: an anonymous caller should get
    // 401, not a 400 telling them which fields this endpoint wants.
    //
    // getCrmUser(req), not getCrmUser(): the copilot calls this route server-to-server
    // with the agent's Bearer token and no cookies, so the cookie-only form could never
    // authenticate it — send_email failed with a misleading "connect Gmail in Settings".
    const ctx = await getCrmContext(req);
    if (!ctx) return unauthorized();
    const caller = { id: ctx.userId };

    const { userId, dealId, clientId: clientIdIn, to: toRaw, cc: ccRaw, bcc: bccRaw, toName, resolveClient, individual: individualRaw, subject, body, agentName, ccAgentIds, threadId: threadIdRaw, inReplyTo: inReplyToRaw, attachments } = await req.json();
    let clientId: string | undefined = clientIdIn;
    // One group email: any number of To and Cc people on the same message, so everyone
    // sees the thread and can reply-all. Per-person open tracking isn't possible then —
    // the single pixel can't say which recipient loaded it.
    const EMAIL_RE = /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/;
    const addrList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,;]/))
      .map(x => x.replace(/[\r\n]/g, ' ').trim()).filter(Boolean);
    const toList = addrList(toRaw);
    const ccList = addrList(ccRaw).filter(a => !toList.some(t => t.toLowerCase() === a.toLowerCase()));
    const bccList = addrList(bccRaw).filter(a => !toList.some(t => t.toLowerCase() === a.toLowerCase()) && !ccList.some(c => c.toLowerCase() === a.toLowerCase()));
    const badAddr = [...toList, ...ccList, ...bccList].find(a => !EMAIL_RE.test(a));
    if (badAddr) return NextResponse.json({ error: `"${badAddr}" isn't a valid email address` }, { status: 400 });
    if (toList.length + ccList.length + bccList.length > 20) return NextResponse.json({ error: 'Too many recipients (20 max)' }, { status: 400 });
    const to = toList.join(', ');
    // resolveClient: "write to anyone" from the global Compose window — link the email to the matching CRM
    // contact (or make one) so it is still logged, tracked and shows on that contact's card.
    if (!userId || (!dealId && !clientId && resolveClient !== true) || !to || !subject || !body) {
      return NextResponse.json({ error: 'userId, (dealId or clientId), to, subject, body are required' }, { status: 400 });
    }
    if (caller.id !== userId) return forbidden('Cannot access another user\'s Gmail connection');

    if (!dealId && !clientId && resolveClient === true) {
      const db = adminClient();
      const wanted = toList.map(a => a.toLowerCase());
      const { data: found } = await db.from('crm_clients').select('id, email, business_unit').in('email', wanted).limit(20);
      const visible = (found ?? []).filter(r => ctx.role === 'admin' || ctx.role === 'super_admin' || !ctx.businessUnit || r.business_unit === ctx.businessUnit);
      const hit = wanted.map(w => visible.find(r => (r.email ?? '').toLowerCase() === w)).find(Boolean);
      if (hit) {
        clientId = hit.id as string;
      } else {
        const display = (typeof toName === 'string' && toName.trim()) || toList[0].split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
        const parts = display.trim().split(/\s+/);
        const { data: made, error: madeErr } = await db.from('crm_clients').insert([{
          first_name: parts[0] ?? display, last_name: parts.slice(1).join(' '), email: toList[0].toLowerCase(), phone: '',
          type: 'Other', notes: '', agent_id: userId, assigned_agent_ids: [], lead_source: 'Emailed from the CRM',
          prospect_status: 'new', business_unit: ctx.businessUnit ?? 'commercial', tags: [], unsubscribe_token: crypto.randomUUID(),
        }]).select('id').single();
        if (madeErr || !made) {
          console.error('[gmail/send] could not create a contact for', toList[0], madeErr?.message);
          return NextResponse.json({ error: 'Could not file this email under a contact. Try sending it from a contact or deal card.' }, { status: 500 });
        }
        clientId = made.id as string;
      }
    }

    // dealId / clientId go into a service-role REST URL and onto the logged row: they must be real UUIDs,
    // and the deal / client must be in the caller's workspace (and the deal visible to them).
    if (dealId && (typeof dealId !== 'string' || !UUID_RE.test(dealId))) return NextResponse.json({ error: 'dealId is invalid' }, { status: 400 });
    if (clientId && (typeof clientId !== 'string' || !UUID_RE.test(clientId))) return NextResponse.json({ error: 'clientId is invalid' }, { status: 400 });
    if (dealId && !(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
    if (clientId && !(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Client not found');

    // Threading headers come from the client: keep only well-formed Message-IDs (no whitespace or CR/LF,
    // so a crafted value can't add a Bcc: or other header).
    const refIds = (Array.isArray(inReplyToRaw) ? inReplyToRaw.map(String) : typeof inReplyToRaw === 'string' ? stripLineBreaks(inReplyToRaw).split(/\s+/) : [])
      .filter(Boolean).slice(0, 20)
      .map(id => (/^[^<>\s]+$/.test(id) ? `<${id}>` : id))
      .filter(id => MESSAGE_ID_RE.test(id) && id.length <= 998);
    const inReplyTo = refIds.length ? refIds[refIds.length - 1] : '';
    const threadId = typeof threadIdRaw === 'string' && /^[\w-]{1,64}$/.test(threadIdRaw) ? threadIdRaw : undefined;

    // Attachments: validated type, base64 payload, capped size. Names are stripped of line breaks
    // (attachmentParam also quotes them).
    if (attachments !== undefined && attachments !== null && !Array.isArray(attachments)) return NextResponse.json({ error: 'attachments is invalid' }, { status: 400 });
    if (Array.isArray(attachments) && attachments.length > MAX_ATTACHMENTS) return NextResponse.json({ error: `Too many attachments (${MAX_ATTACHMENTS} max)` }, { status: 400 });
    const attList: Attachment[] = [];
    let totalB64 = 0;
    for (const a of (Array.isArray(attachments) ? attachments : []) as Partial<Attachment>[]) {
      const data = typeof a?.data === 'string' ? a.data.replace(/\s+/g, '') : '';
      if (!data || data.length % 4 !== 0 || !BASE64_RE.test(data)) return NextResponse.json({ error: 'An attachment is not valid base64 data' }, { status: 400 });
      totalB64 += data.length;
      if (data.length > MAX_ATTACHMENT_B64 || totalB64 > MAX_TOTAL_B64) return NextResponse.json({ error: 'Attachments are too large' }, { status: 413 });
      attList.push({
        name: stripLineBreaks(String(a?.name ?? 'attachment')).slice(0, 255) || 'attachment',
        mimeType: typeof a?.mimeType === 'string' && MIME_TYPE_RE.test(a.mimeType) ? a.mimeType : 'application/octet-stream',
        data,
      });
    }

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const connection = await getValidConnection(userId, anonKey, serviceRoleKey);
    if (!connection) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
    const { accessToken, agentEmail } = connection;

    const gmailEmail = agentEmail ?? '';
    const trackingId = crypto.randomUUID();

    // Prefix subject with Re: if replying and not already prefixed.
    const finalSubject = inReplyTo && !subject.startsWith('Re:') ? `Re: ${subject}` : subject;

    // Duplicate-send guard: if the IDENTICAL email (same recipient, subject and body) to
    // this contact/deal already went out in the last 10 minutes, don't send it again. Stops
    // the Copilot re-calling send_email and plain UI double-clicks from double-emailing.
    {
      const incomingPlain = String(body).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
      const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const scope = dealId ? `deal_id=eq.${encodeURIComponent(dealId)}` : `client_id=eq.${encodeURIComponent(clientId as string)}`;
      const recentRes = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_deal_emails?${scope}&direction=eq.sent&created_at=gte.${sinceIso}&select=to_email,subject,body`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` } },
      );
      const recent = await recentRes.json().catch(() => []);
      if (Array.isArray(recent) && recent.some((e: { to_email?: string; subject?: string; body?: string }) =>
        (e.to_email ?? '') === to && (e.subject ?? '') === finalSubject && (e.body ?? '') === incomingPlain)) {
        return NextResponse.json({ error: 'This exact email was just sent to this recipient a moment ago — it was not sent again.', duplicate: true }, { status: 409 });
      }
    }

    // Look up CC agent emails (exclude the sender)
    let ccEmails: string[] = [];
    if (ccAgentIds?.length) {
      // Validate each ID is a well-formed UUID before interpolating into URL
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids = (ccAgentIds as string[])
        .filter(id => id !== userId && UUID_RE.test(id));
      if (ids.length) {
        const profilesRes = await fetch(
          `${SUPABASE_URL}/rest/v1/crm_profiles?id=in.(${ids.join(',')})&select=email`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` } }
        );
        const profiles: { email: string }[] = await profilesRes.json();
        ccEmails = profiles.map(p => p.email).filter(Boolean);
      }
    }

    // The compose box appends the signature itself; Copilot and other API callers don't.
    // withSignature() is a no-op when it's already there. Stored/guarded text stays `body`.
    const sigDb = createClient(SUPABASE_URL, serviceRoleKey);
    const outBody = withSignature(body, await resolveSignature(sigDb, { agentId: userId }));

    // The display name is the caller's own CRM profile name, never a body value (it could spoof anyone).
    const { data: prof } = await sigDb.from('crm_profiles').select('first_name, last_name').eq('id', userId).maybeSingle();
    const profileName = `${prof?.first_name ?? ''} ${prof?.last_name ?? ''}`.trim();
    const fromLine = formatAddress(profileName || (typeof agentName === 'string' ? agentName : ''), gmailEmail);
    const plainBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    const emailDate = chicagoToday();

    // One Gmail send + one logged row. Each copy carries its OWN tracking id, so a copy
    // addressed to a single person makes an open attributable to that person.
    const sendCopy = async (opts: { toHeader: string; ccHeader?: string; bccHeader?: string; replyTo?: string; note?: string; tid: string }) => {
      const pixel = `<img src="https://www.fairoaksrealtygroup.com/api/track/open?id=${opts.tid}" width="1" height="1" style="display:none" />`;
      const html = `${opts.note ?? ''}${outBody}${pixel}`;
      const headerLines = [
        `From: ${fromLine}`,
        `To: ${opts.toHeader}`,
        ...(opts.ccHeader ? [`Cc: ${opts.ccHeader}`] : []),
        ...(opts.bccHeader ? [`Bcc: ${opts.bccHeader}`] : []),
        ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
        `Subject: ${encodeHeader(finalSubject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${refIds.join(' ')}`] : []),
      ];
      const encoded = Buffer.from(buildMimeEmail(headerLines, html, attList)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const sendBody: Record<string, string> = { raw: encoded };
      if (threadId) sendBody.threadId = threadId;
      const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(sendBody),
      });
      const sendData = await sendRes.json();
      if (!sendRes.ok) throw new Error(sendData.error?.message ?? 'Gmail send failed');
      // Gmail assigns the Message-ID: keep it so a follow-up to this email (not just to a received one)
      // threads for the recipient too (In-Reply-To / References).
      let sentMessageId: string | null = null;
      try {
        const meta = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${sendData.id}?format=metadata&metadataHeaders=Message-ID`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (meta.ok) sentMessageId = ((await meta.json()).payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === 'message-id')?.value ?? null;
      } catch { /* threading still works by Gmail thread id */ }
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_deal_emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}`, Prefer: 'return=representation' },
        body: JSON.stringify({
          ...(dealId ? { deal_id: dealId } : {}),
          ...(clientId ? { client_id: clientId } : {}),
          direction: 'sent',
          from_email: gmailEmail,
          to_email: opts.toHeader,
          subject: finalSubject,
          body: plainBody,
          email_date: emailDate,
          gmail_message_id: sendData.id,
          tracking_id: opts.tid,
          tracked: true, // carries the pixel above (Gmail-synced rows get a default tracking_id but no pixel)
          gmail_thread_id: threadId ?? sendData.threadId ?? null,
          ...(sentMessageId ? { rfc_message_id: sentMessageId } : {}),
          ...(opts.ccHeader ? { cc_emails: opts.ccHeader } : {}),
        }),
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text();
        console.error('Failed to insert sent email:', errText);
        throw new Error('Email sent but failed to log: ' + errText);
      }
      const inserted = await insertRes.json();
      return Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
    };

    // Individual copies (per-person open tracking): everyone gets their own message, but
    // Reply-To lists the whole group + you, so Reply / Reply-all still reaches everybody.
    const everyone = [...toList, ...ccList];
    // A Bcc can't ride along with separate per-person copies (each copy would expose who else got one), so Bcc means one shared message.
    const individual = individualRaw === true && everyone.length > 1 && bccList.length === 0;
    let emailId: string | undefined;
    try {
      if (individual) {
        const replyAll = Array.from(new Set([...everyone, gmailEmail].filter(Boolean))).join(', ');
        const note = `<div style="font-size:12px;color:#6b7280;margin-bottom:14px">Sent to ${everyone.map(a => a.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join(', ')} — reply to include everyone.</div>`;
        for (let k = 0; k < everyone.length; k++) {
          const id = await sendCopy({ toHeader: everyone[k], replyTo: replyAll, note, tid: k === 0 ? trackingId : crypto.randomUUID() });
          if (k === 0) emailId = id;
        }
      } else {
        emailId = await sendCopy({ toHeader: to, ccHeader: ccList.length ? ccList.join(', ') : undefined, bccHeader: bccList.length ? bccList.join(', ') : undefined, tid: trackingId });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gmail send failed';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Separate copy to the CC'd agents — NO tracking pixel so only the client's open counts.
    if (ccEmails.length) {
      const ccNoticeBody = `
        <div style="background:#f3f4f6;border-left:4px solid #c9922c;padding:10px 16px;margin-bottom:20px;font-family:sans-serif;font-size:13px;color:#374151;">
          <strong>FYI:</strong> You were copied on this email sent to <strong>${to}</strong>.
        </div>
        ${outBody}
      `;
      for (const ccEmail of ccEmails) {
        const ccHeaders = [
          `From: ${fromLine}`,
          `To: ${ccEmail}`,
          `Subject: ${encodeHeader(`[Copy] ${subject}`)}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=utf-8',
        ];
        const ccRaw = buildMimeEmail(ccHeaders, ccNoticeBody, attList);
        const ccEncoded = Buffer.from(ccRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        // Fire and forget — don't block on CC delivery
        fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: ccEncoded }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, emailId, clientId, copies: individual ? everyone.length : 1 });
  } catch (err) {
    console.error('Gmail send error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
