import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized, forbidden } from '@/lib/crm-auth';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { createClient } from '@supabase/supabase-js';
import { resolveSignature, withSignature } from '@/lib/agent-signature';
import { chicagoToday } from '@/lib/chicago-time';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

interface GmailConnection {
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
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

    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
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
          await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
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

// RFC 2047: a header with non-ASCII characters (an en dash in "Letter of Intent – 6609 Blanco Rd.",
// an accented name) must be encoded, or Gmail reads the raw UTF-8 bytes as Latin-1 and shows "Ã¢Â€Â“".
function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
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
      `Content-Type: ${att.mimeType}; name="${att.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.name}"`,
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
    const caller = await getCrmUser(req);
    if (!caller) return unauthorized();

    const { userId, dealId, clientId, to: toRaw, cc: ccRaw, individual: individualRaw, subject, body, agentName, ccAgentIds, threadId, inReplyTo, attachments } = await req.json();
    // One group email: any number of To and Cc people on the same message, so everyone
    // sees the thread and can reply-all. Per-person open tracking isn't possible then —
    // the single pixel can't say which recipient loaded it.
    const EMAIL_RE = /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/;
    const addrList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,;]/))
      .map(x => x.replace(/[\r\n]/g, ' ').trim()).filter(Boolean);
    const toList = addrList(toRaw);
    const ccList = addrList(ccRaw).filter(a => !toList.some(t => t.toLowerCase() === a.toLowerCase()));
    const badAddr = [...toList, ...ccList].find(a => !EMAIL_RE.test(a));
    if (badAddr) return NextResponse.json({ error: `"${badAddr}" isn't a valid email address` }, { status: 400 });
    if (toList.length + ccList.length > 20) return NextResponse.json({ error: 'Too many recipients (20 max)' }, { status: 400 });
    const to = toList.join(', ');
    if (!userId || (!dealId && !clientId) || !to || !subject || !body) {
      return NextResponse.json({ error: 'userId, (dealId or clientId), to, subject, body are required' }, { status: 400 });
    }
    if (caller.id !== userId) return forbidden('Cannot access another user\'s Gmail connection');

    const attList: Attachment[] = Array.isArray(attachments) ? attachments : [];

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
      const scope = dealId ? `deal_id=eq.${dealId}` : `client_id=eq.${clientId}`;
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

    const fromLine = agentName ? `${encodeHeader(agentName)} <${gmailEmail}>` : gmailEmail;
    const plainBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    const emailDate = chicagoToday();

    // One Gmail send + one logged row. Each copy carries its OWN tracking id, so a copy
    // addressed to a single person makes an open attributable to that person.
    const sendCopy = async (opts: { toHeader: string; ccHeader?: string; replyTo?: string; note?: string; tid: string }) => {
      const pixel = `<img src="https://www.fairoaksrealtygroup.com/api/track/open?id=${opts.tid}" width="1" height="1" style="display:none" />`;
      const html = `${opts.note ?? ''}${outBody}${pixel}`;
      const headerLines = [
        `From: ${fromLine}`,
        `To: ${opts.toHeader}`,
        ...(opts.ccHeader ? [`Cc: ${opts.ccHeader}`] : []),
        ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
        `Subject: ${encodeHeader(finalSubject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
      ];
      const encoded = Buffer.from(buildMimeEmail(headerLines, html, attList)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const sendBody: Record<string, string> = { raw: encoded };
      if (threadId) sendBody.threadId = threadId;
      const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(sendBody),
      });
      const sendData = await sendRes.json();
      if (!sendRes.ok) throw new Error(sendData.error?.message ?? 'Gmail send failed');
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
          gmail_thread_id: threadId ?? sendData.threadId ?? null,
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
    const individual = individualRaw === true && everyone.length > 1;
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
        emailId = await sendCopy({ toHeader: to, ccHeader: ccList.length ? ccList.join(', ') : undefined, tid: trackingId });
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

    return NextResponse.json({ success: true, emailId, copies: individual ? everyone.length : 1 });
  } catch (err) {
    console.error('Gmail send error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
