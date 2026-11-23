// Finds where a document's signers initial, sign and date, and turns that into E-Sign fields — for the Copilot's
// prepare_esign tool. It reads the PDF's printed text (pdf.js) and looks for the blanks the way a person would:
//   • the page-footer line "Initialed for Identification by Landlord ____ and Broker ____"  → one initials box per page
//   • signature blocks: a party heading ("Landlord:", "Seller:", "Tenant:"), a "By (signature):" / "Signature:" blank
//     under it and a "Date:" blank near it
// A blank is an underlined space, a run of underscores, or room to the right of a label ending in ":" (forms such as
// the TXR set draw the line as a vector, so there is no text to find — the label is the landmark).
// Anything it cannot find is reported rather than guessed, and the caller falls back to the end of the last page.
// Field shape matches the E-Sign editor: fx/fw are fractions of page width, fy is the underline's distance from the
// TOP as a fraction of page height (lib/overlay-stamp.ts boxes are drawn upward from it).
import { readPdfText, type Item, type PageText } from '@/lib/doc-text-edit';

export type EsignRole = 'client' | 'landlord' | 'agent' | 'seller' | 'buyer' | 'witness' | 'other';
// `slot` = which of several same-role signers this spot is for (0 = first co-buyer / co-seller…). `text` spots are the printed
// name / title lines under a signature; `optional` ones (a title only an entity has) don't block signing when left empty.
export interface PrepField { id: string; type: 'initial' | 'signature' | 'date' | 'text'; page: number; fx: number; fy: number; fw: number; size: number; value: ''; signerRole: string; slot?: number; label?: string; optional?: boolean }
export interface PrepResult { fields: PrepField[]; warnings: string[]; pages: number; found: { initialsPages: number; signatureBlocks: number } }

const PARTY: Array<[RegExp, EsignRole]> = [
  [/\b(landlord|lessor|owner)\b/i, 'landlord'], [/\b(tenant|lessee)\b/i, 'client'],
  [/\b(seller|vendor)\b/i, 'seller'], [/\b(buyer|purchaser)\b/i, 'buyer'],
  [/\b(broker|agent|realtor|associate)\b/i, 'agent'], [/\bwitness\b/i, 'witness'],
  [/\b(guarantor|client|principal|customer)\b/i, 'client'],
];
/** Which party a label names, or null. "Landlord/Seller" resolves to the first one printed. */
export function roleOfLabel(label: string): EsignRole | null {
  let best: { at: number; role: EsignRole } | null = null;
  for (const [re, role] of PARTY) { const m = re.exec(label); if (m && (!best || m.index < best.at)) best = { at: m.index, role }; }
  return best?.role ?? null;
}

// ── blanks ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Slot { label: string; lx: number; x0: number; x1: number; y: number; kind: 'initial' | 'signature' | 'bare-by' | 'date' | 'other' }
interface Line { y: number; items: Item[] }

function linesOf(page: PageText): Line[] {
  const items = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Item[][] = [];
  for (const it of items) {
    const g = groups.find(g => Math.abs(g[0].y - it.y) < Math.max(2, it.h * 0.35));
    if (g) g.push(it); else groups.push([it]);
  }
  return groups.map(g => ({ y: g[0].y, items: g.sort((a, b) => a.x - b.x) })).sort((a, b) => b.y - a.y);
}

const PARTY_ONLY = /^\s*(landlord|tenant|seller|buyer|owner|lessor|lessee|purchaser|guarantor|client)(\s*\/\s*\w+)?\s*:?\s*$/i;
function kindOf(label: string, hasDateOnLine: boolean): Slot['kind'] {
  if (/\bdate\b/i.test(label)) return 'date';
  if (/\binitial/i.test(label)) return 'initial';
  // a signature LINE is labelled in a few words ("By (signature):"); a whole sentence that happens to say "sign" is just text
  if (/\(signature\)|\bsignature\b|\bsign(ed)?\b/i.test(label) && label.trim().split(/\s+/).length <= 6) return 'signature';
  if (/^\s*by\s*:?\s*$/i.test(label)) return 'bare-by';
  if (PARTY_ONLY.test(label) && hasDateOnLine) return 'signature';
  return 'other';
}

