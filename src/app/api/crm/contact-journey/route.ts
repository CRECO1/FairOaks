import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, assertOwnsResource, hiddenDealIds, excludeHiddenDeals } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export type JourneyStep = { key: 'targeted' | 'asked' | 'emailed' | 'replied' | 'called' | 'deal'; label: string; at: string | null; detail: string };

/**
 * GET /api/crm/contact-journey?contact_id= — one person's path with us in order: reached out → asked → emailed → they replied → called → deal, each with its
 * date, and a one-line "what next". Built from data the CRM already holds (outreach marks, property tags, the Gmail-synced emails, the call log, deals);
 * same access rule as opening the contact. Empty `steps` when the contact has nothing property-related to show.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('contact_id') ?? '';
  if (!(await assertOwnsResource('crm_clients', id, ctx))) return notFound('Contact not found');
  const db = adminClient();
  const hiddenIds = await hiddenDealIds(ctx);   // emails and calls on a deal this person can't see must not show up in a contact's journey either
  const [{ data: c }, { data: acts }, { data: mail }, { data: calls }, { data: deals }] = await Promise.all([
    db.from('crm_clients').select('targeted_listing_ids, targeted_at, tagged_listing_ids, last_touched_at').eq('id', id).maybeSingle(),
    db.from('crm_client_activities').select('created_at, tagged_listing_ids').eq('client_id', id).order('created_at', { ascending: true }).limit(500),
    excludeHiddenDeals(db.from('crm_deal_emails').select('direction, email_at, email_date').eq('client_id', id), hiddenIds).order('email_date', { ascending: true }).limit(500),
    excludeHiddenDeals(db.from('crm_call_log').select('started_at').eq('contact_id', id), hiddenIds).order('started_at', { ascending: true }).limit(300),
    db.from('crm_deals').select('id, stage, created_at, property').eq('client_id', id).order('created_at', { ascending: true }).limit(50),
  ]);
  const hidden = new Set(hiddenIds);
  const myDeals = (deals ?? []).filter(d => !hidden.has(d.id as string));
  const ms = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };
  const iso = (t: number | null) => (t ? new Date(t).toISOString() : null);
  const taggedActs = (acts ?? []).filter(a => ((a.tagged_listing_ids as string[] | null) ?? []).length);
  const askedAt = ms(taggedActs[0]?.created_at);
  const lastAskedAt = ms(taggedActs[taggedActs.length - 1]?.created_at);
  const hasAsked = taggedActs.length > 0 || (((c?.tagged_listing_ids as string[] | null) ?? []).length > 0);
  const hasTargeted = (((c?.targeted_listing_ids as string[] | null) ?? []).length > 0) || !!c?.targeted_at;
  const sent = (mail ?? []).filter(m => m.direction !== 'received').map(m => ms(m.email_at ?? m.email_date)).filter((x): x is number => x !== null);
  const recv = (mail ?? []).filter(m => m.direction === 'received').map(m => ms(m.email_at ?? m.email_date)).filter((x): x is number => x !== null);
  const callTimes = (calls ?? []).map(k => ms(k.started_at)).filter((x): x is number => x !== null);
  const steps: JourneyStep[] = [];
  const day = (t: number | null) => (t ? Math.floor((Date.now() - t) / 86_400_000) : null);
  if (hasTargeted) steps.push({ key: 'targeted', label: 'Reached out', at: iso(ms(c?.targeted_at)), detail: 'On an outreach list for a property' });
  if (hasAsked) steps.push({ key: 'asked', label: 'Asked', at: iso(askedAt), detail: taggedActs.length > 1 ? `${taggedActs.length} times about a property` : 'About a property' });
  if (sent.length) steps.push({ key: 'emailed', label: 'We emailed', at: iso(sent[sent.length - 1]), detail: `${sent.length} email${sent.length === 1 ? '' : 's'} sent` });
  if (recv.length) steps.push({ key: 'replied', label: 'They emailed', at: iso(recv[recv.length - 1]), detail: `${recv.length} repl${recv.length === 1 ? 'y' : 'ies'}` });
  if (callTimes.length) steps.push({ key: 'called', label: 'Call', at: iso(callTimes[callTimes.length - 1]), detail: `${callTimes.length} call${callTimes.length === 1 ? '' : 's'} logged` });
  if (myDeals.length) steps.push({ key: 'deal', label: 'Deal', at: iso(ms(myDeals[myDeals.length - 1].created_at)), detail: `${String(myDeals[myDeals.length - 1].stage ?? '')}${myDeals.length > 1 ? ` (+${myDeals.length - 1} more)` : ''}` });
  if (!hasTargeted && !hasAsked) return NextResponse.json({ steps: [], next: '' });

  // One-line "what next".
  const lastSent = sent.length ? sent[sent.length - 1] : 0; const lastRecv = recv.length ? recv[recv.length - 1] : 0; const lastCall = callTimes.length ? callTimes[callTimes.length - 1] : 0;
  const touched = Math.max(lastSent, lastCall, ms(c?.last_touched_at) ?? 0);
  let next = '';
  if (myDeals.length) next = `In a deal (${String(myDeals[myDeals.length - 1].stage ?? '')}). Keep that moving.`;
  else if (lastRecv && lastRecv > lastSent) next = `They wrote back ${day(lastRecv)} day${day(lastRecv) === 1 ? '' : 's'} ago and you haven't answered. Reply to them.`;
  else if (hasAsked && lastAskedAt && touched <= lastAskedAt + 86_400_000) next = `Asked ${day(lastAskedAt)} day${day(lastAskedAt) === 1 ? '' : 's'} ago and nothing since. Call or email them.`;
  else if (hasAsked && !lastAskedAt && !touched) next = 'Tagged to a property with no follow-up logged. Call or email them.';
  else if (hasTargeted && !hasAsked && !lastRecv && c?.targeted_at && Date.now() - Date.parse(String(c.targeted_at)) >= 30 * 86_400_000) next = `Reached out ${day(ms(c.targeted_at))} days ago with no reply. Send a second touch.`;
  else if (hasTargeted && !hasAsked) next = 'On an outreach list. A reply moves them to "asked".';
  else if (touched > (lastAskedAt ?? 0)) next = 'Followed up. Waiting on them.';
  return NextResponse.json({ steps, next });
}
