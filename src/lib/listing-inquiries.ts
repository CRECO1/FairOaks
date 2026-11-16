import { isAdminRole, hiddenDealIds, heldClientIds, type CrmContext } from '@/lib/crm-auth';
import { dropWalledTasks, ownTasksFilter } from '@/lib/task-walls';
import { listingAccessible, rentRollAccessible } from '@/lib/listing-files-access';
import { canAccessLinked } from '@/lib/crm-linked-access';
import { adminClient } from '@/lib/supabase-admin';

export type InquiryItem = {
  key: string;                    // contact id, `call:<id>` for a caller who is not a contact, or `deal:<id>`
  contact_id: string | null;      // null = unknown caller or a deal
  deal_id?: string | null;        // set for a deal entry (openable)
  name: string; type: string | null;
  via: 'notes' | 'call' | 'meeting' | 'email' | 'note' | 'deal' | 'task';
  last_at: string | null; snippet: string | null;
  /** Contacts only: a week or more since they asked and nothing logged on them since. */
  needs_follow_up?: boolean;
  /** Contacts only: something was logged on them after they asked (their last touch is more than a day past the ask). */
  followed_up?: boolean;
  /** Contacts only: the latest email either way on their card (Gmail sync), so a row can say 'emailed Nov 12, no reply'. */
  last_email?: { dir: 'sent' | 'received'; at: string };
  /** Contacts only: whole days from their ask to the first email we sent them after it (null when none yet). */
  responded_days?: number;
};

