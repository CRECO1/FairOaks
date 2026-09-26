import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { resolveActionPlanFrom } from '@/lib/action-plan-from';
import { newTrackingId, withOpenPixel, unsubscribeUrlFor } from '@/lib/email-tracking';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = () => createClient(SUPABASE_URL, SERVICE_KEY);

function resendClient(businessUnit: string) {
  const key = businessUnit === 'commercial'
    ? process.env.RESEND_API_KEY_COMMERCIAL!
    : process.env.RESEND_API_KEY!;
  return new Resend(key);
}

function fromAddress(businessUnit: string) {
  return businessUnit === 'commercial'
    ? 'CRECO <zack@crecotx.com>'
    : 'Fair Oaks Realty Group <info@fairoaksrealtygroup.com>';
}

function applyMergeFields(template: string, ctx: {
  client: { first_name: string; last_name: string; email: string; type: string; unsubscribe_token: string };
  agent:  { first_name: string; last_name: string; email: string; phone?: string };
}, businessUnit?: string): string {
  const unsubscribeUrl = unsubscribeUrlFor(businessUnit, ctx.client.unsubscribe_token);
  return template
    .replaceAll('{{first_name}}',    ctx.client.first_name   || '')
    .replaceAll('{{last_name}}',     ctx.client.last_name    || '')
    .replaceAll('{{full_name}}',     `${ctx.client.first_name} ${ctx.client.last_name}`.trim())
    .replaceAll('{{email}}',         ctx.client.email        || '')
    .replaceAll('{{client_type}}',   ctx.client.type         || '')
    .replaceAll('{{agent_name}}',    `${ctx.agent.first_name} ${ctx.agent.last_name}`.trim())
    .replaceAll('{{agent_email}}',   ctx.agent.email         || '')
    .replaceAll('{{agent_phone}}',   ctx.agent.phone         || '210-817-3443')
    .replaceAll('{{brokerage}}',     businessUnit === 'commercial' ? 'CRECO Commercial Real Estate Company' : 'Fair Oaks Realty Group')
    .replaceAll('{{unsubscribe_url}}', unsubscribeUrl);
}

