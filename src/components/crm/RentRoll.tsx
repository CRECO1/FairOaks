'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// The property's rent roll — one editable row per suite, replacing the Excel master
// (rent roll + suite directory + mailbox/key log were all keyed by suite, so they're
// one table here). Edits save on blur and mirror the tenant onto the Floor Plan.
// Below it: the building's vendor list and building-info notes.

export interface RentRollRow {
  id: string; suite?: string | null; building?: string | null; tenant_name?: string | null;
  size_sf?: number | null; lease_type?: string | null; lease_start?: string | null; lease_expiration?: string | null;
  monthly_rent?: number | null; annual_rent?: number | null; rent_psf?: number | null; pct_share?: number | null;
  mailbox_box?: string | null; keys?: number | null; email?: string | null; contact_name?: string | null;
  contact_id?: string | null; crm_clients?: CrmContact | null;
  renewal_status?: string | null; notes?: string | null; sort_order?: number | null;
}
export interface CrmContact { id: string; first_name?: string; last_name?: string; business_name?: string; email?: string; phone?: string; cell_phone?: string; type?: string }
interface VendorRow { id: string; category: string; label?: string | null; vendor?: string | null; contact?: string | null; phone?: string | null; notes?: string | null; sort_order?: number | null }

const GOLD = '#c9922c';
const authOf = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const isVacant = (r: RentRollRow) => !r.tenant_name || /^vacant$/i.test(r.tenant_name.trim());
const contactName = (c: CrmContact) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email || 'Unnamed contact';
// What shows in the Contact column: the linked CRM contact wins, then the typed name.
const rowContact = (r: RentRollRow) => r.crm_clients ? contactName(r.crm_clients) : (r.contact_name ?? '');
const normName = (v?: string | null) => String(v ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const money = (n?: number | null) => (n === null || n === undefined || n === '' as unknown) ? '' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

// Lease status straight from the expiration date — same bands (and colours) the
// spreadsheet used, so the sheet's red/orange/yellow key still reads the same.
function leaseStatus(exp?: string | null): { label: string; bg: string; color: string } | null {
  if (!exp) return null;
  const days = Math.floor((new Date(exp + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (days < 0) return { label: 'Expired', bg: '#fee2e2', color: '#b91c1c' };
  if (days <= 60) return { label: `${days}d left`, bg: '#fee2e2', color: '#b91c1c' };
  if (days <= 90) return { label: '61-90 days', bg: '#ffedd5', color: '#c2410c' };
  if (days <= 120) return { label: '91-120 days', bg: '#fef9c3', color: '#a16207' };
  return { label: 'Current', bg: '#f0fdf4', color: '#15803d' };
}

type SortKey = 'suite' | 'building' | 'tenant_name' | 'size_sf' | 'lease_expiration' | 'monthly_rent' | 'annual_rent' | 'lease_type' | 'mailbox_box' | 'keys' | 'email' | 'contact_name';
const NUMERIC_COLS = new Set<SortKey>(['size_sf', 'monthly_rent', 'annual_rent', 'keys']);
// Column headers. `k` makes the column sortable; Status has no key of its own because
// it's derived from the expiration date — sort by Lease Exp to get the same order.
const HEAD: { label: string; w: number; k?: SortKey; right?: boolean }[] = [
  { label: 'Suite', w: 62, k: 'suite' },
  { label: 'Bldg', w: 44, k: 'building' },
  { label: 'Tenant', w: 168, k: 'tenant_name' },
  { label: 'Sq Ft', w: 66, k: 'size_sf', right: true },
  { label: 'Lease Exp', w: 106, k: 'lease_expiration' },
  { label: 'Status', w: 92 },
  { label: 'Monthly', w: 86, k: 'monthly_rent', right: true },
  { label: 'Annual', w: 86, k: 'annual_rent', right: true },
  { label: 'Type', w: 62, k: 'lease_type' },
  { label: 'Box', w: 58, k: 'mailbox_box' },
  { label: 'Keys', w: 48, k: 'keys', right: true },
  { label: 'Email', w: 178, k: 'email' },
  { label: 'Contact', w: 130, k: 'contact_name' },
  { label: 'Notes', w: 160 },
];

const TH: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '7px 8px', fontSize: 10.5, letterSpacing: .5, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800, textAlign: 'left', whiteSpace: 'nowrap' };
const TD: React.CSSProperties = { borderBottom: '1px solid #f1f2f4', padding: 0, verticalAlign: 'middle' };

// One inline-editable cell: commits on blur (or Enter), reverts on Escape.
function Cell({ value, onSave, align, width, placeholder, type = 'text', bold, money }: {
  value: string | number | null | undefined; onSave: (v: string) => void;
  align?: 'left' | 'right'; width?: number; placeholder?: string; type?: string; bold?: boolean; money?: boolean;
}) {
  const [v, setV] = useState<string | number>(value ?? '');
  const [focused, setFocused] = useState(false);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setV(value ?? ''); }, [value]);
  // Money reads as $1,234 at rest and as plain digits while you're editing it.
  const shown = money && !focused && String(v ?? '') !== ''
    ? '$' + Number(String(v).replace(/[^0-9.-]/g, '') || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v;
  const commit = () => {
    setFocused(false);
    if (!dirty.current) return;
    dirty.current = false;
    const raw = money ? String(v ?? '').replace(/[^0-9.-]/g, '') : String(v ?? '');
    if (raw !== String(value ?? '')) onSave(raw);
  };
  return (
    <input
      value={shown as string | number}
      type={money ? 'text' : type}
      inputMode={money ? 'decimal' : undefined}
      placeholder={placeholder}
      onChange={e => { dirty.current = true; setV(e.target.value); }}
      onFocus={e => { setFocused(true); e.currentTarget.style.background = '#fffdf3'; e.currentTarget.style.boxShadow = `inset 0 0 0 2px ${GOLD}33`; }}
      onBlur={e => { commit(); e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { dirty.current = false; setV(value ?? ''); (e.target as HTMLInputElement).blur(); }
      }}
      style={{ width: width ?? '100%', minWidth: width ?? 0, border: 'none', outline: 'none', background: 'transparent',
        padding: '7px 8px', fontSize: 12.5, fontFamily: "'DM Sans',sans-serif", color: '#1a1a1a',
        textAlign: align ?? 'left', fontWeight: bold ? 700 : 400, boxSizing: 'border-box' }}
    />
  );
}

// The suite's Contact — a real CRM contact, not free text. Click it to search the
// contact list; picking one links the record so name/email track the contact card.
// A name that isn't in the CRM can still be typed and kept as plain text.
function ContactCell({ row, contacts, onLink, onText, onCreate }: {
  row: RentRollRow; contacts: CrmContact[];
  onLink: (c: CrmContact | null) => void; onText: (v: string) => void;
  onCreate: (name: string) => Promise<CrmContact | null>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const linked = row.crm_clients ?? null;
  const shown = rowContact(row);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return contacts.filter(c => `${c.first_name ?? ''} ${c.last_name ?? ''} ${c.business_name ?? ''} ${c.email ?? ''}`
      .toLowerCase().includes(needle)).slice(0, 8);
  }, [q, contacts]);

  if (!open) return (
    <button onClick={() => { setOpen(true); setQ(linked ? '' : (row.contact_name ?? '')); }}
      title={linked ? [contactName(linked), linked.email, linked.phone || linked.cell_phone].filter(Boolean).join(' · ') : 'Link a contact'}
      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
        padding: '7px 8px', fontSize: 12.5, fontFamily: "'DM Sans',sans-serif",
        color: linked ? '#111' : shown ? '#6b7280' : '#c0c4cc', fontWeight: linked ? 600 : 400,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {linked ? <span style={{ color: GOLD, marginRight: 4 }}>●</span> : null}
      {shown || 'Link contact'}
    </button>
  );

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search contacts…"
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); return; }
          if (e.key === 'Enter') { if (matches[0]) { onLink(matches[0]); setOpen(false); } else { onText(q); setOpen(false); } }
        }}
        style={{ width: '100%', border: 'none', outline: 'none', background: '#fffdf3', boxShadow: `inset 0 0 0 2px ${GOLD}33`,
          padding: '7px 8px', fontSize: 12.5, fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box' }} />
      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, minWidth: 240, background: '#fff',
        border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.14)', overflow: 'hidden' }}>
        {matches.map(c => (
          <button key={c.id} onClick={() => { onLink(c); setOpen(false); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none',
              borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{contactName(c)}</div>
            {c.email && <div style={{ fontSize: 11, color: '#9ca3af' }}>{c.email}</div>}
          </button>
        ))}
        {q.trim() && matches.length === 0 && (
          <>
            <button onClick={async () => { const c = await onCreate(q); if (c) { onLink(c); setOpen(false); } }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none', borderBottom: '1px solid #f3f4f6', background: '#fffdf3', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 12.5, color: GOLD, fontWeight: 700 }}>
              ＋ Add “{q.trim()}” as a new contact
            </button>
            <button onClick={() => { onText(q); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none', background: '#fff', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 12.5, color: '#6b7280' }}>
              No contact matches — keep “{q.trim()}” as text
            </button>
          </>
        )}
        {!q.trim() && <div style={{ padding: '8px 11px', fontSize: 12, color: '#9ca3af' }}>Type a name, business or email…</div>}
        {linked && (
          <button onClick={() => { onLink(null); setOpen(false); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none', borderTop: '1px solid #f3f4f6', background: '#fafafa', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#b91c1c' }}>
            ✕ Unlink {contactName(linked)}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RentRoll({ listingId, authToken, isAdmin, contacts = [], onToast }: {
  listingId: string; authToken?: string; isAdmin?: boolean; contacts?: CrmContact[]; onToast?: (m: string) => void;
}) {
  const [rows, setRows] = useState<RentRollRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  // Contacts created inline here — merged into the search so they're instantly pickable.
  const [localContacts, setLocalContacts] = useState<CrmContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showVacant, setShowVacant] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 1 | -1 }>({ key: null, dir: 1 });
  const [expanded, setExpanded] = useState(false);   // full-screen: see the whole sheet at once
  const toggleSort = (k: SortKey) => setSort(s => s.key !== k ? { key: k, dir: 1 } : s.dir === 1 ? { key: k, dir: -1 } : { key: null, dir: 1 });

  const load = useCallback(async () => {
    setLoading(true);
    const [a, b] = await Promise.all([
      fetch(`/api/crm/rent-roll?listing_id=${listingId}`, { headers: authOf(authToken) }).then(r => r.json()).catch(() => ({})),
      fetch(`/api/crm/listing-vendors?listing_id=${listingId}`, { headers: authOf(authToken) }).then(r => r.json()).catch(() => ({})),
    ]);
    setRows(a.rows ?? []); setVendors(b.rows ?? []); setLoading(false);
  }, [listingId, authToken]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Optimistic save — the row updates on screen immediately, then persists.
  const saveCell = async (id: string, field: keyof RentRollRow, value: string) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value === '' ? null : value } as RentRollRow : r));
    const res = await fetch('/api/crm/rent-roll', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ id, [field]: value }) });
    if (!res.ok) { onToast?.('Could not save that change'); load(); return; }
    const j = await res.json().catch(() => ({}));
    if (j.row) setRows(rs => rs.map(r => r.id === id ? j.row : r));
  };
  // Linking writes the id and mirrors the name into contact_name, so the CSV export
  // and a contacts-less read still show who it is.
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch('/api/crm/rent-roll', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ id, ...body }) });
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({}));
    if (j.row) setRows(rs => rs.map(r => r.id === id ? j.row : r));
    return j.row as RentRollRow | null;
  };
  const linkContact = async (row: RentRollRow, c: CrmContact | null) => {
    const body: Record<string, unknown> = c
      ? { contact_id: c.id, contact_name: contactName(c), ...(row.email ? {} : c.email ? { email: c.email } : {}) }
      : { contact_id: null };
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, contact_id: c?.id ?? null, crm_clients: c, contact_name: c ? contactName(c) : r.contact_name } : r));
    if (!(await patch(row.id, body))) { onToast?.('Could not save that contact'); load(); }
  };
  // A typed name that isn't in the CRM: keep the text, drop any stale link.
  const setContactText = async (row: RentRollRow, v: string) => {
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, contact_name: v || null, contact_id: null, crm_clients: null } : r));
    if (!(await patch(row.id, { contact_name: v, contact_id: null }))) { onToast?.('Could not save that contact'); load(); }
  };
  // Create a brand-new contact in the master list (crm_clients) so a suite tenant
  // that isn't a contact yet gets added ONCE and linked — no duplicates.
  const createContact = async (name: string, row?: RentRollRow): Promise<CrmContact | null> => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    try {
      const res = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          first_name: parts[0],
          last_name: parts.slice(1).join(' ') || null,
          type: 'Tenant',
          // Carry across what the suite already knows, so the new contact isn't a
          // bare name: the tenant is their company, and the row often has an email.
          business_name: row && !isVacant(row) ? (row.tenant_name ?? null) : null,
          email: row?.email ?? null,
          lead_source: 'Rent Roll',
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.contact) { onToast?.('Could not create the contact'); return null; }
      setLocalContacts(l => [j.contact as CrmContact, ...l]);
      return j.contact as CrmContact;
    } catch { onToast?.('Could not create the contact'); return null; }
  };

  // The rent roll came out of a spreadsheet, so its contacts are names and emails
  // rather than links. Match what we safely can in one pass: email is exact, and a
  // name only counts when exactly one contact answers to it.
  const [matching, setMatching] = useState(false);
  const unlinked = useMemo(() => rows.filter(r => !r.contact_id && (r.contact_name || r.email)), [rows]);
  const matchContacts = async () => {
    const byEmail = new Map<string, CrmContact>();
    const byName = new Map<string, CrmContact[]>();
    for (const c of contacts) {
      if (c.email) byEmail.set(c.email.toLowerCase().trim(), c);
      for (const n of [normName(`${c.first_name ?? ''} ${c.last_name ?? ''}`), normName(c.business_name)]) {
        if (n) byName.set(n, [...(byName.get(n) ?? []), c]);
      }
    }
    const hits: { row: RentRollRow; c: CrmContact }[] = [];
    for (const r of unlinked) {
      const byN = byName.get(normName(r.contact_name));
      const c = (byN?.length === 1 ? byN[0] : null) ?? (r.email ? byEmail.get(r.email.toLowerCase().trim()) : null);
      if (c) hits.push({ row: r, c });
    }
    if (!hits.length) { onToast?.('No suites matched a contact by name or email'); return; }
    if (!window.confirm(`Link ${hits.length} suite${hits.length === 1 ? '' : 's'} to matching contacts?\n\n${hits.slice(0, 8).map(h => `${h.row.suite || '—'}  →  ${contactName(h.c)}`).join('\n')}${hits.length > 8 ? `\n…and ${hits.length - 8} more` : ''}`)) return;
    setMatching(true);
    for (const h of hits) await linkContact(h.row, h.c);
    setMatching(false);
    onToast?.(`Linked ${hits.length} suite${hits.length === 1 ? '' : 's'} to contacts`);
  };

  const addSuite = async () => {
    const res = await fetch('/api/crm/rent-roll', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ listing_id: listingId, tenant_name: 'Vacant', sort_order: (rows.at(-1)?.sort_order ?? rows.length) + 1 }) });
    if (!res.ok) { onToast?.('Could not add a suite'); return; }
    const j = await res.json(); setRows(rs => [...rs, j.row]); onToast?.('Suite added — fill in the details');
  };
  const removeSuite = async (r: RentRollRow) => {
    if (!window.confirm(`Remove suite ${r.suite || ''}${r.tenant_name ? ` (${r.tenant_name})` : ''} from the rent roll?`)) return;
    const res = await fetch(`/api/crm/rent-roll?id=${r.id}`, { method: 'DELETE', headers: authOf(authToken) });
    if (!res.ok) { onToast?.('Could not remove the suite'); return; }
    setRows(rs => rs.filter(x => x.id !== r.id)); onToast?.('Suite removed');
  };
  const saveVendor = async (id: string, field: keyof VendorRow, value: string) => {
    setVendors(vs => vs.map(v => v.id === id ? { ...v, [field]: value || null } as VendorRow : v));
    const res = await fetch('/api/crm/listing-vendors', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ id, [field]: value }) });
    if (!res.ok) onToast?.('Could not save that change');
  };
  const addVendor = async (category: 'vendor' | 'building_info') => {
    const res = await fetch('/api/crm/listing-vendors', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ listing_id: listingId, category, sort_order: vendors.length }) });
    if (!res.ok) { onToast?.('Could not add the row'); return; }
    const j = await res.json(); setVendors(vs => [...vs, j.row]);
  };
  const removeVendor = async (id: string, label?: string) => {
    if (!window.confirm(`Remove ${label ? `"${label}"` : 'this row'}?`)) return;
    const res = await fetch(`/api/crm/listing-vendors?id=${id}`, { method: 'DELETE', headers: authOf(authToken) });
    if (!res.ok) { onToast?.('Could not remove the row'); return; }
    setVendors(vs => vs.filter(v => v.id !== id));
  };

  const stats = useMemo(() => {
    const occ = rows.filter(r => !isVacant(r));
    const vac = rows.filter(isVacant);
    const sf = rows.reduce((s, r) => s + (Number(r.size_sf) || 0), 0);
    const occSf = occ.reduce((s, r) => s + (Number(r.size_sf) || 0), 0);
    const mo = occ.reduce((s, r) => s + (Number(r.monthly_rent) || 0), 0);
    const yr = occ.reduce((s, r) => s + (Number(r.annual_rent) || Number(r.monthly_rent || 0) * 12), 0);
    const in12 = occ.filter(r => { if (!r.lease_expiration) return false; const d = (new Date(r.lease_expiration).getTime() - Date.now()) / 86400000; return d < 365; });
    return { occ: occ.length, vac: vac.length, sf, occSf, mo, yr, in12: in12.length, in12Sf: in12.reduce((s, r) => s + (Number(r.size_sf) || 0), 0) };
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter(r => (showVacant || !isVacant(r)) &&
      (!needle || [r.suite, r.tenant_name, r.email, rowContact(r), r.mailbox_box, r.notes].some(v => String(v ?? '').toLowerCase().includes(needle))));
    if (!sort.key) return out;                      // no sort = the saved suite order
    const k = sort.key;
    return [...out].sort((a, b) => {
      const av = k === 'contact_name' ? rowContact(a) : a[k];
      const bv = k === 'contact_name' ? rowContact(b) : b[k];
      const ba = av === null || av === undefined || av === '';
      const bb = bv === null || bv === undefined || bv === '';
      if (ba && bb) return 0;
      if (ba) return 1;                             // blanks (and no-lease rows) always last
      if (bb) return -1;
      let c: number;
      if (k === 'suite') c = (parseInt(String(av), 10) || 0) - (parseInt(String(bv), 10) || 0) || String(av).localeCompare(String(bv));
      else if (NUMERIC_COLS.has(k)) c = Number(av) - Number(bv);
      else c = String(av).localeCompare(String(bv));
      return c * sort.dir;
    });
  }, [rows, q, showVacant, sort]);

  const exportCsv = () => {
    const cols: (keyof RentRollRow)[] = ['suite', 'building', 'tenant_name', 'size_sf', 'lease_type', 'lease_start', 'lease_expiration', 'monthly_rent', 'annual_rent', 'mailbox_box', 'keys', 'email', 'contact_name', 'renewal_status', 'notes'];
    const head = ['Suite', 'Bldg', 'Tenant', 'Sq Ft', 'Lease Type', 'Lease Start', 'Lease Exp', 'Monthly Rent', 'Annual Rent', 'Mailbox', 'Keys', 'Email', 'Contact', 'Renewal', 'Notes'];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [head.join(','), ...rows.map(r => cols.map(c => esc(c === 'contact_name' ? rowContact(r) : r[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'rent-roll.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const tile = (label: string, value: string, sub?: string) => (
    <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 10, padding: '9px 13px', minWidth: 108 }}>
      <div style={{ fontSize: 10, letterSpacing: .7, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#1a1a1a', marginTop: 2, fontFamily: "'Cormorant Garamond',serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#9ca3af' }}>{sub}</div>}
    </div>
  );

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading rent roll…</div>;

  const vendorRows = vendors.filter(v => v.category === 'vendor');
  const infoRows = vendors.filter(v => v.category === 'building_info');

  const body = (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {tile('Occupied', String(stats.occ), `${stats.vac} vacant`)}
        {tile('Leased SF', stats.occSf.toLocaleString(), `${stats.sf.toLocaleString()} total`)}
        {tile('Monthly', money(stats.mo))}
        {tile('Annual', money(stats.yr))}
        {tile('Exp. 12 mo', String(stats.in12), `${stats.in12Sf.toLocaleString()} SF at risk`)}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search suite, tenant, email…"
          style={{ flex: 1, minWidth: 190, padding: '7px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#6b7280', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showVacant} onChange={e => setShowVacant(e.target.checked)} /> Show vacant
        </label>
        {unlinked.length > 0 && contacts.length > 0 && (
          <button onClick={matchContacts} disabled={matching} title="Link suites to CRM contacts by name or email"
            style={{ fontSize: 12.5, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px solid #e6d3a2', borderRadius: 8, padding: '7px 12px', cursor: matching ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            {matching ? 'Linking…' : `🔗 Link contacts (${unlinked.length})`}
          </button>
        )}
        <button onClick={exportCsv} style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>⤓ CSV</button>
        <button onClick={() => setExpanded(v => !v)} title={expanded ? 'Back to the property card' : 'Open the full sheet — every column, full width'}
          style={{ fontSize: 12.5, fontWeight: 700, color: expanded ? '#6b7280' : '#a06a12', background: expanded ? '#fff' : '#fffdf6', border: `1px solid ${expanded ? '#e5e7eb' : '#e6d3a2'}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{expanded ? '✕ Close' : '⛶ Full screen'}</button>
        <button onClick={addSuite} style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: GOLD, border: 'none', borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>＋ Suite</button>
      </div>

      {/* Grid */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'auto', maxHeight: expanded ? 'calc(100vh - 330px)' : 560, background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1180 }}>
          <thead>
            <tr>
              {HEAD.map((h, i) => (
                <th key={i} onClick={h.k ? () => toggleSort(h.k as SortKey) : undefined}
                  title={h.k ? `Sort by ${h.label}` : undefined}
                  style={{ ...TH, minWidth: h.w, textAlign: h.right ? 'right' : 'left',
                    cursor: h.k ? 'pointer' : 'default', userSelect: 'none',
                    color: sort.key && sort.key === h.k ? '#a06a12' : TH.color }}>
                  {h.label}{sort.key && sort.key === h.k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th style={{ ...TH, width: 34 }} />
            </tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const st = leaseStatus(r.lease_expiration);
              const vac = isVacant(r);
              return (
                <tr key={r.id} style={{ background: vac ? '#fbfbfc' : '#fff' }}>
                  <td style={TD}><Cell value={r.suite} bold onSave={v => saveCell(r.id, 'suite', v)} /></td>
                  <td style={TD}><Cell value={r.building} onSave={v => saveCell(r.id, 'building', v)} /></td>
                  <td style={TD}><Cell value={r.tenant_name} bold={!vac} placeholder="Vacant" onSave={v => saveCell(r.id, 'tenant_name', v)} /></td>
                  <td style={TD}><Cell value={r.size_sf} align="right" type="number" onSave={v => saveCell(r.id, 'size_sf', v)} /></td>
                  <td style={TD}><Cell value={r.lease_expiration} type="date" onSave={v => saveCell(r.id, 'lease_expiration', v)} /></td>
                  <td style={{ ...TD, padding: '0 8px' }}>
                    {st && !vac ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                      : <span style={{ fontSize: 11, color: '#c0c4cc' }}>{vac ? 'Vacant' : '—'}</span>}
                  </td>
                  <td style={TD}><Cell value={r.monthly_rent} align="right" money onSave={v => saveCell(r.id, 'monthly_rent', v)} /></td>
                  <td style={TD}><Cell value={r.annual_rent} align="right" money onSave={v => saveCell(r.id, 'annual_rent', v)} /></td>
                  <td style={TD}><Cell value={r.lease_type} onSave={v => saveCell(r.id, 'lease_type', v)} /></td>
                  <td style={TD}><Cell value={r.mailbox_box} onSave={v => saveCell(r.id, 'mailbox_box', v)} /></td>
                  <td style={TD}><Cell value={r.keys} align="right" type="number" onSave={v => saveCell(r.id, 'keys', v)} /></td>
                  <td style={TD}><Cell value={r.email} onSave={v => saveCell(r.id, 'email', v)} /></td>
                  <td style={TD}><ContactCell row={r} contacts={localContacts.length ? [...localContacts, ...contacts] : contacts} onLink={c => linkContact(r, c)} onText={v => setContactText(r, v)} onCreate={n => createContact(n, r)} /></td>
                  <td style={TD}><Cell value={r.notes} onSave={v => saveCell(r.id, 'notes', v)} /></td>
                  <td style={{ ...TD, textAlign: 'center' }}>
                    {isAdmin && <button onClick={() => removeSuite(r)} title="Remove suite" style={{ background: 'none', border: 'none', color: '#e5b4b4', fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>✕</button>}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={15} style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No suites match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 7 }}>
        Click any cell to edit — changes save automatically. Tenant, size and lease expiration also update the Floor Plan for that suite.
      </div>

      {/* Vendors */}
      <div style={{ marginTop: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 9 }}>
          <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: GOLD, fontWeight: 700 }}>Vendors</div>
          <span style={{ flex: 1 }} />
          <button onClick={() => addVendor('vendor')} style={{ fontSize: 12, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px dashed #e6d3a2', borderRadius: 8, padding: '5px 11px', cursor: 'pointer' }}>＋ Vendor</button>
        </div>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'auto', background: '#fff' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
            <thead><tr>
              <th style={{ ...TH, minWidth: 168 }}>Service</th><th style={{ ...TH, minWidth: 160 }}>Vendor</th>
              <th style={{ ...TH, minWidth: 120 }}>Contact</th><th style={{ ...TH, minWidth: 124 }}>Phone</th>
              <th style={{ ...TH, minWidth: 180 }}>Notes</th><th style={{ ...TH, width: 34 }} />
            </tr></thead>
            <tbody>
              {vendorRows.map(v => (
                <tr key={v.id}>
                  <td style={TD}><Cell value={v.label} bold onSave={x => saveVendor(v.id, 'label', x)} /></td>
                  <td style={TD}><Cell value={v.vendor} onSave={x => saveVendor(v.id, 'vendor', x)} /></td>
                  <td style={TD}><Cell value={v.contact} onSave={x => saveVendor(v.id, 'contact', x)} /></td>
                  <td style={TD}><Cell value={v.phone} onSave={x => saveVendor(v.id, 'phone', x)} /></td>
                  <td style={TD}><Cell value={v.notes} onSave={x => saveVendor(v.id, 'notes', x)} /></td>
                  <td style={{ ...TD, textAlign: 'center' }}>{isAdmin && <button onClick={() => removeVendor(v.id, v.label || v.vendor || undefined)} style={{ background: 'none', border: 'none', color: '#e5b4b4', fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>✕</button>}</td>
                </tr>
              ))}
              {vendorRows.length === 0 && <tr><td colSpan={6} style={{ padding: 18, textAlign: 'center', color: '#9ca3af', fontSize: 12.5 }}>No vendors yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Building info */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 9 }}>
          <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: GOLD, fontWeight: 700 }}>Building Information</div>
          <span style={{ flex: 1 }} />
          <button onClick={() => addVendor('building_info')} style={{ fontSize: 12, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px dashed #e6d3a2', borderRadius: 8, padding: '5px 11px', cursor: 'pointer' }}>＋ Item</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {infoRows.map(v => (
            <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fff', border: '1px solid #eef0f2', borderRadius: 8, padding: '2px 4px 2px 0' }}>
              <div style={{ flex: '0 0 210px' }}><Cell value={v.label} bold onSave={x => saveVendor(v.id, 'label', x)} /></div>
              <div style={{ flex: 1 }}><Cell value={v.notes} onSave={x => saveVendor(v.id, 'notes', x)} /></div>
              {isAdmin && <button onClick={() => removeVendor(v.id, v.label || v.vendor || undefined)} style={{ background: 'none', border: 'none', color: '#e5b4b4', fontSize: 13, cursor: 'pointer', padding: '8px 6px' }}>✕</button>}
            </div>
          ))}
          {infoRows.length === 0 && <div style={{ fontSize: 12.5, color: '#9ca3af', padding: '6px 2px' }}>No building notes yet.</div>}
        </div>
      </div>
    </div>
  );

  if (!expanded) return body;
  return (
    <div onClick={e => { if (e.target === e.currentTarget) setExpanded(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,24,39,.55)', padding: 16, display: 'flex' }}>
      <div style={{ background: '#fff', borderRadius: 14, flex: 1, minHeight: 0, overflow: 'auto', padding: 20, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>
        {body}
      </div>
    </div>
  );
}
