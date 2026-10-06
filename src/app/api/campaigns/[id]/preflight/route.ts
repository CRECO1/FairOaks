import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { fetchAll } from '@/lib/campaign-engagement';
import { chicagoLocalToUTC } from '@/lib/chicago-time';
import { marketingDailyCap } from '@/lib/email-volume';
import { MARKET_REPORT_TOKENS } from '@/lib/market-report-email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pre-send check, run before a campaign is activated.
 *
 * "fail" blocks activation: the email would go out visibly broken (a raw
 * {{token}} in an inbox, nobody to send to, no content). Everything else is a
 * "warn" the sender can read and override. The checks mirror what the send
 * cron (app/api/cron/campaigns) will actually do, so the answers are about the
 * real send, not a guess at it.
 */

type Status = 'pass' | 'warn' | 'fail';
interface Check { key: string; label: string; status: Status; detail: string; items?: string[] }

// Tokens the cron fills from the contact, the sender and the market report.
const BUILT_IN = new Set([
  'first_name', 'last_name', 'full_name', 'email', 'client_type', 'agent_name', 'agent_title',
  'agent_email', 'agent_phone', 'brokerage', 'unsubscribe_url', 'property',
  ...MARKET_REPORT_TOKENS.map(t => t.slice(2, -2)),
]);
const PLACEHOLDER_NAME = /^(privately held|owner|property owner|resident|current resident|occupant|unknown|n\/?a|none|test|web|lead|tenant|info|office|admin|sales|manager|customer|client|sir|madam)$/i;
const ENTITY = /\b(llc|l\.l\.c|inc|ltd|lp|llp|trust|trustees?|corp|corporation|company|co\.|partners|partnership|holdings|properties|investments|group|church|bank|city of|county)\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const name = (c: { first_name?: string | null; last_name?: string | null; business_name?: string | null; email?: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.business_name || c.email || 'Unnamed contact';
const sample = (xs: string[], n = 8) => (xs.length > n ? [...xs.slice(0, n), `…and ${xs.length - n} more`] : xs);

async function checkUrl(url: string): Promise<{ ok: boolean; blocked?: boolean; status?: number }> {
  try {
    const r = await fetch(url, {
      method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(7000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36 CRECO-link-check' },
    });
    r.body?.cancel().catch(() => {});
    if (r.status < 400) return { ok: true, status: r.status };
    // Bot walls answer a script with 401/403/429 while working fine in a browser.
    return { ok: false, blocked: [401, 403, 429].includes(r.status), status: r.status };
  } catch {
    return { ok: false };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const db = adminClient();
  const { data: camp } = await db.from('crm_campaigns')
    .select('id, name, type, frequency, send_date, send_time, send_day_of_month, status, email_subject, email_body, sms_body, sender_agent_id, send_as_sender, business_unit')
    .eq('id', id).maybeSingle();
  if (!camp || (!isAdminRole(ctx.role) && camp.business_unit !== ctx.businessUnit)) return notFound('Campaign not found');

  const checks: Check[] = [];
  const isEmail = camp.type === 'email';
  const subject = camp.email_subject ?? '';
  const body = camp.email_body ?? '';
  // Per-recipient tokens filled with the first recipient's values, for display.
  const asFirst = (t: string, mf?: Record<string, unknown> | null) => {
    for (const [k, v] of Object.entries(mf ?? {})) if (/^[a-z_]{1,40}$/.test(k) && typeof v === 'string' && v.trim()) t = t.replaceAll(`{{${k}}}`, v.trim());
    return t;
  };

  // ── Content ────────────────────────────────────────────────────────────────
  if (isEmail) {
    const missing = [!subject.trim() && 'subject', !body.trim() && 'body'].filter(Boolean);
    checks.push(missing.length
      ? { key: 'content', label: 'Subject & body', status: 'fail', detail: `The email has no ${missing.join(' or ')}.` }
      : { key: 'content', label: 'Subject & body', status: 'pass', detail: '' });
  } else {
    checks.push(camp.sms_body?.trim()
      ? { key: 'content', label: 'Message', status: 'pass', detail: `${camp.sms_body.length} characters` }
      : { key: 'content', label: 'Message', status: 'fail', detail: 'The text message is empty.' });
  }

  // ── Recipients ─────────────────────────────────────────────────────────────
  type Row = { client_id: string; merge_fields: Record<string, unknown> | null; client: { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; phone: string | null; cell_phone: string | null; unsubscribed_at: string | null } | null };
  const enrollments = await fetchAll<Row>((a, b) => db.from('crm_campaign_enrollments')
    .select('client_id, merge_fields, client:crm_clients(id, first_name, last_name, business_name, email, phone, cell_phone, unsubscribed_at)')
    .eq('campaign_id', id).eq('active', true).order('enrolled_at').range(a, b) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>);
  const emails = enrollments.map(e => e.client?.email?.trim().toLowerCase()).filter((e): e is string => !!e);
  const dead = new Set<string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await db.from('crm_dead_emails').select('email').in('email', emails.slice(i, i + 200));
    for (const d of data ?? []) dead.add(String(d.email).toLowerCase());
  }
  const unsub: string[] = [], deadList: string[] = [], noAddr: string[] = [];
  const deliverable: Row[] = [];
  for (const e of enrollments) {
    const c = e.client;
    if (!c) continue;
    if (c.unsubscribed_at) { unsub.push(name(c)); continue; }
    if (isEmail) {
      const em = c.email?.trim().toLowerCase() ?? '';
      if (!em || !EMAIL_RE.test(em)) { noAddr.push(name(c)); continue; }
      // The dead-email trigger stamps unsubscribed_at, so a listed address that is
      // NOT unsubscribed slipped past it — and the cron would mail it.
      if (dead.has(em)) deadList.push(`${name(c)} <${em}>`);
    } else if (!c.cell_phone && !c.phone) { noAddr.push(name(c)); continue; }
    deliverable.push(e);
  }
  const skipped = [
    unsub.length && `${unsub.length} unsubscribed or bounced`,
    noAddr.length && `${noAddr.length} with no ${isEmail ? 'valid email' : 'phone'}`,
  ].filter(Boolean) as string[];
  checks.push({
    key: 'recipients', label: 'Recipients',
    status: deliverable.length === 0 ? 'fail' : 'pass',
    detail: deliverable.length === 0
      ? (enrollments.length ? `None of the ${enrollments.length} enrolled contacts can receive it${skipped.length ? ` (${skipped.join(', ')})` : ''}.` : 'Nobody is enrolled yet.')
      : `${deliverable.length} will receive it${skipped.length ? ` · skipped automatically: ${skipped.join(', ')}` : ''}.`,
    items: sample(noAddr.map(n => `${n} — no ${isEmail ? 'email' : 'phone'}`)),
  });
  if (deadList.length) {
    checks.push({ key: 'dead', label: 'Dead addresses', status: 'warn', detail: `${deadList.length} recipient${deadList.length > 1 ? 's are' : ' is'} on the dead-email list but not suppressed, so ${deadList.length > 1 ? 'they' : 'it'} would be sent to and bounce. Remove them from the campaign.`, items: sample(deadList) });
  }

  if (isEmail) {
    // ── Merge fields ─────────────────────────────────────────────────────────
    const all = `${subject}\n${body}`;
    const raw = [...new Set([...all.matchAll(/\{\{([^{}]*)\}\}/g)].map(m => m[1]))];
    const malformed = raw.filter(t => !/^[a-z_]{1,40}$/.test(t));
    const perRecipient = raw.filter(t => /^[a-z_]{1,40}$/.test(t) && !BUILT_IN.has(t));
    const gaps: string[] = [];
    for (const t of perRecipient) {
      const missing = deliverable.filter(e => { const v = e.merge_fields?.[t]; return typeof v !== 'string' || !v.trim(); });
      if (missing.length) gaps.push(`{{${t}}} is blank for ${missing.length} of ${deliverable.length}: ${sample(missing.map(e => name(e.client!)), 5).join(', ')}`);
    }
    const tokenProblems = [
      ...malformed.map(t => `{{${t}}} won't be filled in — tokens are lowercase_with_underscores`),
      ...gaps,
    ];
    checks.push(tokenProblems.length
      ? { key: 'merge', label: 'Personal fields', status: 'fail', detail: 'Some recipients would see a raw {{token}} in the email.', items: tokenProblems }
      : { key: 'merge', label: 'Personal fields', status: 'pass', detail: raw.length ? `${raw.length} field${raw.length > 1 ? 's' : ''} filled in for everyone.` : 'No personal fields used.' });

    // ── Greeting names ───────────────────────────────────────────────────────
    if (/\{\{(first_name|full_name)\}\}/.test(all)) {
      const odd: string[] = [], blank: string[] = [];
      for (const e of deliverable) {
        const fn = (e.merge_fields?.first_name as string | undefined)?.trim() || e.client!.first_name?.trim() || '';
        if (!fn) blank.push(e.client!.business_name || e.client!.email || 'contact');
        else if (PLACEHOLDER_NAME.test(fn) || ENTITY.test(fn) || /[@\d]/.test(fn) || (fn.length > 3 && fn === fn.toUpperCase())) odd.push(`"${fn}" — ${name(e.client!)}`);
      }
      const items = [...odd, ...blank.map(b => `no first name — greeted as "${b}"`)];
      checks.push(items.length
        ? { key: 'names', label: 'Greeting names', status: 'warn', detail: `${items.length} greeting${items.length > 1 ? 's' : ''} may read oddly. Fix the contact's first name to change it.`, items: sample(items) }
        : { key: 'names', label: 'Greeting names', status: 'pass', detail: 'Every greeting uses a real first name.' });
    }

    // ── Unsubscribe ──────────────────────────────────────────────────────────
    checks.push(body.includes('{{unsubscribe_url}}')
      ? { key: 'unsub', label: 'Unsubscribe link', status: 'pass', detail: 'Present.' }
      : { key: 'unsub', label: 'Unsubscribe link', status: 'warn', detail: 'No {{unsubscribe_url}} link. Marketing email needs one (CAN-SPAM), and without it people hit "spam" instead.' });

    // ── Links & images (as the first recipient will get them) ────────────────
    const first = deliverable[0];
    let rendered = body;
    for (const [k, v] of Object.entries(first?.merge_fields ?? {})) {
      if (/^[a-z_]{1,40}$/.test(k) && typeof v === 'string' && v.trim()) rendered = rendered.replaceAll(`{{${k}}}`, v.trim());
    }
    const hrefs = [...new Set([...rendered.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1].trim()))]
      .filter(h => !/^(mailto:|tel:|sms:|#)/i.test(h) && !h.includes('{{'));
    const srcs = [...new Set([...rendered.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1].trim()))].filter(s => !s.includes('{{'));
    const linkIssues: string[] = [], blocked: string[] = [];
    const results = await Promise.all([...hrefs.slice(0, 20), ...srcs.slice(0, 10)].map(async u => {
      if (!/^https?:\/\//i.test(u)) return { u, r: { ok: false, status: -1 } };
      return { u, r: await checkUrl(u) };
    }));
    for (const { u, r } of results) {
      const isImg = srcs.includes(u) && !hrefs.includes(u);
      const what = isImg ? 'Image' : 'Link';
      if (r.status === -1) linkIssues.push(`${what} isn't a full web address: ${u}`);
      else if (!r.ok && r.blocked) blocked.push(u);
      else if (!r.ok) linkIssues.push(`${what} ${r.status ? `returns ${r.status}` : "doesn't load"}: ${u}`);
    }
    for (const u of [...hrefs, ...srcs]) {
      if (/^http:\/\//i.test(u)) linkIssues.push(`Not secure (http://): ${u}`);
      // Vercel challenges www.elkhornpoint.com for visitors arriving from email.
      if (/^https?:\/\/www\.elkhornpoint\.com/i.test(u)) linkIssues.push(`Use https://elkhornpoint.com (no www) — the www address shows visitors a security check: ${u}`);
    }
    const n = hrefs.length + srcs.length;
    checks.push(linkIssues.length
      ? { key: 'links', label: 'Links & images', status: 'warn', detail: `${linkIssues.length} problem${linkIssues.length > 1 ? 's' : ''} found${first ? ` (checked as ${name(first.client!)} will get them)` : ''}.`, items: [...linkIssues, ...blocked.map(b => `Couldn't verify (site blocks automated checks): ${b}`)] }
      : { key: 'links', label: 'Links & images', status: 'pass', detail: n ? `All ${n} load${blocked.length ? ` (${blocked.length} couldn't be verified automatically)` : ''}.` : 'No links or images.', items: blocked.length ? blocked.map(b => `Couldn't verify: ${b}`) : undefined });

    // ── Phone layout ─────────────────────────────────────────────────────────
    const media = /@media[^{]*max-width/i.test(body);
    const wide = [...body.matchAll(/(?<!max-)width\s*(?:=\s*["']?|:\s*)(\d{3,4})(?:px)?/gi)].map(m => Number(m[1])).filter(w => w > 640);
    checks.push(media && !wide.length
      ? { key: 'mobile', label: 'Phone layout', status: 'pass', detail: 'Has phone-width layout rules. Glance at the phone preview to be sure.' }
      : { key: 'mobile', label: 'Phone layout', status: 'warn', detail: !media ? 'No phone-width layout rules found — check the phone preview before sending.' : `Fixed widths over 640px (${[...new Set(wide)].join(', ')}px) can force sideways scrolling on phones — check the phone preview.` });

    // ── Subject line ─────────────────────────────────────────────────────────
    const shown = asFirst(subject, deliverable[0]?.merge_fields);
    const contentCheck = checks.find(c => c.key === 'content');
    if (contentCheck?.status === 'pass') contentCheck.detail = `"${shown.length > 80 ? shown.slice(0, 80) + '…' : shown}"${shown !== subject && deliverable[0] ? ` (as ${name(deliverable[0].client!)} sees it)` : ''}`;
    const plain = shown.replace(/\{\{[^}]*\}\}/g, 'X'.repeat(8));
    const shouty = (plain.match(/\b[A-Z]{4,}\b/g) ?? []).length >= 2 || /!!|\$\$\$/.test(plain);
    if (plain.length > 70 || shouty) {
      checks.push({ key: 'subject', label: 'Subject line', status: 'warn', detail: [plain.length > 70 && `~${plain.length} characters — phones cut it off around 40–60`, shouty && 'ALL CAPS or "!!" trips spam filters'].filter(Boolean).join('; ') + '.' });
    } else checks.push({ key: 'subject', label: 'Subject line', status: 'pass', detail: `${plain.length} characters.` });
  }

  // ── Schedule ───────────────────────────────────────────────────────────────
  let sendAt: string | null = null;
  if (camp.frequency === 'one-time') sendAt = camp.send_date ? chicagoLocalToUTC(camp.send_date, camp.send_time || '08:00') : null;
  else if (camp.send_date) {
    const f = chicagoLocalToUTC(camp.send_date, camp.send_time || '08:00');
    if (Date.parse(f) > Date.now()) sendAt = f;
  }
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const scheduleNotes: string[] = [];
  let scheduleStatus: Status = 'pass';
  let scheduleDetail: string;
  if (camp.frequency === 'one-time' && !sendAt) { scheduleStatus = 'warn'; scheduleDetail = 'No send date set — it goes out within 15 minutes of activating. Set a date in Edit to schedule it.'; }
  else if (sendAt && Date.parse(sendAt) < Date.now()) { scheduleStatus = 'warn'; scheduleDetail = `The send date (${fmt(sendAt)} CT) has passed — it goes out within 15 minutes of activating.`; }
  else if (sendAt) {
    scheduleDetail = `Sends ${fmt(sendAt)} CT${camp.frequency !== 'one-time' ? `, then ${camp.frequency}` : ''}.`;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(sendAt));
    const wd = parts.find(p => p.type === 'weekday')?.value; const hr = Number(parts.find(p => p.type === 'hour')?.value);
    if (wd === 'Sat' || wd === 'Sun') { scheduleStatus = 'warn'; scheduleNotes.push('Lands on a weekend — business owners read Tue–Thu mornings best.'); }
    if (hr < 7 || hr >= 18) { scheduleStatus = 'warn'; scheduleNotes.push('Sends outside business hours — it will sit under the morning\'s mail.'); }
  } else scheduleDetail = `First send one ${camp.frequency === 'semi-annual' ? 'half-year' : camp.frequency.replace(/ly$/, '')} after activating, then ${camp.frequency}.`;
  if (isEmail && deliverable.length) {
    const cap = await marketingDailyCap(db, String(camp.business_unit ?? ''));
    if (cap.cap && deliverable.length > cap.cap) scheduleNotes.push(`Goes out over ~${Math.ceil(deliverable.length / cap.cap)} business days (${cap.cap}/day sending limit while the domain warms up).`);
  }
  checks.push({ key: 'schedule', label: 'Send time', status: scheduleStatus, detail: scheduleDetail!, items: scheduleNotes.length ? scheduleNotes : undefined });

  // ── Overlap with other campaigns ───────────────────────────────────────────
  if (deliverable.length && sendAt) {
    const lo = new Date(Date.parse(sendAt) - 3 * 86400_000).toISOString(), hi = new Date(Date.parse(sendAt) + 3 * 86400_000).toISOString();
    const ids = deliverable.map(e => e.client_id);
    const hits = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('crm_campaign_enrollments')
        .select('client_id, campaign:crm_campaigns!inner(id, name, status)')
        .in('client_id', ids.slice(i, i + 200)).eq('active', true).neq('campaign_id', id)
        .eq('campaign.status', 'active').gte('next_send_at', lo).lte('next_send_at', hi);
      for (const r of (data ?? []) as unknown as { campaign: { name: string } }[]) hits.set(r.campaign.name, (hits.get(r.campaign.name) ?? 0) + 1);
    }
    checks.push(hits.size
      ? { key: 'overlap', label: 'Other campaigns', status: 'warn', detail: 'Some recipients get another email from us within 3 days of this one.', items: [...hits].map(([n, c]) => `${c} also get "${n}"`) }
      : { key: 'overlap', label: 'Other campaigns', status: 'pass', detail: 'Nobody gets another campaign within 3 days.' });
  }

  // ── Sender ─────────────────────────────────────────────────────────────────
  if (isEmail) {
    const commercial = camp.business_unit === 'commercial';
    const domain = commercial ? 'crecotx.com' : 'fairoaksrealtygroup.com';
    const brand = commercial ? 'CRECO' : 'Fair Oaks Realty Group';
    const fallback = commercial ? 'zack@crecotx.com' : 'info@fairoaksrealtygroup.com';
    let from = `${brand} <noreply@${domain}>`, replyTo = fallback;
    if (camp.sender_agent_id) {
      const { data: p } = await db.from('crm_profiles').select('first_name, last_name, email').eq('id', camp.sender_agent_id).maybeSingle();
      const em = p?.email?.endsWith(`@${domain}`) ? p.email : fallback;
      const who = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
      replyTo = em;
      if (camp.send_as_sender) from = `${who || brand} <${em}>`;
    }
    checks.push({ key: 'sender', label: 'From', status: 'pass', detail: `${from} · replies go to ${replyTo}` });
  } else {
    checks.push({ key: 'sms', label: 'Text sending', status: 'warn', detail: 'Text messages are not connected yet (no Twilio account) — these will be logged as skipped, not sent.' });
  }

  return NextResponse.json({
    checks,
    deliverable: deliverable.length,
    enrolled: enrollments.length,
    can_activate: !checks.some(c => c.status === 'fail'),
  });
}
