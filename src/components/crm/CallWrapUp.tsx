'use client';
// The 10-second call wrap-up: what the call was, a note, and which contact it
// belongs to (link an existing card or save the caller as a new one). Used inline
// under a row in the Calling Log.
import React, { useEffect, useState } from 'react';

export const OUTCOMES = [
  { key: 'new_lead', label: 'New lead', bg: '#dcfce7', fg: '#166534' },
  { key: 'client', label: 'Client', bg: '#dbeafe', fg: '#1e40af' },
  { key: 'tenant', label: 'Tenant', bg: '#e0e7ff', fg: '#3730a3' },
  { key: 'vendor', label: 'Vendor', bg: '#f3e8ff', fg: '#6b21a8' },
  { key: 'spam', label: 'Spam', bg: '#fee2e2', fg: '#991b1b' },
  { key: 'personal', label: 'Personal', bg: '#f3f4f6', fg: '#4b5563' },
  { key: 'other', label: 'Other', bg: '#f3f4f6', fg: '#4b5563' },
] as const;
export const outcomeMeta = (k: string | null | undefined) => OUTCOMES.find(o => o.key === k) ?? null;

const TYPES = ['Tenant', 'Buyer', 'Seller', 'Landlord/Investor', 'Broker', 'Agent', 'Other'];
const TYPE_FOR: Record<string, string> = { tenant: 'Tenant', client: 'Buyer', vendor: 'Other', new_lead: 'Tenant', other: 'Other' };

export interface WrapCall {
  id: string; direction: string; from_number: string | null; to_number: string | null; callback_number: string | null;
  caller_name: string | null; notes: string | null; outcome?: string | null; summary: string | null;
  contact?: { id: string; name: string; business_name?: string | null; type?: string | null } | null;
}
interface Found { id: string; first_name: string | null; last_name: string | null; business_name: string | null; type: string | null; phone: string | null; cell_phone: string | null; email: string | null }

interface Props {
  call: WrapCall; authToken?: string; businessUnit: string;
  showToast?: (m: string) => void;
  onSaved: (patch: Partial<WrapCall> & Record<string, unknown>) => void;
  onClose: () => void;
}

const mini: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '8px 12px', minHeight: 36, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", minHeight: 36 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4, display: 'block' };
const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});

/**
 * Caller-ID names are often a city ("SAN ANTONIO TX") or a company ("HPI INC").
 * Only a person's name pre-fills the name boxes; a company goes in Company.
 */
function guessName(cnam: string | null): { first: string; last: string; company: string } {
  const n = (cnam ?? '').trim();
  if (!n || /^[A-Z .]+ [A-Z]{2}$/.test(n) || /wireless|caller|unknown|private|unavailable/i.test(n)) return { first: '', last: '', company: '' };
  if (/\b(inc|llc|ltd|co|corp|group|company|realty|properties|church|bank|services?)\b\.?$/i.test(n)) return { first: '', last: '', company: n };
  const title = (w: string) => (w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w);
  const parts = n.replace(/,/g, ' ').split(/\s+/).map(title);
  // CNAM is often "LAST FIRST"; a comma form ("Smith, Jo") is unambiguous.
  if (/,/.test(n)) return { first: parts.slice(1).join(' '), last: parts[0], company: '' };
  return { first: parts[0] ?? '', last: parts.slice(1).join(' '), company: '' };
}