// Auto-enroll a newly imported lead into any matching 'new_contact' action plans
// and immediately fire Step 1 so the welcome email arrives without waiting for cron.
async function autoEnrollNewContact(supabase: ReturnType<typeof db>, opts: {
  clientId:     string;
  agentId:      string;
  business_unit: string;
  property:     string;
}) {
  const { clientId, agentId, business_unit, property } = opts;

  // Fetch active plans with trigger_type = 'new_contact' for this business unit
  const { data: plans } = await supabase
    .from('crm_action_plans')
    .select('id, name, trigger_value, business_unit, from_name, from_email')
    .eq('trigger_type', 'new_contact')
    .eq('status', 'active')
    .eq('business_unit', business_unit);

  if (!plans?.length) return;

  // Fetch client info for merge fields
  const { data: client } = await supabase
    .from('crm_clients')
    .select('id, first_name, last_name, email, type, unsubscribe_token, unsubscribed_at')
    .eq('id', clientId)
    .single();

  if (!client || client.unsubscribed_at || !client.email) return;

  // Fetch agent info for merge fields
  const { data: agent } = await supabase
    .from('crm_profiles')
    .select('id, first_name, last_name, email, phone')
    .eq('id', agentId)
    .single();

  const agentCtx = agent ?? { first_name: 'Your', last_name: 'Agent', email: 'info@crecotx.com', phone: '210-817-3443' };
  // Always use CRECO contact info for commercial action plan emails
  if (business_unit === 'commercial') {
    agentCtx.email = 'info@crecotx.com';
    agentCtx.phone = '210-817-3443';
  }

  const ctx = {
    client: {
      first_name:        client.first_name        ?? '',
      last_name:         client.last_name          ?? '',
      email:             client.email              ?? '',
      type:              client.type               ?? '',
      unsubscribe_token: client.unsubscribe_token  ?? '',
    },
    agent: {
      first_name: agentCtx.first_name ?? '',
      last_name:  agentCtx.last_name  ?? '',
      email:      agentCtx.email      ?? '',
      phone:      agentCtx.phone      ?? '',
    },
  };

  const now = new Date().toISOString();

  for (const plan of plans) {
    // If the plan has a trigger_value (e.g. "Chipley"), only enroll when the
    // property text contains that keyword (case-insensitive).
    if (plan.trigger_value) {
      const keyword = plan.trigger_value.toLowerCase();
      if (!property.toLowerCase().includes(keyword)) continue;
    }

    // Enroll (upsert so re-syncing the same client doesn't re-fire)
    const { data: enrollment, error: enrollErr } = await supabase
      .from('crm_action_plan_enrollments')
      .upsert({
        plan_id:      plan.id,
        client_id:    clientId,
        agent_id:     agentId,
        active:       true,
        current_step: 0,
        next_step_at: now,
      }, { onConflict: 'plan_id,client_id', ignoreDuplicates: true })
      .select('id, current_step')
      .single();

    if (enrollErr || !enrollment) continue; // already enrolled — skip

    // Fetch Step 1
    const { data: step } = await supabase
      .from('crm_action_plan_steps')
      .select('*')
      .eq('plan_id', plan.id)
      .eq('step_order', 1)
      .single();

    if (!step) continue;

    const trackingId = newTrackingId();
    let emailSubject: string | null = null;
    try {
      if (step.type === 'email') {
        emailSubject = applyMergeFields(step.subject || `Welcome from ${plan.name}`, ctx, business_unit);
        const body   = withOpenPixel(applyMergeFields(step.body || '', ctx, business_unit), trackingId); // open-tracking pixel
        await resendClient(business_unit).emails.send({
          from:    resolveActionPlanFrom(business_unit, plan.from_name, plan.from_email, fromAddress(business_unit)),
          to:      client.email,
          subject: emailSubject,
          html:    body,
        });
      }

      // Log to activity
      await supabase.from('crm_activity').insert([{
        client_id: clientId,
        agent_id:  agentId,
        type:      'email',
        notes:     `[Action Plan: ${plan.name} — Step 1] Sent automatically on lead import`,
      }]);

      // Record the send + tracking id so the pixel can attribute opens.
      await supabase.from('crm_action_plan_sends').insert([{
        plan_id: plan.id, client_id: clientId, step_id: step.id, type: 'email',
        status: 'sent', subject: emailSubject, tracking_id: trackingId,
      }]);

      await supabase.from('crm_clients')
        .update({ last_touched_at: now })
        .eq('id', clientId);

      // Advance enrollment: check for Step 2
      const { data: nextStep } = await supabase
        .from('crm_action_plan_steps')
        .select('step_order, delay_days')
        .eq('plan_id', plan.id)
        .eq('step_order', 2)
        .single();

      if (nextStep) {
        const next_step_at = new Date(Date.now() + (nextStep.delay_days ?? 1) * 86_400_000).toISOString();
        await supabase.from('crm_action_plan_enrollments')
          .update({ current_step: 1, next_step_at })
          .eq('id', enrollment.id);
      } else {
        await supabase.from('crm_action_plan_enrollments')
          .update({ active: false, completed_at: now, next_step_at: null })
          .eq('id', enrollment.id);
      }
    } catch (err) {
      console.error(`[email-leads/sync] autoEnroll send failed for plan ${plan.id}:`, err);
    }
  }
}

// ── Lead source config ──────────────────────────────────────────────────────
const LEAD_SOURCES: { domain: string; source: string; business_unit: string; ownWebsite?: boolean }[] = [
  { domain: 'loopnet.com',              source: 'LoopNet',     business_unit: 'commercial'   },
  { domain: 'crexi.com',                source: 'Crexi',       business_unit: 'commercial'   },
  { domain: 'costar.com',               source: 'CoStar',      business_unit: 'commercial'   },
  { domain: '42floors.com',             source: '42Floors',    business_unit: 'commercial'   },
  { domain: 'zillow.com',               source: 'Zillow',      business_unit: 'residential'  },
  { domain: 'realtor.com',              source: 'Realtor.com', business_unit: 'residential'  },
  { domain: 'move.com',                 source: 'Realtor.com', business_unit: 'residential'  },
  // Own website contact forms — the automated notifier sends from noreply@<domain>. Match ONLY
  // that exact sender, never the bare domain: `from:crecotx.com` also matches every internal
  // @crecotx.com email (agents' own mail, CRM e-sign notices, call summaries, forwards, thread
  // replies), and all of it was being ingested as "leads" and flooding the Prospect pipeline.
  { domain: 'noreply@crecotx.com',             source: 'Website',     business_unit: 'commercial',  ownWebsite: true },
  { domain: 'noreply@fairoaksrealtygroup.com',  source: 'Website',     business_unit: 'residential', ownWebsite: true },
];

