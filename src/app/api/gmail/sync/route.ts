import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, forbidden } from '@/lib/crm-auth';
import { decryptToken, encryptToken } from '@/lib/token-crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

interface GmailConnection {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string; // stored agent email, if available
}

/** Returns a valid access token + agentEmail for a single GmailConnection row, refreshing if needed. */
async function resolveConnection(conn: GmailConnection, userId: string, anonKey: string, serviceRoleKey: string): Promise<{ accessToken: string; agentEmail: string | null } | null> {
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
    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}&email=eq.${encodeURIComponent(conn.email ?? '')}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
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
      }
    } catch { /* non-fatal */ }
  }

  return { accessToken, agentEmail };
}

/** Returns all valid Gmail connections for a user. */
async function getAllConnections(userId: string, anonKey: string, serviceRoleKey: string): Promise<Array<{ accessToken: string; agentEmail: string | null }>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}&order=created_at.desc`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
  });
  const rows: GmailConnection[] = await res.json();
  if (!rows || rows.length === 0) return [];
  const results = await Promise.all(rows.map(r => resolveConnection(r, userId, anonKey, serviceRoleKey)));
  return results.filter((r): r is { accessToken: string; agentEmail: string | null } => r !== null);
}

/** How many Gmail connection rows a user has (regardless of token validity). Lets us
 *  tell "never connected" apart from "connected but the token expired/was revoked". */
async function countConnections(userId: string, anonKey: string, serviceRoleKey: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}&select=id`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64(part.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return '';
}