const prettyPhone = (n: string | null | undefined) => { const d = String(n ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (n ?? '') || 'Unknown caller'; };

/** Who asked about one property, filtered to what the caller may see. The caller has already checked access to the LISTING. */
export async function buildInquiries(ctx: CrmContext, listingId: string): Promise<{ ok: true; items: InquiryItem[] } | { ok: false }> {
  const db = adminClient();
  const tag = [listingId];
  const [notes, acts, calls] = await Promise.all([
    db.from('crm_clients').select('id, first_name, last_name, business_name, type, business_unit, lead_hold, last_touched_at').contains('tagged_listing_ids', tag).limit(200),
    db.from('crm_client_activities').select('id, client_id, type, note, created_at').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(300),
    db.from('crm_call_log').select('id, business_unit, contact_id, deal_id, direction, caller_name, from_number, to_number, started_at, notes, summary').contains('tagged_listing_ids', tag).order('started_at', { ascending: false }).limit(200),
  ]);
  if (notes.error || acts.error || calls.error) {
    console.error('[listing-inquiries]', notes.error ?? acts.error ?? calls.error);
    return { ok: false };
  }

  // Contacts that only show up through an activity.
  type ContactRow = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; type: string | null; business_unit: string | null; lead_hold: boolean | null; last_touched_at?: string | null };
  const contacts = new Map<string, ContactRow>();
  for (const c of (notes.data ?? []) as ContactRow[]) contacts.set(c.id, c);
  const missing = [...new Set([...(acts.data ?? []).map(a => a.client_id as string), ...(calls.data ?? []).map(c => c.contact_id as string | null).filter((x): x is string => !!x)])].filter(id => !contacts.has(id));
  if (missing.length) {
    const { data } = await db.from('crm_clients').select('id, first_name, last_name, business_name, type, business_unit, lead_hold, last_touched_at').in('id', missing);
    for (const c of (data ?? []) as ContactRow[]) contacts.set(c.id, c);
  }

  const visible = (c: ContactRow) => {
    if (c.lead_hold && ctx.role !== 'super_admin') return false;
    return isAdminRole(ctx.role) || c.business_unit === ctx.businessUnit;
  };

  const items = new Map<string, InquiryItem>();
  for (const a of acts.data ?? []) {            // newest first: the first activity per contact is the latest
    const c = contacts.get(a.client_id as string);
    if (!c || !visible(c) || items.has(c.id)) continue;
    const t = String(a.type);
    items.set(c.id, {
      key: c.id, contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null,
      via: t === 'call' || t === 'meeting' || t === 'email' ? t : 'note', last_at: a.created_at as string,
      snippet: String(a.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
    });
  }
  for (const c of notes.data as ContactRow[]) {  // tagged in the contact's own notes, no logged touch
    if (items.has(c.id) || !visible(c)) continue;
    items.set(c.id, { key: c.id, contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null, via: 'notes', last_at: null, snippet: null });
  }

  // Calls whose note tagged this property. A call from someone who is not a contact yet is exactly "the property they called on".
  // Same visibility as the Calling Log: your workspace (admins: any), and a call on a deal you can't see stays hidden.
  const dealCalls: { deal_id: string; at: string | null; snippet: string | null }[] = [];
  for (const call of calls.data ?? []) {
    if (!isAdminRole(ctx.role) && call.business_unit !== ctx.businessUnit) continue;
    if (call.deal_id && !(await canAccessLinked(ctx, { business_unit: call.business_unit as string, deal_id: call.deal_id as string }))) continue;
    const snippet = String(call.notes || call.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160) || null;
    // A call logged ON a deal belongs under that deal (below), not as a separate caller.
    if (call.deal_id) { dealCalls.push({ deal_id: call.deal_id as string, at: call.started_at as string | null, snippet }); continue; }
    const c = call.contact_id ? contacts.get(call.contact_id as string) : null;
    if (c) {
      if (!visible(c)) continue;
      const have = items.get(c.id);
      if (have && (have.last_at ?? '') >= String(call.started_at ?? '')) continue;   // the contact's own entry is newer
      items.set(c.id, { key: c.id, contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null, via: 'call', last_at: call.started_at as string, snippet });
    } else {
      const num = call.direction === 'outbound' ? call.to_number : call.from_number;
      items.set(`call:${call.id}`, { key: `call:${call.id}`, contact_id: null, name: (call.caller_name as string | null) || prettyPhone(num as string | null), type: null, via: 'call', last_at: call.started_at as string, snippet });
    }
  }

  // Deals whose notes tagged this property. A deal is visible only if the caller could open it (agents: only deals they are on;
  // Restricted deals: owner / assigned / super_admin) and it is in their workspace.
  const [dealsTagged, dealNotes, dealMeets] = await Promise.all([
    db.from('crm_deals').select('id, client, property, business_unit, notes').contains('tagged_listing_ids', tag).limit(100),
    db.from('crm_deal_notes').select('deal_id, body, created_at').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(200),
    db.from('crm_deal_meetings').select('deal_id, note, meeting_date, created_at').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(200),
  ]);
  if (!dealsTagged.error && !dealNotes.error && !dealMeets.error) {
    const hidden = new Set(await hiddenDealIds(ctx));
    type DealRow = { id: string; client: string | null; property: string | null; business_unit: string | null };
    const deals = new Map<string, DealRow>();
    for (const d of (dealsTagged.data ?? []) as DealRow[]) deals.set(d.id, d);
    const missingDeals = [...new Set([...(dealNotes.data ?? []).map(n => n.deal_id as string), ...(dealMeets.data ?? []).map(m => m.deal_id as string), ...dealCalls.map(c => c.deal_id)])].filter(id => !deals.has(id));
    if (missingDeals.length) {
      const { data } = await db.from('crm_deals').select('id, client, property, business_unit').in('id', missingDeals);
      for (const d of (data ?? []) as DealRow[]) deals.set(d.id, d);
    }
    const latest = new Map<string, { at: string | null; snippet: string | null }>();
    for (const n of dealNotes.data ?? []) if (!latest.has(n.deal_id as string)) latest.set(n.deal_id as string, { at: n.created_at as string, snippet: String(n.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null });
    for (const m of dealMeets.data ?? []) {
      const at = (m.created_at as string) ?? null; const cur = latest.get(m.deal_id as string);
      if (!cur || (at ?? '') > (cur.at ?? '')) latest.set(m.deal_id as string, { at, snippet: String(m.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null });
    }
    for (const c of dealCalls) {
      const cur = latest.get(c.deal_id);
      if (!cur || (c.at ?? '') > (cur.at ?? '')) latest.set(c.deal_id, { at: c.at, snippet: c.snippet });
    }
    for (const d of deals.values()) {
      if (hidden.has(d.id)) continue;
      if (!isAdminRole(ctx.role) && d.business_unit !== ctx.businessUnit) continue;
      const l = latest.get(d.id);
      items.set(`deal:${d.id}`, { key: `deal:${d.id}`, contact_id: null, deal_id: d.id, name: [d.client, d.property].filter(Boolean).join(' — ') || 'Deal', type: 'Deal', via: 'deal', last_at: l?.at ?? null, snippet: l?.snippet ?? null });
    }
  }

  // Tasks whose title or notes tagged this property. Same visibility as the Tasks page: an agent sees only their own tasks, a teammate's
  // walled-off tasks, tasks on private deals and tasks on a lead still on hold stay hidden.
  {
    let tq = db.from('crm_tasks').select('id, title, description, status, client_id, deal_id, due_date, created_at, business_unit, agent_id, assigned_to').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(100);
    if (!isAdminRole(ctx.role)) tq = tq.or(ownTasksFilter(ctx.userId)).eq('business_unit', ctx.businessUnit);
    const { data: tdata, error: terr } = await tq;
    if (!terr && tdata?.length) {
      const hidden = new Set(await hiddenDealIds(ctx));
      const held = await heldClientIds(ctx);
      const rows = (await dropWalledTasks(db, ctx, tdata)).filter(t => !(t.deal_id && hidden.has(t.deal_id as string)) && !(t.client_id && held.has(t.client_id as string)));
      for (const t of rows) {
        items.set(`task:${t.id}`, { key: `task:${t.id}`, contact_id: (t.client_id as string | null) ?? null, name: String(t.title ?? 'Task'), type: t.status === 'done' ? 'Task · done' : 'Task', via: 'task', last_at: t.created_at as string, snippet: String(t.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null });
      }
    }
  }

  // Emails count as touches: the latest sent / received email per contact (from the Gmail sync), so "emailed them last week" is a follow-up.
  const mailIds = [...new Set([...items.values()].filter(i => i.contact_id && i.last_at && i.via !== 'deal' && i.via !== 'task').map(i => i.contact_id as string))];
  const mail = new Map<string, { sent: number; received: number; lastDir: 'sent' | 'received'; lastMs: number; sentTimes: number[] }>();
  for (let i = 0; i < mailIds.length; i += 200) {
    const { data: em } = await db.from('crm_deal_emails').select('client_id, direction, email_at, email_date').in('client_id', mailIds.slice(i, i + 200)).order('email_date', { ascending: false }).limit(1000);
    for (const e of em ?? []) {
      const ms = Date.parse(String(e.email_at ?? e.email_date ?? '')); if (!Number.isFinite(ms)) continue;
      const dir = e.direction === 'received' ? 'received' : 'sent';
      const cur = mail.get(e.client_id as string) ?? { sent: 0, received: 0, lastDir: dir as 'sent' | 'received', lastMs: 0, sentTimes: [] };
      if (dir === 'sent') cur.sentTimes.push(ms);
      if (dir === 'sent') cur.sent = Math.max(cur.sent, ms); else cur.received = Math.max(cur.received, ms);
      if (ms >= cur.lastMs) { cur.lastMs = ms; cur.lastDir = dir; }
      mail.set(e.client_id as string, cur);
    }
  }
  // "Needs follow-up": they asked a week or more ago and nothing has been logged OR emailed to them since (their last touch is no later than the ask).
  const nowMs = Date.now();
  for (const it of items.values()) {
    if (!it.contact_id || !it.last_at || it.via === 'deal' || it.via === 'task') continue;
    const c = contacts.get(it.contact_id);
    const askedMs = Date.parse(it.last_at);
    if (!c || !Number.isFinite(askedMs)) continue;
    const m = mail.get(it.contact_id);
    if (m && m.lastMs) it.last_email = { dir: m.lastDir, at: new Date(m.lastMs).toISOString() };
    const firstAfter = (m?.sentTimes ?? []).filter(t => t > askedMs).sort((a, b) => a - b)[0];
    if (firstAfter) it.responded_days = Math.floor((firstAfter - askedMs) / 86_400_000);
    const touched = Math.max(c.last_touched_at ? Date.parse(c.last_touched_at) : 0, m?.sent ?? 0);
    if (touched > askedMs + 86_400_000) it.followed_up = true;
    if (nowMs - askedMs >= 7 * 86_400_000 && (!touched || touched <= askedMs + 86_400_000)) it.needs_follow_up = true;
  }

  const list = [...items.values()].sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return { ok: true, items: list };
}

export type MentionItem = { key: string; kind: 'property' | 'suite' | 'rentroll' | 'vendor'; listing_id: string | null; label: string; detail: string | null; snippet: string | null };

/**
 * Notes on OTHER properties that #-tag this one: a property's Internal Notes, a floor-plan suite note, a rent-roll note, a vendor / building
 * note ("see #1222Chulie for the comparable lease"). This is NOT inquiry activity, so it never changes the "asked" counts; it is its own list.
 * Each source keeps its own access rule so a tag can't expose a note the caller couldn't open: property + vendor notes follow listing access,
 * rent-roll rows only show to the property's own / assigned agents and admins, suite notes are workspace-wide like the floor plan itself.
 */
export async function buildMentions(ctx: CrmContext, listingId: string): Promise<MentionItem[]> {
  const db = adminClient();
  const tag = [listingId];
  const snip = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null;
  const [lst, suites, tenants, vendors] = await Promise.all([
    db.from('crm_listings').select('id, name, address, notes, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').contains('mentioned_listing_ids', tag).limit(50),
    db.from('office_suites').select('id, business_unit, listing_id, suite_number, tenant_name, notes').contains('mentioned_listing_ids', tag).limit(50),
    db.from('crm_property_tenants').select('id, listing_id, suite, tenant_name, notes').contains('mentioned_listing_ids', tag).limit(50),
    db.from('crm_listing_vendors').select('id, listing_id, label, vendor, notes').contains('mentioned_listing_ids', tag).limit(50),
  ]);
  if (lst.error || suites.error || tenants.error || vendors.error) return [];
  const srcIds = [...new Set([...(suites.data ?? []).map(r => r.listing_id), ...(tenants.data ?? []).map(r => r.listing_id), ...(vendors.data ?? []).map(r => r.listing_id)].filter((x): x is string => !!x && x !== listingId))];
  const { data: srcRows } = srcIds.length ? await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').in('id', srcIds) : { data: [] };
  const src = new Map((srcRows ?? []).map(l => [l.id as string, l as Record<string, unknown>]));
  const label = (l: Record<string, unknown> | undefined) => (l ? String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'Property') : 'Property');
  const out: MentionItem[] = [];
  for (const l of lst.data ?? []) {
    if (l.id === listingId || !listingAccessible(l as Record<string, unknown>, ctx)) continue;
    out.push({ key: `p:${l.id}`, kind: 'property', listing_id: l.id as string, label: label(l as Record<string, unknown>), detail: 'Internal notes', snippet: snip(l.notes) });
  }
  for (const r of suites.data ?? []) {
    if (!isAdminRole(ctx.role) && r.business_unit !== ctx.businessUnit) continue;
    const l = r.listing_id ? src.get(r.listing_id as string) : undefined;
    if (r.listing_id === listingId) continue;
    out.push({ key: `s:${r.id}`, kind: 'suite', listing_id: (r.listing_id as string | null) ?? null, label: label(l), detail: `Suite ${r.suite_number ?? ''}${r.tenant_name ? ` · ${r.tenant_name}` : ''}`.trim(), snippet: snip(r.notes) });
  }
  for (const r of tenants.data ?? []) {
    const l = src.get(r.listing_id as string);
    if (!l || r.listing_id === listingId || !rentRollAccessible(l, ctx)) continue;
    out.push({ key: `t:${r.id}`, kind: 'rentroll', listing_id: r.listing_id as string, label: label(l), detail: `Rent roll · ${r.suite ?? ''}${r.tenant_name ? ` ${r.tenant_name}` : ''}`.trim(), snippet: snip(r.notes) });
  }
  for (const r of vendors.data ?? []) {
    const l = src.get(r.listing_id as string);
    if (!l || r.listing_id === listingId || !listingAccessible(l, ctx)) continue;
    out.push({ key: `v:${r.id}`, kind: 'vendor', listing_id: r.listing_id as string, label: label(l), detail: String(r.label ?? r.vendor ?? 'Building note'), snippet: snip(r.notes) });
  }
  return out;
}

/** Every listing id that has at least one tagged note / call / task / deal anywhere (cheap pre-filter so callers only build lists for properties that have any).
 *  Read in pages: the database returns at most 1,000 rows per request, and a bulk tagging run can put well over that on one table. */
export async function taggedListingIds(limit = 120): Promise<string[]> {
  const db = adminClient();
  const tables = ['crm_clients', 'crm_client_activities', 'crm_call_log', 'crm_deals', 'crm_deal_notes', 'crm_deal_meetings', 'crm_tasks'];
  const ids = new Set<string>();
  for (const t of tables) {
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await db.from(t).select('tagged_listing_ids').not('tagged_listing_ids', 'eq', '{}').order('id').range(from, from + 999);
      if (error) return [];
      for (const x of data ?? []) for (const id of ((x as { tagged_listing_ids: string[] | null }).tagged_listing_ids ?? [])) ids.add(id);
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return [...ids].slice(0, limit);
}

export type TargetedItem = { contact_id: string; name: string; type: string | null };

/** People we reached out to about this property (an outreach list), kept apart from inquiries so "asked" stays honest. Same contact visibility as the asked list. */
export async function buildTargeted(ctx: CrmContext, listingId: string): Promise<{ total: number; items: TargetedItem[] }> {
  const db = adminClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await db.from('crm_clients').select('id, first_name, last_name, business_name, type, business_unit, lead_hold').contains('targeted_listing_ids', [listingId]).order('id').range(from, from + 999);
    if (error) return { total: 0, items: [] };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const vis = rows.filter(c => !(c.lead_hold && ctx.role !== 'super_admin') && (isAdminRole(ctx.role) || c.business_unit === ctx.businessUnit));
  return { total: vis.length, items: vis.slice(0, 25).map(c => ({ contact_id: c.id as string, name: (c.business_name as string) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: (c.type as string | null) ?? null })) };
}

/** { listingId: how many contacts are marked as targeted for it } for the caller (card badges). */
export async function targetedCounts(ctx: CrmContext): Promise<Record<string, number>> {
  const db = adminClient();
  const out: Record<string, number> = {};
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await db.from('crm_clients').select('targeted_listing_ids, business_unit, lead_hold').not('targeted_listing_ids', 'eq', '{}').order('id').range(from, from + 999);
    if (error) return out;
    for (const c of data ?? []) {
      if ((c.lead_hold && ctx.role !== 'super_admin') || !(isAdminRole(ctx.role) || c.business_unit === ctx.businessUnit)) continue;
      for (const id of ((c.targeted_listing_ids as string[] | null) ?? [])) out[id] = (out[id] ?? 0) + 1;
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

export type Funnel = { targeted: number; asked: number; followedUp: number; deals: number };

/** The property's funnel: contacts we reached out to → people who asked → asks that got a follow-up logged → deals on this property. Counts only what the caller may see. */
export async function buildFunnel(ctx: CrmContext, listingId: string, items: InquiryItem[], targetedTotal: number): Promise<Funnel> {
  const db = adminClient();
  const people = items.filter(i => i.via !== 'deal' && i.via !== 'task');
  const [byListing, byTag] = await Promise.all([
    db.from('crm_deals').select('id, business_unit').eq('listing_id', listingId).limit(500),
    db.from('crm_deals').select('id, business_unit').contains('tagged_listing_ids', [listingId]).limit(500),
  ]);
  const hidden = new Set(await hiddenDealIds(ctx));
  const ids = new Set<string>();
  for (const d of [...(byListing.data ?? []), ...(byTag.data ?? [])]) {
    if (hidden.has(d.id as string)) continue;
    if (!isAdminRole(ctx.role) && d.business_unit !== ctx.businessUnit) continue;
    ids.add(d.id as string);
  }
  return { targeted: targetedTotal, asked: people.length, followedUp: people.filter(i => i.followed_up).length, deals: ids.size };
}

export type OverviewRow = { listing_id: string; listing: string; asked: number; targeted: number; followedUp: number; deals: number; needsFollowUp: number; avgReplyDays: number | null };

/** One row per property the caller can see that has any tagged interest or outreach: the numbers behind each property's funnel, side by side. */
export async function buildOverview(ctx: CrmContext): Promise<OverviewRow[]> {
  const db = adminClient();
  const tcounts = await targetedCounts(ctx);
  const ids = [...new Set([...(await taggedListingIds(120)), ...Object.keys(tcounts)])].slice(0, 80);
  if (!ids.length) return [];
  const { data: lst } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').in('id', ids);
  const rows: OverviewRow[] = [];
  await Promise.all((lst ?? []).filter(l => listingAccessible(l as Record<string, unknown>, ctx)).map(async l => {
    const r = await buildInquiries(ctx, l.id as string);
    if (!r.ok) return;
    const f = await buildFunnel(ctx, l.id as string, r.items, tcounts[l.id as string] ?? 0);
    const people = r.items.filter(i => i.via !== 'deal' && i.via !== 'task');
    const days = people.map(i => i.responded_days).filter((x): x is number => typeof x === 'number');
    rows.push({
      listing_id: l.id as string, listing: String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'Property'),
      asked: f.asked, targeted: f.targeted, followedUp: f.followedUp, deals: f.deals, needsFollowUp: people.filter(i => i.needs_follow_up).length,
      avgReplyDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
    });
  }));
  return rows.filter(r => r.asked + r.targeted + r.deals > 0).sort((a, b) => b.asked - a.asked || b.targeted - a.targeted);
}