/** Every blank on a line, each labelled with the words printed just before it. */
function slotsOf(line: Line, pageW: number): Slot[] {
  const out: Slot[] = [];
  const its = line.items;
  const lineText = its.map(i => i.str).join('');
  const hasDate = /\bdate\b/i.test(lineText);
  let label = '', lx = its[0]?.x ?? 0;
  const push = (x0: number, x1: number, lbl: string, lxx: number) => out.push({ label: lbl.replace(/\s+/g, ' ').trim(), lx: lxx, x0, x1, y: line.y, kind: kindOf(lbl, hasDate) });
  its.forEach((it, i) => {
    const next = its[i + 1];
    const blankSpace = !it.str.trim() && it.w >= 12;
    const under = /_{3,}/.exec(it.str);
    if (blankSpace) { push(it.x, it.x + it.w, label, lx); label = ''; lx = next?.x ?? it.x + it.w; return; }
    if (under) {
      const n = Math.max(1, it.str.length);
      push(it.x + it.w * (under.index / n), it.x + it.w * ((under.index + under[0].length) / n), label + it.str.slice(0, under.index), lx);
      label = it.str.slice(under.index + under[0].length); return;
    }
    if (!label) lx = it.x;
    label += it.str;
    // "Date:" / "By (signature):" with nothing after it on the line → the line is drawn to its right
    if (/:\s*$/.test(it.str) && (!next || next.x - (it.x + it.w) > 8) && !(next && !next.str.trim() && next.w >= 12)) {
      const x0 = it.x + it.w, room = (next ? next.x - 6 : pageW - 36) - x0;
      const cap = /\bdate\b/i.test(it.str) ? 60 : 180;
      const colLimit = x0 < 300 ? 300 - x0 : room;
      push(x0, x0 + Math.max(24, Math.min(cap, room, colLimit)), label, lx); label = ''; lx = next?.x ?? x0;
    }
  });
  return out;
}

const HEADING = /^\s*(landlord|tenant|seller|buyer|owner|lessor|lessee|purchaser|guarantor|broker|agent|witness|client)\b[^,]{0,28}:?\s*$/i;
const uid = (() => { let n = 0; return (p: string) => `${p}-${Date.now().toString(36)}-${++n}`; })();
const pct = (n: number) => Math.round(n * 1000) / 1000;
function field(type: PrepField['type'], page: number, p: PageText, s: { x0: number; x1: number; y: number }, role: string, fw: [number, number], extra: Partial<PrepField> = {}): PrepField {
  return { id: uid(type === 'initial' ? 'ini' : type === 'date' ? 'date' : type === 'text' ? 'txt' : 'sig'), type, page, fx: pct((s.x0 + 3) / p.width), fy: pct((p.height - (s.y - 1.5)) / p.height),
    fw: pct(Math.min(fw[1], Math.max(fw[0], (s.x1 - s.x0 - 3) / p.width))), size: 11, value: '', signerRole: role, ...extra };
}
const NAME_LABEL = /^\s*(printed\s+|print\s+|typed\s+)?name\b/i;
const TITLE_LABEL = /^\s*title\b/i;

/**
 * Detect initial / signature / date (and printed-name / title) spots for the given signer roles.
 * `roles` are E-Sign role names (landlord, client, seller, buyer, agent…); a footer blank or signature block for a
 * party that isn't among them is ignored (e.g. the broker column when only the owner is signing). A role listed more
 * than once (two buyers) gets that many footer blanks / signature blocks, in printed order — `slot` says which.
 */