function detectSource(from: string): typeof LEAD_SOURCES[0] | null {
  const f = from.toLowerCase();
  return LEAD_SOURCES.find(s => f.includes(s.domain)) ?? null;
}

/**
 * Find an existing contact by email, the way the DATABASE matches them.
 *
 * crm_clients carries a unique index on (lower(email), business_unit). The
 * lookup here used `.eq('email', …)`, which is case-SENSITIVE, so a lead
 * arriving as `Todd.Finn@…` did not match a stored `todd.finn@…`. The importer
 * concluded the contact was new, inserted, and the index rejected it with
 * 23505 — and because the insert's error was never read, the lead vanished.
 * 69 contacts are stored with a non-lowercase address, so this was live.
 *
 * PostgREST cannot express `lower(email) = $1`, so this narrows with ILIKE and
 * then confirms an exact case-insensitive equality in JS. The confirm step is
 * what makes it correct: `_` and `%` are legal in a local-part and are ILIKE
 * wildcards, so an unescaped pattern could match the WRONG contact. They are
 * escaped below, and the JS check means a miss in that escaping can only ever
 * cost us a match — never hand back somebody else's record.
 */
async function findClientByEmail(
  supabase: ReturnType<typeof db>,
  email: string,
  business_unit: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const pattern = target.replace(/([\\%_])/g, '\\$1');
  const { data, error } = await supabase
    .from('crm_clients')
    .select('id, email')
    .ilike('email', pattern)
    .eq('business_unit', business_unit)
    .limit(20);
  if (error) {
    console.error('[email-leads] contact lookup failed', { email: target, error });
    return null;
  }
  const hit = (data ?? []).find(r => (r.email ?? '').trim().toLowerCase() === target);
  return hit?.id ?? null;
}

// Reject billing/admin/platform emails — only keep actual lead notifications
const NON_LEAD_PATTERNS = [
  /payment\s+failed/i,
  /past\s+due/i,
  /invoice/i,
  /order\s+form/i,
  /support\s+request/i,
  /exchange\s+api/i,
  /now\s+live\s+on/i,
  /request\s+has\s+been\s+received/i,
  /let'?s\s+connect/i,
  /voided/i,
  /your\s+(pro\s+)?account\s+is/i,
  /\bpayment\b.*\bconfirm/i,
  /\breceipt\b/i,
  /\bsubscription\b/i,
  /\bunsubscribe\b/i,
  /\bwelcome\s+to\b/i,
  // Digest / recommendation emails — not individual leads
  /recommended\s+for\s+you/i,
  /new\s+properties?\s+(recommended|for\s+you|matching)/i,
  /portfolio\s+update/i,
  /weekly\s+(digest|update|summary|report)/i,
  /daily\s+(digest|update|summary|alert)/i,
  /\bmarket\s+(report|update|snapshot)\b/i,
  /\bnewsletter\b/i,
  /\bproperties?\s+matching\s+your\s+search\b/i,
  /\bsaved\s+search\s+(alert|results)\b/i,
  /\bview\s+all\s+search\s+results\b/i,
  // Reply/forward threads are never a fresh lead
  /^\s*(re|fwd?)\s*:/i,
  // Alert / subscriber / lead-magnet signups are contacts at most, not pipeline deals
  /\bsubscriber\b/i,
  /property[\s-]?alerts?/i,
  /\bmagnet\b/i,
  // Call-log / voicemail notification emails (external call system, not a lead)
  /📞|silent call|unknown caller|voicemail|missed call/i,
  // E-signature workflow notifications
  /please sign|signed lease|docusign/i,
];

// Our own internal domains — parsed lead emails from these should be skipped
const INTERNAL_DOMAINS = ['crecotx.com', 'fairoaksrealtygroup.com'];

