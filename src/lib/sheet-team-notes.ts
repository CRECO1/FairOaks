import * as Y from 'yjs';
import { tabsMap, tCells } from '@/lib/drive-sheet';

// The pure part of the sheet-note mirror (see sheet-note-mirror.ts): read the team columns of a live-feed sheet and work out
// which contacts' notes changed between two saves. No database, no auth — so it is cheap to test on its own.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s<>,;"|]+@[^@\s<>,;"|]+\.[^@\s<>,;"|]+$/;
const MAX_NOTE = 1000;
export const MAX_CONTACTS_PER_SAVE = 200;

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));

/** The text every team column holds for each feed row: `<tabId>|<rowKey>` → text. Formulas are not notes. */
export function teamNotesByRow(stateB64: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!stateB64) return out;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes(stateB64));
    if (!doc.share.has('tabs')) return out;
    tabsMap(doc).forEach((tab, tabId) => {
      if (!(tab instanceof Y.Map) || typeof tab.get('feed') !== 'string') return;
      const keys = tab.get('feedKeys'), cells = tab.get('cells');
      const from = Number(tab.get('feedCols'));
      if (!(keys instanceof Y.Map) || !(cells instanceof Y.Map) || !Number.isFinite(from)) return;
      let maxC = from - 1;
      (cells as Y.Map<string>).forEach((_v, k) => { const c = Number(k.split(':')[1]); if (c > maxC) maxC = c; });
      if (maxC < from) return;
      const cs = tCells(tab);
      (keys as Y.Map<number>).forEach((r, rowKey) => {
        const parts: string[] = [];
        for (let c = from; c <= maxC; c++) {
          const v = String(cs.get(`${r}:${c}`) ?? '').trim();
          if (!v || v.startsWith('=')) continue;
          const head = String(cs.get(`0:${c}`) ?? '').trim();
          parts.push(!head || /^team notes?$/i.test(head) ? v : `${head}: ${v}`);
        }
        if (parts.length) out.set(`${tabId}|${rowKey}`, parts.join(' · '));
      });
    });
  } catch { /* an unreadable state mirrors nothing */ } finally { doc.destroy(); }
  return out;
}

/** Row key → the contact it is about: the part before the first "|" is the contact id, or (outreach rows with no contact yet) their email. */
const contactRef = (tabRowKey: string): string | null => {
  const rowKey = tabRowKey.slice(tabRowKey.indexOf('|') + 1);
  const first = rowKey.split('|')[0].trim();
  return UUID_RE.test(first) ? first.toLowerCase() : EMAIL_RE.test(first) ? first.toLowerCase() : null;
};

/** Contact ref → all of that contact's notes in the sheet, joined (a contact can have several rows, e.g. emailed twice). */
export function notesByContact(rows: Map<string, string>): Map<string, string> {
  const per = new Map<string, string[]>();
  rows.forEach((text, k) => { const ref = contactRef(k); if (ref) per.set(ref, [...(per.get(ref) ?? []), text]); });
  const out = new Map<string, string>();
  per.forEach((list, ref) => out.set(ref, [...new Set(list)].join(' · ').slice(0, MAX_NOTE)));
  return out;
}

/** The contacts whose combined note differs between two saves of the sheet (added, edited or cleared). */
export function changedContacts(before: string | null | undefined, after: string): Array<{ ref: string; text: string }> {
  const a = notesByContact(teamNotesByRow(before)), b = notesByContact(teamNotesByRow(after));
  const refs = new Set([...a.keys(), ...b.keys()]);
  return [...refs].filter(r => (a.get(r) ?? '') !== (b.get(r) ?? '')).map(ref => ({ ref, text: b.get(ref) ?? '' }));
}