export async function detectSigningSpots(pdf: Uint8Array, roles: string[], want: { initials: boolean; signatures: boolean; dates: boolean; names?: boolean }): Promise<PrepResult> {
  const pages = await readPdfText(pdf);
  const warnings: string[] = [];
  const wantRole = new Set(roles);
  const cap = new Map<string, number>();
  for (const r of roles) cap.set(r, (cap.get(r) ?? 0) + 1);
  const fields: PrepField[] = [];
  let initialsPages = 0, sigBlocks = 0;
  const lineSlots = pages.map(p => linesOf(p).map(l => ({ line: l, slots: slotsOf(l, p.width) })));

  // ── initials: the footer line on each page ────────────────────────────────────────────────────────────────────
  if (want.initials) {
    type Blank = { x0: number; x1: number; y: number };
    const spots = new Map<string, (Blank[] | undefined)[]>();
    const add = (role: string, pi: number, b: Blank) => { const arr = spots.get(role) ?? []; (arr[pi] ??= []).push(b); spots.set(role, arr); };
    lineSlots.forEach((ls, pi) => {
      const foot = ls.find(({ line }) => /initial(ed)?\b/i.test(line.items.map(i => i.str).join('')) && /identification/i.test(line.items.map(i => i.str).join('')));
      if (!foot) {
        // "Tenant Initials: ____" in the bottom margin (our own lease template and many others)
        const p = pages[pi];
        for (const { slots } of ls) for (const sl of slots) {
          if (sl.y > p.height * 0.15 || !/\binitials?\b/i.test(sl.label)) continue;
          const role = roleOfLabel(sl.label) ?? (roles.length === 1 ? roles[0] : null);
          if (!role || !wantRole.has(role) || spots.get(role)?.[pi]) continue;
          add(role, pi, { x0: sl.x0, x1: sl.x1, y: sl.y });
        }
        return;
      }
      // "Initialed for Identification by Seller ___, ___ and Buyer ___, ___": a party label, then its blank(s). A short
      // unlabelled blank right after a party's blank is that party's second (co-signer's) initials.
      const seen = new Set<string>();
      let cur: string | null = null;
      for (const s of foot.slots) {
        const tail = (s.label.split(/\bby\b/i).pop() ?? s.label).split(/\band\b/i).pop() ?? s.label;
        const named = roleOfLabel(tail);
        let role: string | null = null;
        if (named) { if (seen.has(named)) { cur = null; continue; } seen.add(named); cur = named; role = named; }
        else if (cur && !/[a-z]/i.test(s.label) && s.x1 - s.x0 <= 120) role = cur;
        if (!role || !wantRole.has(role)) continue;
        // a trailing blank also holds the gap up to the page number, so it is only ever as wide as the party's first one
        const firstW = named ? 0 : (spots.get(role)?.[pi]?.[0] ? spots.get(role)![pi]![0].x1 - spots.get(role)![pi]![0].x0 : 30);
        add(role, pi, { x0: s.x0, x1: named ? s.x1 : s.x0 + Math.min(s.x1 - s.x0, firstW), y: s.y });
      }
    });
    for (const role of wantRole) {
      const arr = spots.get(role);
      if (!arr || !arr.some(Boolean)) {
        if (spots.size) warnings.push(`The page footers only have an initials line for ${[...spots.keys()].join(', ')} — no initials boxes for the ${role}.`);
        continue;
      }
      const known = arr.map((b, i) => (b ? i : -1)).filter(i => i >= 0);
      const first = known[0], last = known[known.length - 1];
      const ref = arr[known[Math.floor(known.length / 2)]]!;
      const printed = Math.max(...known.map(i => arr[i]!.length));
      const want_n = cap.get(role) ?? 1;
      const n = Math.min(want_n, printed);
      if (want_n > printed) warnings.push(`The page footers only have ${printed === 1 ? 'one initials blank' : `${printed} initials blanks`} for the ${role} — the other ${role}${want_n - printed > 1 ? 's need' : ' needs'} initials boxes placed by hand.`);
      const missing: number[] = [], skipped: number[] = [];
      pages.forEach((p, pi) => {
        const cell = arr[pi];
        // A page with no printed initials line before the first / after the last one is a cover or signature page — no box there.
        if (!cell && (pi < first || pi > last)) { skipped.push(pi + 1); return; }
        if (!cell) missing.push(pi + 1);
        const use = cell ?? ref;
        for (let k = 0; k < n; k++) {
          const b = use[k]; if (!b) continue;
          // The box is as wide as the printed blank, so it sits in it instead of spilling over the text beside it.
          fields.push(field('initial', pi + 1, p, b, role, [0.045, 0.09], { slot: k }));
        }
      });
      initialsPages = Math.max(initialsPages, known.length);
      if (missing.length) warnings.push(`No printed initials line on page${missing.length > 1 ? 's' : ''} ${missing.join(', ')} — I put the ${role}'s initials box in the same spot as the other pages; check it.`);
      if (skipped.length) warnings.push(`No initials line on page${skipped.length > 1 ? 's' : ''} ${skipped.join(', ')} (no printed blank for the ${role}) — left without initials boxes.`);
    }
    if (!fields.some(f => f.type === 'initial')) {
      const role = roles[0] ?? 'client';
      warnings.push('I could not find a printed “initialed for identification” line, so I put an initials box in the bottom-right corner of every page. Check they don’t cover any text.');
      pages.forEach((_, pi) => fields.push({ id: uid('ini'), type: 'initial', page: pi + 1, fx: 0.86, fy: 0.972, fw: 0.06, size: 11, value: '', signerRole: role, slot: 0 }));
    }
  }

  // ── signature blocks ───────────────────────────────────────────────────────────────────────────────────────────
  const doneCount = new Map<string, number>();
  if (want.signatures || want.dates) {
    pages.forEach((p, pi) => {
      const ls = lineSlots[pi];
      const all = ls.flatMap(({ slots }) => slots);
      // party headings on this page, with where they sit
      const heads = ls.flatMap(({ line }) => line.items.filter(i => i.str.trim() && HEADING.test(i.str)).map(i => ({ x: i.x, y: i.y, role: roleOfLabel(i.str) })));
      const sigs = all.filter(s => s.kind === 'signature' || s.kind === 'bare-by');
      // top-to-bottom, so the first block of a role is its main signer's
      for (const s of [...sigs].sort((a, b) => b.y - a.y)) {
        const head = heads.filter(h => h.y > s.y && h.y - s.y < 260 && Math.abs(h.x - s.lx) < 45).sort((a, b) => a.y - b.y)[0];
        // "By:" above a "By (signature):" in the same block is just the lead-in; use the signature line
        if (s.kind === 'bare-by' && sigs.some(o => o.kind === 'signature' && o.y < s.y && s.y - o.y < 60 && Math.abs(o.lx - s.lx) < 45)) continue;
        let role = head?.role ?? roleOfLabel(s.label);
        if (!role && roles.length === 1) role = roles[0] as EsignRole;
        if (!role) { warnings.push(`Page ${pi + 1}: found a signature line but could not tell whose it is — left it out.`); continue; }
        if (!wantRole.has(role)) continue;   // someone who isn't signing this time
        const slot = doneCount.get(role) ?? 0;
        if (slot >= (cap.get(role) ?? 1)) {
          warnings.push(`Page ${pi + 1}: there is another ${role} signature block (a co-signer) — I only placed ${slot === 1 ? 'the first one' : `the first ${slot}`}.`);
          continue;
        }
        doneCount.set(role, slot + 1); sigBlocks++;
        if (want.signatures) fields.push(field('signature', pi + 1, p, s, role, [0.18, 0.4], { slot }));
        const sameLeft = s.x0 < 300;
        if (want.dates) {
          // the date for this signature: on the same line to its right, else the nearest date blank just below in the same column
          const d = all.filter(o => o.kind === 'date' && ((Math.abs(o.y - s.y) < 3 && o.x0 > s.x1 - 2) || (o.y < s.y - 3 && s.y - o.y < 80 && (o.x0 < 300) === sameLeft))).sort((a, b) => b.y - a.y || a.x0 - b.x0)[0];
          if (d) fields.push(field('date', pi + 1, p, d, role, [0.08, 0.2], { slot }));
          else warnings.push(`Page ${pi + 1}: no date blank next to the ${role}'s signature — no date field added there.`);
        }
        if (want.names) {
          // "Printed Name:" and "Title:" lines under this signature, in the same column
          const below = all.filter(o => o.kind === 'other' && o.y < s.y - 3 && s.y - o.y < 70 && (o.x0 < 300) === sameLeft && Math.abs(o.lx - s.lx) < 45).sort((a, b) => b.y - a.y);
          const nm = below.find(o => NAME_LABEL.test(o.label)), ti = below.find(o => TITLE_LABEL.test(o.label));
          if (nm) fields.push(field('text', pi + 1, p, nm, role, [0.16, 0.34], { slot, label: 'Printed name', size: 10 }));
          if (ti) fields.push(field('text', pi + 1, p, ti, role, [0.12, 0.3], { slot, label: 'Title', size: 10, optional: true }));
        }
      }
    });
    // Signers with no block found: signature + date at the foot of the last page, so nothing is silently missing
    let stack = 0;
    for (const role of new Set(roles)) {
      if ((doneCount.get(role) ?? 0) > 0 || !want.signatures) continue;
      warnings.push(`I could not find a printed signature line for the ${role}, so I put a signature box${want.dates ? ' and date' : ''} near the bottom of the last page (page ${pages.length}). Check the placement before sending.`);
      const y0 = pct(0.9 - stack * 0.07); stack++;
      fields.push({ id: uid('sig'), type: 'signature', page: pages.length, fx: 0.12, fy: y0, fw: 0.32, size: 11, value: '', signerRole: role, slot: 0 });
      if (want.dates) fields.push({ id: uid('date'), type: 'date', page: pages.length, fx: 0.55, fy: y0, fw: 0.14, size: 11, value: '', signerRole: role, slot: 0 });
    }
  }
  return { fields, warnings, pages: pages.length, found: { initialsPages, signatureBlocks: sigBlocks } };
}