function isLeadEmail(subject: string, fromAddress: string, sourceDomain: string, parsedEmail?: string, ownWebsite?: boolean): boolean {
  // Reject known non-lead patterns in subject
  if (NON_LEAD_PATTERNS.some(re => re.test(subject))) return false;
  // Test-suite / audit fixtures must never become real pipeline records
  if (/@example\.com/i.test(fromAddress) || (parsedEmail && /@example\.com/i.test(parsedEmail))) return false;
  if (/\bzz(test|aud)/i.test(subject)) return false;
  // Synthetic deploy/uptime probe against the crecotx.com contact form. It
  // arrives as a genuine "New Inquiry — …" notification from noreply@crecotx.com,
  // so the ownWebsite source below rightly trusts the sender and the probe was
  // becoming a real contact + deal + importer row roughly daily. Matched on the
  // prospect address first — that is the stable signal — with the subject as a
  // fallback in case the probe is ever renamed or re-addressed. Deliberately
  // narrow: it rejects this probe, never noreply@crecotx.com inquiries at large.
  if (parsedEmail && /(^attr\.probe(\.deploy)?@|probe\.deploy@)/i.test(parsedEmail)) return false;
  if (/\battr(ibution)?[\s‐-―-]+probe\b/i.test(subject)) return false;
  // Own website contact form emails: sender IS our domain — that's expected, don't reject them.
  // Only apply the sender-domain filter for third-party platforms.
  if (!ownWebsite) {
    const senderDomain = (fromAddress.match(/@([\w.\-]+)/) ?? [])[1]?.toLowerCase() ?? '';
    if (senderDomain === sourceDomain || senderDomain.endsWith(`.${sourceDomain}`)) return false;
  }
  // Reject if the parsed prospect email is from one of our own internal domains
  if (parsedEmail) {
    const parsedDomain = (parsedEmail.match(/@([\w.\-]+)/) ?? [])[1]?.toLowerCase() ?? '';
    if (INTERNAL_DOMAINS.includes(parsedDomain)) return false;
  }
  return true;
}

// Extract prospect name from the email From header, e.g. "John Smith via LoopNet <noreply@loopnet.com>"
function nameFromFromHeader(from: string): string {
  const m = from.match(/^"?([^"<]+?)\s+via\s+\S+/i)
         ?? from.match(/^"([^"]+)"/);
  if (!m) return '';
  const raw = m[1].trim();
  // Reject if it's the platform name itself (e.g. "LoopNet", "Crexi")
  if (/^(loopnet|crexi|costar|42floors|zillow|realtor\.com|move\.com)$/i.test(raw)) return '';
  return raw;
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

