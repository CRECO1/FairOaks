'use client';
import React, { useEffect, useRef, useState } from 'react';

type Cand = { contact_id: string; name: string; email: string | null; ownerName: string; via: string };
type Gap = { listing_id: string; listing: string; asked: number; targeted: number; deals: number; linkedNoEmail: { client_id: string; name: string }[]; candidates: Cand[] };
type Found = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; type: string | null };
type Done = { text: string; warn: boolean };

const nameOf = (c: Found) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';
const pill = { fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' } as const;
const ghost = { fontSize: 12.5, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'none', cursor: 'pointer', color: 'var(--k-374151, #374151)' } as const;
const input = { fontSize: 14, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'var(--k-fff, #fff)', color: 'inherit', minWidth: 0 } as const;

/**
 * "Who owns each property?": the properties with interest but no landlord / owner email linked (so their weekly owner update goes to the agent to forward).
 * Each shows who probably owns it (county owner matched to your contacts), anyone already linked who lacks an email, and a contact search; one tap links a
 * person as the property's Landlord (the same call the property card uses). Nothing is sent: it only makes next Monday's draft address the right person.
 */
export default function OwnerLinks({ authToken, onClose, onOpenContact, onChanged }: { authToken?: string; onClose: () => void; onOpenContact?: (id: string) => void; onChanged?: () => void }) {
  const [rows, setRows] = useState<Gap[] | null>(null);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState<Record<string, string>>({});
  const [found, setFound] = useState<Record<string, Found[]>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [nn, setNn] = useState({ name: '', email: '' });
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    let alive = true;
    fetch('/api/crm/owner-gaps', { headers: h }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive) setRows(j?.rows ?? []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [authToken]); // eslint-disable-line

  const link = async (listingId: string, clientId: string, name: string, email: string | null) => {
    setBusy(listingId + clientId); setErr('');
    const r = await fetch('/api/crm/listing-contacts', { method: 'POST', headers: h, body: JSON.stringify({ listing_id: listingId, client_id: clientId, role: 'Landlord' }) }).catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(`Could not link ${name}`); return; }
    setDone(d => ({ ...d, [listingId]: email ? { text: `Linked ${name}. Next Monday's owner update will be addressed to ${email}.`, warn: false } : { text: `Linked ${name}, but there is no email on their card yet. Open the contact and add one so the update can go to them.`, warn: true } }));
    onChanged?.();
  };
  const search = (listingId: string, text: string) => {
    setQ(s => ({ ...s, [listingId]: text }));
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) { setFound(f => ({ ...f, [listingId]: [] })); return; }
    timer.current = setTimeout(async () => {
      // The contacts search matches ONE word against each name / email column, so a full name finds nothing: search the longest word, then keep only people who match every word.
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const longest = [...words].sort((a, b) => b.length - a.length)[0] ?? text.trim();
      const r = await fetch(`/api/crm/contacts?q=${encodeURIComponent(longest)}&limit=50`, { headers: h }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      const all: Found[] = j?.contacts ?? [];
      const hit = all.filter(c => { const hay = `${c.first_name ?? ''} ${c.last_name ?? ''} ${c.business_name ?? ''} ${c.email ?? ''}`.toLowerCase(); return words.every(w => hay.includes(w)); });
      setFound(f => ({ ...f, [listingId]: hit.slice(0, 8) }));
    }, 250);
  };
  const createAndLink = async (listingId: string) => {
    const parts = nn.name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !/^\S+@\S+\.\S+$/.test(nn.email.trim())) { setErr('Add a name and a valid email'); return; }
    setBusy('new' + listingId); setErr('');
    const r = await fetch('/api/crm/contacts', { method: 'POST', headers: h, body: JSON.stringify({ first_name: parts[0], last_name: parts.slice(1).join(' ') || null, email: nn.email.trim(), type: 'Landlord/Investor', lead_source: 'Owner link' }) }).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    setBusy(null);
    if (!j?.contact?.id) { setErr('Could not create the contact'); return; }
    setAdding(null); setNn({ name: '', email: '' });
    await link(listingId, j.contact.id as string, nn.name.trim(), nn.email.trim());
  };

  const open = (rows ?? []).filter(r => !done[r.listing_id] || done[r.listing_id].warn);
  return (
    <div role="dialog" aria-label="Who owns each property" onClick={e => { e.stopPropagation(); onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff, #fff)', width: 'min(760px, 100%)', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '18px 16px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>🏢 Who owns each property?</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 12 }}>These properties have interest but no landlord email linked, so the Monday owner update is addressed to you to forward. Link the owner and next Monday&apos;s draft goes to them (still a draft: nothing is sent for you).</div>
        {err && <div style={{ fontSize: 13, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
        {rows === null && <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Checking…</div>}
        {rows !== null && rows.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--k-0f766e, #0f766e)', fontWeight: 600 }}>✓ Every property with interest has an owner email linked.</div>}
        {rows !== null && rows.length > 0 && open.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--k-0f766e, #0f766e)', fontWeight: 600 }}>✓ All linked. Next Monday&apos;s drafts will go to the owners.</div>}
        {(rows ?? []).map(g => {
          const d = done[g.listing_id];
          return (
            <div key={g.listing_id} style={{ border: '1px solid #eef0f2', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{g.listing}</div>
                <div style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)' }}>{g.asked} asked · {g.targeted} reached out{g.deals ? ` · ${g.deals} deal${g.deals === 1 ? '' : 's'}` : ''}</div>
              </div>
              {d && <div style={{ fontSize: 13, margin: '6px 0', color: d.warn ? '#b45309' : 'var(--k-0f766e, #0f766e)', fontWeight: 600 }}>{d.warn ? '⚠ ' : '✓ '}{d.text}</div>}
              {!d && (
                <>
                  {g.linkedNoEmail.map(l => (
                    <div key={l.client_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0' }}>
                      <div style={{ flex: '1 1 200px', fontSize: 13 }}><b>{l.name}</b> is linked as landlord but has no email.</div>
                      {onOpenContact && <button onClick={() => { onOpenContact(l.client_id); onClose(); }} style={ghost}>Open to add one</button>}
                    </div>
                  ))}
                  {g.candidates.map(c => (
                    <div key={c.contact_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #f1f3f5' }}>
                      <div style={{ flex: '1 1 220px', minWidth: 0, fontSize: 13 }}>
                        <div><b>{c.name}</b> <span style={{ color: c.email ? 'var(--k-6b7280, #6b7280)' : '#b45309' }}>· {c.email ?? 'no email on file'}</span></div>
                        <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af, #9ca3af)' }}>County owner: {c.ownerName || 'unknown'} · {c.via}</div>
                      </div>
                      <button disabled={busy !== null} onClick={() => link(g.listing_id, c.contact_id, c.name, c.email)} style={pill}>{busy === g.listing_id + c.contact_id ? '…' : 'Link as Landlord'}</button>
                    </div>
                  ))}
                  <div style={{ paddingTop: 6, borderTop: '1px solid #f1f3f5', marginTop: 4 }}>
                    <input value={q[g.listing_id] ?? ''} onChange={e => search(g.listing_id, e.target.value)} placeholder="🔍 Search your contacts for the owner" style={{ ...input, width: '100%', boxSizing: 'border-box' }} />
                    {(found[g.listing_id] ?? []).map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0' }}>
                        <div style={{ flex: '1 1 200px', fontSize: 13 }}><b>{nameOf(c)}</b> <span style={{ color: c.email ? 'var(--k-6b7280, #6b7280)' : '#b45309' }}>· {c.email ?? 'no email'}</span>{c.type ? <span style={{ color: 'var(--k-9ca3af, #9ca3af)' }}> · {c.type}</span> : null}</div>
                        <button disabled={busy !== null} onClick={() => link(g.listing_id, c.id, nameOf(c), c.email)} style={pill}>{busy === g.listing_id + c.id ? '…' : 'Link as Landlord'}</button>
                      </div>
                    ))}
                    {adding === g.listing_id ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        <input value={nn.name} onChange={e => setNn(s => ({ ...s, name: e.target.value }))} placeholder="Owner name or company" style={{ ...input, flex: '1 1 160px' }} />
                        <input value={nn.email} onChange={e => setNn(s => ({ ...s, email: e.target.value }))} placeholder="Email" inputMode="email" style={{ ...input, flex: '1 1 160px' }} />
                        <button disabled={busy !== null} onClick={() => createAndLink(g.listing_id)} style={pill}>{busy === 'new' + g.listing_id ? '…' : 'Add & link'}</button>
                        <button onClick={() => setAdding(null)} style={ghost}>Cancel</button>
                      </div>
                    ) : <button onClick={() => { setAdding(g.listing_id); setErr(''); }} style={{ ...ghost, marginTop: 6 }}>＋ New owner contact</button>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
