import type { SupabaseClient } from '@supabase/supabase-js';

// The activity log of a My Drive document (crm_drive_doc_events): every change is recorded, best effort — logging must never fail the
// action it describes (and the table may not exist yet on an older database). Typing is saved every few seconds, so an editing session is
// ONE row: consecutive saves by the same person within EDIT_WINDOW_MS update that row (saves, characters before/after, last save time).

export type DocEventKind =
  | 'created' | 'edited' | 'renamed' | 'moved' | 'shared' | 'linked' | 'unlinked' | 'trashed' | 'restored'
  | 'version_saved' | 'version_restored' | 'commented' | 'deleted' | 'template_saved';

export interface DriveDocEvent {
  id: string; doc_id: string; actor_id: string | null; kind: DocEventKind; detail: Record<string, unknown>; created_at: string; updated_at: string;
}

// ── Mirroring to the cards' own activity feeds ──────────────────────────────────────────────────────────────────────────────────────────
// A live document shown on a contact card or a deal card also leaves a line in that card's activity feed (crm_client_activities — a deal's
// activity lives on its contact, like stage changes do). One line per editing session per card, updated as the session continues.
// A Restricted (private) deal writes NOTHING there: the feed is visible to everyone who can open the contact, the deal is not.

type FeedTarget = { clientId: string; type: 'note' | 'deal_update' };

async function feedTargets(admin: SupabaseClient, docId: string, only?: { dealId?: string; clientId?: string }): Promise<FeedTarget[]> {
  const { data: links } = await admin.from('crm_drive_doc_links').select('deal_id, client_id').eq('doc_id', docId);
  const out = new Map<string, FeedTarget>();
  for (const l of links ?? []) {
    if (only?.dealId && l.deal_id !== only.dealId) continue;
    if (only?.clientId && l.client_id !== only.clientId) continue;
    if (l.client_id) out.set(`${l.client_id}:note`, { clientId: l.client_id as string, type: 'note' });
    else if (l.deal_id) {
      const { data: d } = await admin.from('crm_deals').select('client_id, is_restricted').eq('id', l.deal_id).maybeSingle();
      if (d?.client_id && !d.is_restricted) out.set(`${d.client_id}:deal_update`, { clientId: d.client_id as string, type: 'deal_update' });
    }
  }
  return [...out.values()];
}

const personName = async (admin: SupabaseClient, id: string | null) => {
  if (!id) return 'Someone';
  const { data } = await admin.from('crm_profiles').select('first_name,last_name').eq('id', id).maybeSingle();
  return [data?.first_name, data?.last_name].filter(Boolean).join(' ') || 'A teammate';
};

/** Adds (or, when `existing` has the card's row, updates) the activity line for each card the document is linked to. Returns { "<client>:<type>": activity id }. */
export async function mirrorDocToFeeds(
  admin: SupabaseClient,
  e: { docId: string; actor: string | null; text: (title: string, who: string) => string; existing?: Record<string, string>; only?: { dealId?: string; clientId?: string } },
): Promise<Record<string, string>> {
  const feed: Record<string, string> = { ...(e.existing ?? {}) };
  try {
    const targets = await feedTargets(admin, e.docId, e.only);
    if (!targets.length) return feed;
    const { data: doc } = await admin.from('crm_drive_docs').select('title').eq('id', e.docId).maybeSingle();
    const note = `📄 ${e.text(String(doc?.title ?? 'a document'), await personName(admin, e.actor))}`;
    for (const t of targets) {
      const key = `${t.clientId}:${t.type}`;
      if (feed[key]) { await admin.from('crm_client_activities').update({ note }).eq('id', feed[key]); continue; }
      const { data } = await admin.from('crm_client_activities').insert({ client_id: t.clientId, agent_id: e.actor, type: t.type, note }).select('id').single();
      if (data?.id) feed[key] = data.id as string;
    }
  } catch (err) { console.error('[drive] feed mirror', err); }
  return feed;
}

export const EVENT_COLS = 'id,doc_id,actor_id,kind,detail,created_at,updated_at';
const EDIT_WINDOW_MS = 10 * 60_000;

export async function logDocEvent(
  admin: SupabaseClient,
  e: { docId: string; bu: string; actor: string | null; kind: DocEventKind; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await admin.from('crm_drive_doc_events').insert({ doc_id: e.docId, business_unit: e.bu, actor_id: e.actor, kind: e.kind, detail: e.detail ?? {} });
  } catch (err) { console.error('[drive] event log', err); }
}

/** One editing session = one row: a save by the same person within 10 minutes of the last event extends it, anything else starts a new row. */
export async function logDocEdit(
  admin: SupabaseClient,
  e: { docId: string; bu: string; actor: string; charsBefore: number; charsAfter: number; wordsAfter: number },
): Promise<void> {
  try {
    const { data: last } = await admin.from('crm_drive_doc_events').select('id,actor_id,kind,detail,updated_at').eq('doc_id', e.docId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const extend = !!last && last.kind === 'edited' && !(last.detail as { via?: string } | null)?.via && last.actor_id === e.actor && Date.now() - new Date(last.updated_at as string).getTime() < EDIT_WINDOW_MS;
    const prev = (extend ? last!.detail : {}) as { saves?: number; chars_before?: number; feed?: Record<string, string>; feed_at?: number };
    const detail: Record<string, unknown> = { saves: (prev.saves ?? 0) + 1, chars_before: prev.chars_before ?? e.charsBefore, chars_after: e.charsAfter, words_after: e.wordsAfter };
    if (prev.feed) detail.feed = prev.feed;
    if (prev.feed_at) detail.feed_at = prev.feed_at;
    let id: string | null = extend ? (last!.id as string) : null;
    if (extend) await admin.from('crm_drive_doc_events').update({ detail, updated_at: new Date().toISOString() }).eq('id', id);
    else { const { data } = await admin.from('crm_drive_doc_events').insert({ doc_id: e.docId, business_unit: e.bu, actor_id: e.actor, kind: 'edited', detail }).select('id').single(); id = (data?.id as string) ?? null; }

    // The cards' own feeds: write the line when a session starts, then refresh it at most once a minute while typing continues.
    if (id && (!prev.feed || Date.now() - (prev.feed_at ?? 0) > 60_000)) {
      const delta = e.charsAfter - Number(detail.chars_before);
      const saves = Number(detail.saves);
      const feed = await mirrorDocToFeeds(admin, { docId: e.docId, actor: e.actor, existing: prev.feed,
        text: (title, who) => `Live document “${title}” edited by ${who} — ${delta > 0 ? `added about ${delta.toLocaleString()} characters` : delta < 0 ? `removed about ${Math.abs(delta).toLocaleString()} characters` : 'wording changed'}${saves > 1 ? ` (${saves} saves)` : ''}` });
      if (Object.keys(feed).length) await admin.from('crm_drive_doc_events').update({ detail: { ...detail, feed, feed_at: Date.now() } }).eq('id', id);
    }
  } catch (err) { console.error('[drive] edit log', err); }
}
