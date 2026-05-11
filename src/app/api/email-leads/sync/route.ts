import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = () => createClient(SUPABASE_URL, SERVICE_KEY);

// ── Lead source config ──────────────────────────────────────────────────────
const LEAD_SOURCES: { domain: string; source: string; business_unit: string }[] = [
  { domain: 'loopnet.com',   source: 'LoopNet',     business_unit: 'commercial'   },
  { domain: 'crexi.com',     source: 'Crexi',       business_unit: 'commercial'   },
  { domain: 'costar.com',    source: 'CoStar',      business_unit: 'commercial'   },
  { domain: '42floors.com',  source: '42Floors',    business_unit: 'commercial'   },
  { domain: 'zillow.com',    source: 'Zillow',      business_unit: 'residential'  },
  { domain: 'realtor.com',   source: 'Realtor.com', business_unit: 'residential'  },
  { domain: 'move.com',      source: 'Realtor.com', business_unit: 'residential'  },
];

function detectSource(from: string): typeof LEAD_SOURCES[0] | null {
  const f = from.toLowerCase();
  return LEAD_SOURCES.find(s => f.includes(s.domain)) ?? null;
}

// ── Universal email body parser ─────────────────────────────────────────────
function extract(body: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = body.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return '';
}

function htmlToText(html: string): string {
  return html
    // Block-level elements → newlines (before closing tags so label stays on its own line)
    .replace(/<\/?(tr|div|section|article|header|footer|h[1-6]|ul|ol|blockquote)[^>]*>/gi, '\n')
    .replace(/<\/?(p|li)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Table cells: close tags get a space so "Name:</td><td>John" → "Name: John"
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<t[dh][^>]*>/gi, '')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '—')
    // Collapse whitespace but preserve newlines
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseLeadEmail(subject: string, body: string) {
  const text = htmlToText(body);

  // First Name + Last Name (LoopNet style)
  const firstName = extract(text, [
    /(?:^|\n)\s*first\s*name[:\s]+([A-Za-z][^\n]{1,30})/im,
  ]);
  const lastName = extract(text, [
    /(?:^|\n)\s*last\s*name[:\s]+([A-Za-z][^\n]{1,30})/im,
  ]);

  // Full name from various label patterns or contextual phrases
  const nameFromBody = extract(text, [
    // Explicit full-name labels
    /(?:^|\n)\s*(?:full\s*name|contact\s*name|name|buyer\s*name|tenant\s*name|prospect\s*name|sender\s*name)[:\s]+([A-Za-z][^\n]{2,50})/im,
    // "John Smith has submitted/sent/is interested..."
    /(?:^|\n)([A-Za-z][A-Za-z\s'\-]{4,40})\s+(?:has\s+submitted|is\s+interested|sent\s+you|would\s+like|wants\s+to|inquired)/im,
    // Crexi often puts name as the first non-blank line before email/phone block
    /(?:^|\n)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\n\s*[\w.+\-]+@/im,
  ]);

  // Compose full name
  let fullName = '';
  if (firstName || lastName) {
    fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  } else if (nameFromBody) {
    fullName = nameFromBody.trim();
  }

  // Fallback: try subject line
  if (!fullName) {
    fullName = extract(subject, [
      /(?:new\s+lead[:\s\-]+|lead\s+from[:\s]+|inquiry\s+from[:\s]+|contact\s+from[:\s]+)([A-Za-z][^\-–|]{3,40})(?:\s*[\-–|]|\s+(?:for|re:|regarding|is\s+interested)|$)/i,
      /^([A-Za-z][A-Za-z\s'\-]{4,40})\s+(?:is\s+interested|inquired|sent|submitted)/i,
    ]);
  }

  const email = extract(text, [
    /(?:^|\n)\s*(?:email\s*address|e[-\s]?mail)[:\s]+([\w.+\-]+@[\w.\-]+\.[a-z]{2,})/im,
    /([\w.+\-]+@[\w.\-]+\.[a-z]{2,})/i,
  ]);

  const phone = extract(text, [
    /(?:^|\n)\s*(?:phone|mobile|cell|telephone|tel)[:\s]+([\d\s().+\-]{7,20})/im,
    /((?:\+1\s?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/,
  ]);

  const property = extract(text, [
    /(?:^|\n)\s*(?:property\s+of\s+interest|property\s+address|property|listing|inquiring\s+about|interested\s+in)[:\s]+([^\n]{5,120})/im,
    /(?:subject)[:\s]*.*?(?:for|regarding|re:)\s+([^\n]{5,120})/i,
  ]) || subject.replace(/^(new\s+lead|new\s+inquiry|contact\s+info\s+for|lead\s+from)[:\s\-]*/i, '').trim();

  const message = extract(text, [
    /(?:^|\n)\s*(?:message|comments?|notes?|additional\s+info|questions?)[:\s]+([^\n]{5,500})/im,
    /(?:i['']m\s+interested|i\s+am\s+interested|please\s+contact|i\s+would\s+like)[^\n]{5,300}/i,
  ]);

  const company = extract(text, [
    /(?:^|\n)\s*(?:company|firm|organization|brokerage|business)[:\s]+([^\n]{2,80})/im,
  ]);

  return { fullName, email, phone, property, message, company };
}

// ── Gmail token refresh ──────────────────────────────────────────────────────
async function getValidToken(conn: { id: string; access_token: string; refresh_token: string; expires_at: string }): Promise<string | null> {
  if (Date.now() < new Date(conn.expires_at).getTime() - 120_000) return conn.access_token;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: conn.refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;

  await db().from('gmail_connections').update({
    access_token: data.access_token,
    expires_at:   new Date(Date.now() + data.expires_in * 1000).toISOString(),
    updated_at:   new Date().toISOString(),
  }).eq('id', conn.id);

  return data.access_token;
}

// ── Gmail API helpers ────────────────────────────────────────────────────────
async function gmailSearch(token: string, query: string): Promise<string[]> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.messages ?? []).map((m: { id: string }) => m.id);
}

async function gmailGetMessage(token: string, messageId: string) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}

function decodeBody(msg: any): string {
  // Collect all parts by mimeType, preferring text/html for richer structure
  function collectParts(payload: any, htmlParts: string[], textParts: string[]) {
    if (!payload) return;
    const mime = (payload.mimeType ?? '').toLowerCase();
    if (payload.body?.data) {
      const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      if (mime.includes('html')) htmlParts.push(decoded);
      else textParts.push(decoded);
    }
    if (payload.parts) {
      for (const part of payload.parts) collectParts(part, htmlParts, textParts);
    }
  }
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  collectParts(msg.payload, htmlParts, textParts);
  // Prefer HTML — it has the structured table/label layout that leads come in
  return htmlParts[0] ?? textParts[0] ?? '';
}

function getHeader(msg: any, name: string): string {
  return msg.payload?.headers?.find((h: { name: string; value: string }) =>
    h.name.toLowerCase() === name.toLowerCase()
  )?.value ?? '';
}

// ── Main sync logic ──────────────────────────────────────────────────────────
export async function POST() {
  try {
    const supabase = db();

    // Fetch all Gmail connections with their agent profiles
    const { data: connections } = await supabase
      .from('gmail_connections')
      .select('id, user_id, gmail_email, access_token, refresh_token, expires_at');

    if (!connections?.length) return NextResponse.json({ imported: 0 });

    // Get all agent profiles for assignment
    const { data: profiles } = await supabase
      .from('crm_profiles')
      .select('id, business_unit');

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    // Already-processed message IDs
    const { data: processed } = await supabase
      .from('email_lead_imports')
      .select('gmail_message_id');
    const processedIds = new Set((processed ?? []).map((r: any) => r.gmail_message_id));

    let totalImported = 0;

    for (const conn of connections) {
      const token = await getValidToken(conn as any);
      if (!token) continue;

      const agentProfile = profileMap.get(conn.user_id) as any;

      // Search for emails from all lead source domains
      const domains = LEAD_SOURCES.map(s => `from:${s.domain}`).join(' OR ');
      const query = `(${domains}) newer_than:7d`;
      const messageIds = await gmailSearch(token, query);

      for (const messageId of messageIds) {
        if (processedIds.has(messageId)) continue;

        const msg = await gmailGetMessage(token, messageId);
        if (!msg) continue;

        const from    = getHeader(msg, 'from');
        const subject = getHeader(msg, 'subject');
        const body    = decodeBody(msg);

        const source = detectSource(from);
        if (!source) continue;

        // Determine business_unit: source domain takes priority over agent profile
        const business_unit = source.business_unit;

        // Find the right agent to assign — prefer an agent matching the business_unit
        let agentId = conn.user_id;
        if (agentProfile && agentProfile.business_unit !== business_unit) {
          // Try to find an agent in the right business unit
          const rightAgent = (profiles ?? []).find((p: any) => p.business_unit === business_unit);
          if (rightAgent) agentId = rightAgent.id;
        }

        const parsed = parseLeadEmail(subject, body);

        // Skip if no usable contact info
        if (!parsed.email && !parsed.phone && !parsed.fullName) continue;

        // Dedup: don't create duplicate clients by email
        let clientId: string | null = null;
        if (parsed.email) {
          const { data: existing } = await supabase
            .from('crm_clients')
            .select('id')
            .eq('email', parsed.email)
            .eq('business_unit', business_unit)
            .maybeSingle();
          if (existing) clientId = existing.id;
        }

        // Create client if not already exists
        if (!clientId) {
          const nameParts = parsed.fullName.split(' ');
          const firstName = nameParts[0] ?? '';
          const lastName  = nameParts.slice(1).join(' ') ?? '';

          const clientType = business_unit === 'commercial' ? 'Tenant' : 'Buyer';

          const { data: newClient } = await supabase.from('crm_clients').insert([{
            agent_id:        agentId,
            assigned_agent_ids: [agentId],
            first_name:      firstName,
            last_name:        lastName,
            business_name:   parsed.company ?? '',
            email:            parsed.email ?? '',
            phone:            parsed.phone ?? '',
            type:             clientType,
            lead_source:      source.source,
            prospect_status:  'new',
            notes:            [
              parsed.property ? `Property: ${parsed.property}` : '',
              parsed.message  ? `Message: ${parsed.message}` : '',
            ].filter(Boolean).join('\n'),
            business_unit,
            tags:             ['auto-imported'],
          }]).select('id').single();

          clientId = newClient?.id ?? null;
        }

        // Record the import
        await supabase.from('email_lead_imports').insert([{
          gmail_message_id:   messageId,
          gmail_connection_id: conn.id,
          source:             source.source,
          business_unit,
          client_id:          clientId,
          raw_subject:        subject,
          parsed_name:        parsed.fullName,
          parsed_email:       parsed.email,
          parsed_phone:       parsed.phone,
          parsed_property:    parsed.property,
          parsed_message:     parsed.message,
        }]).select();

        processedIds.add(messageId);
        totalImported++;
      }
    }

    return NextResponse.json({ imported: totalImported, ok: true });
  } catch (err: any) {
    console.error('[email-leads/sync]', err?.message ?? err);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}

export async function GET() { return POST(); }
