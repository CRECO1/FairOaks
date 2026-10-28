// Email drafts. The browser keeps a local copy (so the composer can restore instantly, offline, and even before
// the server table exists) and mirrors it to /api/crm/email-drafts so a draft started on the phone shows up on
// the desktop. Local is the cache; the server is the shared truth once the table is in place.

export type DraftContext = {
  kind: 'deal' | 'contact' | 'dock';
  id?: string;        // deal id / contact id
  label?: string;     // "Nick Medeiros" — shown in the Drafts list
  replyToId?: string; // crm_deal_emails row being replied to, so a resumed reply stays in its thread
};
export type EmailDraft = {
  key: string; subject: string; to: string; moreTo: string; cc: string; bcc: string;
  bodyHtml: string; context: DraftContext; updatedAt: number;
};

const LOCAL = 'crm_email_drafts_v2';
const SYNCED = 'crm_email_drafts_synced_v2';
const EVENT = 'crm-drafts-changed';

let authToken = '';
let serverReady: boolean | null = null; // null = not asked yet, false = table not created yet

export function setDraftAuth(token: string | undefined) { authToken = token ?? ''; }
export const draftsServerReady = () => serverReady;

const readAll = (): Record<string, EmailDraft> => { try { const v = JSON.parse(localStorage.getItem(LOCAL) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const writeAll = (m: Record<string, EmailDraft>) => { try { localStorage.setItem(LOCAL, JSON.stringify(m)); } catch { /* storage full or blocked */ } };
const readSynced = (): string[] => { try { const v = JSON.parse(localStorage.getItem(SYNCED) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeSynced = (k: string[]) => { try { localStorage.setItem(SYNCED, JSON.stringify([...new Set(k)])); } catch { /* ignore */ } };
const changed = () => { try { window.dispatchEvent(new Event(EVENT)); } catch { /* ignore */ } };
const headers = (): Record<string, string> => (authToken ? { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' });

export function onDraftsChanged(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function getDraft(key: string): EmailDraft | null { return readAll()[key] ?? null; }

export function listDrafts(): EmailDraft[] {
  return Object.values(readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
}

const toRow = (d: EmailDraft) => ({ draft_key: d.key, subject: d.subject, to: d.to, more_to: d.moreTo, cc: d.cc, bcc: d.bcc, body_html: d.bodyHtml, context: d.context });

async function pushOne(d: EmailDraft) {
  if (serverReady === false) return;
  try {
    const r = await fetch('/api/crm/email-drafts', { method: 'PUT', headers: headers(), body: JSON.stringify(toRow(d)) });
    const j = await r.json().catch(() => ({}));
    if (j?.setup_needed) { serverReady = false; return; }
    if (r.ok) { serverReady = true; writeSynced([...readSynced(), d.key]); }
  } catch { /* offline — the local copy still has it; the next sync pushes it */ }
}

export function saveDraft(d: Omit<EmailDraft, 'updatedAt'>) {
  const full: EmailDraft = { ...d, updatedAt: Date.now() };
  const all = readAll(); all[d.key] = full; writeAll(all);
  changed();
  void pushOne(full);
}

export function deleteDraft(key: string) {
  const all = readAll();
  if (!(key in all)) return;
  delete all[key]; writeAll(all);
  writeSynced(readSynced().filter(k => k !== key));
  changed();
  if (serverReady === false) return;
  void fetch(`/api/crm/email-drafts?key=${encodeURIComponent(key)}`, { method: 'DELETE', headers: headers() }).catch(() => {});
}

// Pull the server's drafts into the local cache (newer wins), push up any that only exist here, and drop
// ones another device deleted. Safe to call often.
export async function syncDrafts(): Promise<void> {
  if (!authToken) return;
  try {
    const r = await fetch('/api/crm/email-drafts', { headers: headers() });
    if (!r.ok) return;
    const j = await r.json();
    if (j.setup_needed) { serverReady = false; return; }
    serverReady = true;
    const remote = (j.drafts ?? []) as Array<{ draft_key: string; subject: string; to_emails: string; more_to: string; cc_emails: string; bcc_emails: string; body_html: string; context: DraftContext; updated_at: string }>;
    const local = readAll();
    const synced = new Set(readSynced());
    const remoteKeys = new Set<string>();
    let dirty = false;
    for (const d of remote) {
      remoteKeys.add(d.draft_key);
      const t = new Date(d.updated_at).getTime();
      const mine = local[d.draft_key];
      if (!mine || t > mine.updatedAt) {
        local[d.draft_key] = { key: d.draft_key, subject: d.subject, to: d.to_emails, moreTo: d.more_to, cc: d.cc_emails, bcc: d.bcc_emails, bodyHtml: d.body_html, context: d.context ?? { kind: 'dock' }, updatedAt: t };
        dirty = true;
      }
      synced.add(d.draft_key);
    }
    for (const key of Object.keys(local)) {
      if (remoteKeys.has(key)) continue;
      if (synced.has(key)) { delete local[key]; synced.delete(key); dirty = true; } // deleted on another device
      else void pushOne(local[key]);                                                   // only exists here
    }
    writeAll(local); writeSynced([...synced]);
    if (dirty) changed();
  } catch { /* offline — try again next time */ }
}