function cleanBody(raw: string): string {
  const lines = raw.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    // Stop at quoted reply blocks
    if (t.startsWith('>')) continue;
    // Stop at "On [date] ... wrote:" reply markers
    if (/^On .{5,120} wrote:$/.test(t)) break;
    // Stop at dividers that typically precede signatures/footers
    if (/^[-_]{3,}/.test(t)) break;
    // Stop at confidentiality/legal disclaimers
    if (/^CONFIDENTIALITY NOTICE/i.test(t)) break;
    if (/^This (e-?mail|message) (message |communication )?(is intended|may contain)/i.test(t)) break;
    // Stop at common signature starters
    if (/^(Thanks,?|Thank you,?|Best,?|Regards,?|Sincerely,?|Cheers,?)$/i.test(t)) {
      result.push(line); // keep the sign-off line
      break;
    }
    result.push(line);
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function POST(req: NextRequest) {
  try {
    const { dealId, clientId, clientEmail } = await req.json();
    if ((!dealId && !clientId) || !clientEmail) {
      return NextResponse.json({ error: '(dealId or clientId) and clientEmail required' }, { status: 400 });
    }

    const ctx = await getCrmContext(req);
    if (!ctx) return unauthorized();

    // Authorize by DEAL/CONTACT access, not Gmail ownership. Anyone who can READ a
    // deal's emails (its agent, same-workspace teammates, or an admin — the same set
    // RLS grants SELECT to) may refresh them. The mailbox we actually search — the
    // deal/contact owner's, which holds the thread with the client — is derived from
    // the row itself, never trusted from the request. The Gmail query is scoped to
    // from:/to: the client, so no unrelated mail is ever exposed.
    let ownerId: string;
    if (dealId) {
      const deal = await assertOwnsResource('crm_deals', dealId, ctx, { ownerColumns: ['agent_id'], requireOwner: false });
      if (!deal) return forbidden('You do not have access to this deal');
      ownerId = (deal.agent_id as string | null) ?? ctx.userId;
    } else {
      const client = await assertOwnsResource('crm_clients', clientId, ctx, { ownerColumns: ['agent_id'], requireOwner: false });
      if (!client) return forbidden('You do not have access to this contact');
      ownerId = (client.agent_id as string | null) ?? ctx.userId;
    }
    const callerId = ctx.userId;

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Search the deal/contact owner's Gmail (holds the client thread), plus — when the
    // caller is a teammate rather than the owner — the caller's own accounts too, in
    // case they also corresponded with the client directly.
    const ownerConns = await getAllConnections(ownerId, anonKey, serviceRoleKey);
    const callerConns = callerId !== ownerId ? await getAllConnections(callerId, anonKey, serviceRoleKey) : [];
    const allConns = [...ownerConns, ...callerConns];
    if (allConns.length === 0) {
      // Distinguish "never connected" from "connected but token expired/revoked" so the
      // toast tells the user to reconnect rather than showing a confusing generic error.
      const rawRows = await countConnections(ownerId, anonKey, serviceRoleKey)
        + (callerId !== ownerId ? await countConnections(callerId, anonKey, serviceRoleKey) : 0);
      return NextResponse.json({
        error: rawRows > 0
          ? 'Gmail connection expired — reconnect your Google account in Settings, then sync again.'
          : 'Gmail not connected',
      }, { status: 401 });
    }

    // Search every connected Gmail account and aggregate message stubs
    const query = encodeURIComponent(`from:${clientEmail} OR to:${clientEmail}`);
    // Map of gmailMsgId → { conn, msgId } so we know which token to use when fetching full message
    const msgConnMap = new Map<string, { accessToken: string; agentEmail: string | null }>();
    for (const conn of allConns) {
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=100`,
        { headers: { Authorization: `Bearer ${conn.accessToken}` } }
      );
      const listData = await listRes.json();
      for (const msg of listData.messages ?? []) {
        if (!msgConnMap.has(msg.id)) msgConnMap.set(msg.id, conn);
      }
    }
    if (msgConnMap.size === 0) return NextResponse.json({ synced: 0 });

    // Fetch already-synced IDs for this deal/contact to avoid duplicates
    // Check both gmail_message_id (per-account) and rfc_message_id (universal) so two
    // agents syncing the same deal don't create duplicate entries for the same email.
    const scopeFilter = dealId ? `deal_id=eq.${dealId}` : `client_id=eq.${clientId}`;
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_deal_emails?${scopeFilter}&select=gmail_message_id,rfc_message_id`,
      { headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    const existing = await existingRes.json();
    const existingMsgIds = new Set(
      (existing || []).map((e: any) => e.gmail_message_id).filter(Boolean)
    );
    const existingRfcIds = new Set(
      (existing || []).map((e: any) => e.rfc_message_id).filter(Boolean)
    );

    let synced = 0;
    for (const [msgId, conn] of msgConnMap) {
      if (existingMsgIds.has(msgId)) continue;
      // rfc_message_id check happens after fetching headers below

      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers: { Authorization: `Bearer ${conn.accessToken}` } }
      );
      const msgData = await msgRes.json();
      if (!msgRes.ok) continue;

      const headers = msgData.payload?.headers || [];
      const get = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const from = get('From');
      const to = get('To');
      const subject = get('Subject') || '(no subject)';
      const dateStr = get('Date');
      const rfcMsgId = get('Message-ID') || null;
      const body = extractBody(msgData.payload);

      // Skip if another agent already synced this exact email (same rfc_message_id)
      if (rfcMsgId && existingRfcIds.has(rfcMsgId)) continue;

      const fromLower = from.toLowerCase();
      const toLower = to.toLowerCase();
      const ccLower = get('Cc').toLowerCase();
      const clientLower = clientEmail.toLowerCase();

      // Check if client appears anywhere in From, To, or Cc
      const clientInFrom = fromLower.includes(clientLower);
      const clientInTo = toLower.includes(clientLower);
      const clientInCc = ccLower.includes(clientLower);
      if (!clientInFrom && !clientInTo && !clientInCc) continue;

      // email_date column is type 'date' — use YYYY-MM-DD only
      const emailDate = dateStr ? new Date(dateStr).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const direction = clientInFrom ? 'received' : 'sent';

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_deal_emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          gmail_message_id: msgId,
          ...(dealId ? { deal_id: dealId } : {}),
          ...(clientId ? { client_id: clientId } : {}),
          direction,
          from_email: from,
          to_email: to,
          subject,
          body: cleanBody(body).slice(0, 4000),
          email_date: emailDate,
          gmail_thread_id: msgData.threadId ?? null,
          rfc_message_id: get('Message-ID') || null,
        }),
      });

      if (insertRes.ok || insertRes.status === 201) synced++;
      else {
        const errText = await insertRes.text();
        console.error(`Failed to insert email ${msgId}:`, errText);
      }
    }

    return NextResponse.json({ synced });
  } catch (err) {
    console.error('Gmail sync error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