export default function CallWrapUp({ call, authToken, businessUnit, showToast, onSaved, onClose }: Props) {
  const [outcome, setOutcome] = useState<string | null>(call.outcome ?? null);
  const [note, setNote] = useState(call.notes ?? '');
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const g = guessName(call.caller_name);
  const theirs = call.callback_number || (call.direction === 'outbound' ? call.to_number : call.from_number) || '';
  const [form, setForm] = useState({ first_name: g.first, last_name: g.last, business_name: g.company, email: '', phone: theirs, type: 'Tenant' });
  const [typeTouched, setTypeTouched] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const noContact = outcome === 'spam' || outcome === 'personal';

  // The outcome suggests the contact type until someone picks one.
  useEffect(() => { if (!typeTouched && outcome && TYPE_FOR[outcome]) setForm(f => ({ ...f, type: TYPE_FOR[outcome] })); }, [outcome, typeTouched]);

  useEffect(() => {
    if (mode !== 'link' || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      try {
        const j = await fetch(`/api/crm/contacts?q=${encodeURIComponent(q.trim())}&limit=8&business_unit=${businessUnit}`, { headers: auth(authToken) }).then(r => r.json());
        setFound(j.contacts ?? []);
      } catch { setFound([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, mode, authToken, businessUnit]);

  const wantsNewContact = !call.contact && !noContact && mode === 'new' && !!(form.first_name.trim() || form.last_name.trim() || form.business_name.trim());

  async function save() {
    if (!outcome) { showToast?.('Pick what the call was first'); return; }
    setBusy(true);
    try {
      let contact = call.contact ?? null;
      if (!contact && !noContact && (picked || wantsNewContact)) {
        const r = await fetch('/api/crm/calls/contact', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) },
          body: JSON.stringify(picked ? { call_id: call.id, contact_id: picked.id } : { call_id: call.id, ...form, outcome }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { showToast?.(j.error || 'Could not save the contact'); return; }
        contact = j.contact;
        if (j.created === false && !picked) showToast?.(`${j.contact.name} was already a contact — linked to that card`);
      }
      const r = await fetch(`/api/crm/calls?id=${call.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) },
        body: JSON.stringify({ outcome, notes: note }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not save the wrap-up'); return; }
      onSaved({ ...j.call, contact, contact_id: contact?.id ?? null });
      showToast?.('Call wrapped up ✓');
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed #e6d3a2', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <span style={label}>What was this call?</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {OUTCOMES.map(o => (
            <button key={o.key} onClick={() => setOutcome(o.key)} style={{ ...mini, minHeight: 34, padding: '6px 12px', background: outcome === o.key ? o.fg : o.bg, color: outcome === o.key ? '#fff' : o.fg, border: 'none' }}>{o.label}</button>
          ))}
        </div>
      </div>
      <div>
        <span style={label}>Note</span>
        <textarea value={note} onChange={e => setNote(e.target.value)} style={{ ...input, minHeight: 56 }} placeholder="What did they want? What happens next?" />
      </div>
      {!noContact && (
        <div>
          <span style={label}>Contact</span>
          {call.contact ? (
            <div style={{ fontSize: 13, color: '#374151' }}>👤 {call.contact.name}{call.contact.type ? ` · ${call.contact.type}` : ''} <span style={{ color: '#9ca3af' }}>— the note goes on their timeline</span></div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {([['new', '＋ New contact'], ['link', '🔍 Existing contact']] as const).map(([k, t]) => (
                  <button key={k} onClick={() => { setMode(k); setPicked(null); }} style={{ ...mini, minHeight: 32, padding: '5px 11px', background: mode === k ? '#111' : '#fff', color: mode === k ? '#fff' : '#374151', borderColor: mode === k ? '#111' : '#e5e7eb' }}>{t}</button>
                ))}
              </div>
              {mode === 'new' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                  <input style={input} value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" />
                  <input style={input} value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Last name" />
                  <input style={input} value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} placeholder="Company" />
                  <input style={input} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email (optional)" type="email" />
                  <input style={input} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
                  <select style={input} value={form.type} onChange={e => { setTypeTouched(true); setForm(f => ({ ...f, type: e.target.value })); }}>
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: '#9ca3af' }}>Leave the names blank to skip. A number or email that&apos;s already in the CRM links to that card instead of making a duplicate.</div>
                </div>
              ) : (
                <div>
                  <input style={input} value={q} onChange={e => { setQ(e.target.value); setPicked(null); }} placeholder="Search by name, company, email or phone…" />
                  {picked ? (
                    <div style={{ fontSize: 13, marginTop: 6, color: '#166534' }}>✓ {[picked.first_name, picked.last_name].filter(Boolean).join(' ') || picked.business_name} <button onClick={() => setPicked(null)} style={{ ...mini, minHeight: 26, padding: '2px 8px', marginLeft: 6 }}>change</button></div>
                  ) : found.length > 0 && (
                    <div style={{ border: '1px solid #eef0f2', borderRadius: 8, marginTop: 6, overflow: 'hidden' }}>
                      {found.map(c => (
                        <button key={c.id} onClick={() => setPicked(c)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', minHeight: 40, background: '#fff', border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                          <strong>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.business_name}</strong>
                          <span style={{ color: '#9ca3af' }}>{c.business_name && (c.first_name || c.last_name) ? ` · ${c.business_name}` : ''}{c.type ? ` · ${c.type}` : ''}{c.phone || c.cell_phone ? ` · ${c.phone || c.cell_phone}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button onClick={onClose} style={mini}>Cancel</button>
        <button onClick={save} disabled={busy || !outcome} style={{ ...mini, background: outcome ? '#c9922c' : '#e5e7eb', color: '#fff', border: 'none', cursor: busy || !outcome ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Saving…' : picked || wantsNewContact ? 'Save wrap-up + contact' : 'Save wrap-up'}
        </button>
      </div>
    </div>
  );
}