function parseLeadEmail(subject: string, body: string, from = '') {
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

  // Priority: From header ("John Smith via LoopNet") > body labels > body phrase > subject
  const nameFromHeader = nameFromFromHeader(from);

  let fullName = '';
  if (nameFromHeader) {
    fullName = nameFromHeader;
  } else if (firstName || lastName) {
    fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  } else if (nameFromBody) {
    fullName = nameFromBody.trim();
  }

  // Fallback: try subject line
  if (!fullName) {
    fullName = extract(subject, [
      // "New Lead: John Smith" or "Lead from John Smith for..."
      /(?:new\s+lead[:\s\-]+|lead\s+from[:\s]+|inquiry\s+from[:\s]+|contact\s+from[:\s]+)([A-Za-z][^\-–|]{3,40})(?:\s*[\-–|]|\s+(?:for|re:|regarding|is\s+interested)|$)/i,
      // "John Smith is interested / inquired / sent / submitted / favorited / viewed / saved"
      /^([A-Za-z][A-Za-z\s'\-]{4,40})\s+(?:is\s+interested|inquired|sent|submitted|favorited|viewed|saved|wants\s+to|would\s+like)/i,
    ]);
  }

  const email = extract(text, [
    /(?:^|\n)\s*(?:email\s*address|e[-\s]?mail)[:\s]+([\w.+\-]+@[\w.\-]+\.[a-z]{2,})/im,
    /([\w.+\-]+@[\w.\-]+\.[a-z]{2,})/i,
  ]);

  // Last resort: use email username as display name (better than blank)
  if (!fullName && email) {
    fullName = email.split('@')[0].replace(/[._\-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const phone = extract(text, [
    /(?:^|\n)\s*(?:phone|mobile|cell|telephone|tel)[:\s]+([\d\s().+\-]{7,20})/im,
    /((?:\+1\s?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/,
  ]);

  // Property: prefer subject-line extraction (reliable) over body (often garbled HTML/CSS)
  const propertyFromSubject =
    // "LoopNet Lead for [property]"
    subject.replace(/^loopnet\s+lead\s+for\s*/i, '').trim() !== subject.trim()
      ? subject.replace(/^loopnet\s+lead\s+for\s*/i, '').trim()
    // "X favorited/opened brochure on/viewed [property]"
    : /\b(favorited|opened\s+brochure\s+on|viewed|saved)\s+(.+)/i.test(subject)
      ? (subject.match(/\b(?:favorited|opened\s+brochure\s+on|viewed|saved)\s+(.+)/i)?.[1] ?? '').trim()
    // "New Lead: [property]" / "New Inquiry for [property]"
    : subject.replace(/^(new\s+lead[:\-\s]+|new\s+inquiry\s+for\s+|lead\s+from[:\s]+)/i, '').trim();

  const propertyFromBody = extract(text, [
    // Only match very explicit labeled fields — avoid matching random "property" mentions in body prose
    /(?:^|\n)\s*(?:property\s+of\s+interest|property\s+address)[:\s]+([^\n]{5,120})/im,
  ]);

  const property = propertyFromBody || propertyFromSubject;

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
  if (Date.now() < new Date(conn.expires_at).getTime() - 120_000) return decryptToken(conn.access_token);

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decryptToken(conn.refresh_token),
      grant_type:    'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;

  await db().from('gmail_connections').update({
    access_token: encryptToken(data.access_token),
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
export async function POST(req: import('next/server').NextRequest) {
  // Require internal key (same secret used by cron→MLS sync)
  const internalKey = req.headers.get('x-internal-key');
  const syncSecret = process.env.INTERNAL_SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isInternal = syncSecret && internalKey === syncSecret;
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  if (!isInternal && !isCron) {
    return import('next/server').then(({ NextResponse }) =>
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }
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
    // Failures are counted, not just logged: the cron reads these back so a run
    // that imports nothing because everything errored can no longer look like a
    // quiet, successful run.
    let totalFailed = 0;
    let maxConsecutiveFailures = 0;
    let runFailures = 0;
    const failureSamples: string[] = [];
    const noteFailure = (why: string, subject: string) => {
      totalFailed++;
      runFailures++;
      if (runFailures > maxConsecutiveFailures) maxConsecutiveFailures = runFailures;
      if (failureSamples.length < 5) failureSamples.push(`${why}: ${subject.slice(0, 80)}`);
    };

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

        // Skip billing/admin/platform emails — only process actual lead notifications
        const fromAddress = (from.match(/<([^>]+)>/) ?? [, from])[1] ?? from;
        // Parse lead first so we can pass the extracted email to isLeadEmail
        const parsed = parseLeadEmail(subject, body, from);
        if (!isLeadEmail(subject, fromAddress, source.domain, parsed.email, source.ownWebsite)) continue;

        // Determine business_unit: source domain takes priority over agent profile
        const business_unit = source.business_unit;

        // Find the right agent to assign — prefer an agent matching the business_unit
        let agentId = conn.user_id;
        if (agentProfile && agentProfile.business_unit !== business_unit) {
          // Try to find an agent in the right business unit
          const rightAgent = (profiles ?? []).find((p: any) => p.business_unit === business_unit);
          if (rightAgent) agentId = rightAgent.id;
        }

        // Skip if no usable contact info
        if (!parsed.email && !parsed.phone && !parsed.fullName) continue;

        // Dedup by email, case-insensitively, exactly as the unique index does.
        let clientId: string | null = null;
        if (parsed.email) {
          clientId = await findClientByEmail(supabase, parsed.email, business_unit);
        }

        // Create client if not already exists
        if (!clientId) {
          const nameParts = parsed.fullName.split(' ');
          const firstName = nameParts[0] ?? '';
          const lastName  = nameParts.slice(1).join(' ') ?? '';

          const clientType = business_unit === 'commercial' ? 'Tenant' : 'Buyer';

          const { data: newClient, error: insertErr } = await supabase.from('crm_clients').insert([{
            agent_id:        agentId,
            assigned_agent_ids: [agentId],
            first_name:      firstName,
            last_name:        lastName,
            business_name:   parsed.company ?? '',
            // Store lowercase so the stored value matches the index expression and
            // future lookups cannot drift back out of sync.
            email:            parsed.email?.trim().toLowerCase() ?? '',
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

          if (insertErr) {
            // 23505 = the unique index caught a contact we failed to find first.
            // Somebody else's row already represents this person, so link to it
            // rather than losing the lead. Reachable on a race between two runs
            // even now the lookup is case-correct.
            if ((insertErr as { code?: string }).code === '23505' && parsed.email) {
              clientId = await findClientByEmail(supabase, parsed.email, business_unit);
              if (clientId) {
                console.warn(`[email-leads] duplicate on insert for ${parsed.email}; linked to existing contact ${clientId}`);
              }
            }
            if (!clientId) {
              // Any other failure is NOT the lead's fault. Leaving the message
              // unrecorded is what lets the next run pick it up again: this used
              // to write the import row anyway, marking the message processed
              // forever and counting it as a success while the lead was gone.
              console.error('[email-leads] contact insert failed — leaving message unprocessed for retry', {
                messageId, subject, email: parsed.email, error: insertErr,
              });
              noteFailure('contact insert failed', subject);
              continue;
            }
          }
        }

        // No contact means nothing to attach the lead to. Skip WITHOUT recording
        // the message, so it is retried instead of silently disappearing.
        if (!clientId) {
          console.error('[email-leads] no contact could be resolved — leaving message unprocessed for retry', {
            messageId, subject, email: parsed.email,
          });
          noteFailure('no contact resolved', subject);
          continue;
        }

        // Create a deal in the Prospect stage (dedup by client_id + business_unit)
        if (clientId) {
          const dealType   = business_unit === 'commercial' ? 'Tenant Lease' : 'Buyer Purchase';
          const nowIso     = new Date().toISOString();
          // client field is NOT NULL — fall back to email username or phone
          const clientName = parsed.fullName
            || parsed.email?.split('@')[0]?.replace(/[._\-]/g, ' ')?.replace(/\b\w/g, c => c.toUpperCase())
            || parsed.phone
            || 'Unknown';

          // Only insert if no existing Prospect-stage deal for this client+property
          const { data: existingDeal } = await supabase
            .from('crm_deals')
            .select('id')
            .eq('client_id', clientId)
            .eq('stage', 'Prospect')
            .eq('business_unit', business_unit)
            .maybeSingle();

          if (!existingDeal) {
            await supabase.from('crm_deals').insert([{
              client_id:           clientId,
              client:              clientName,
              client_email:        parsed.email  ?? '',
              client_phone:        parsed.phone  ?? '',
              type:                dealType,
              property:            parsed.property ?? subject,
              value:               0,
              notes:               [
                parsed.message  ? `Message: ${parsed.message}` : '',
                `Source: ${source.source}`,
              ].filter(Boolean).join('\n'),
              agent_id:            agentId,
              assigned_agent_ids:  [agentId],
              stage:               'Prospect',
              last_touch:          nowIso,
              business_unit,
            }]);
          }

          // Auto-enroll into any matching 'new_contact' action plans and fire Step 1.
          // OFF unless LEAD_AUTOENROLL_UNITS names this business unit — the broker
          // enrolls people himself until he switches automated nurture on. This is
          // the same switch the website lead paths use (lib/lead-autoenroll.ts), so
          // one variable controls every automatic enrollment.
          const autoEnrollUnits = (process.env.LEAD_AUTOENROLL_UNITS ?? '')
            .split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
          if (autoEnrollUnits.includes(business_unit)) {
            await autoEnrollNewContact(supabase, {
              clientId,
              agentId,
              business_unit,
              property: parsed.property ?? subject,
            });
          } else {
            console.log(`[email-leads] auto-enroll skipped for ${clientId} (LEAD_AUTOENROLL_UNITS does not include ${business_unit})`);
          }
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
        runFailures = 0;   // consecutive streak broken
      }
    }

    if (totalFailed > 0) {
      console.error(`[email-leads/sync] ${totalFailed} message(s) failed to import (longest consecutive run: ${maxConsecutiveFailures})`, failureSamples);
    }
    return NextResponse.json({
      imported: totalImported,
      failed: totalFailed,
      maxConsecutiveFailures,
      failureSamples,
      ok: true,
    });
  } catch (err: any) {
    console.error('[email-leads/sync]', err?.message ?? err);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}

