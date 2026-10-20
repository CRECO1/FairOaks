'use client';
// Reusable invite notes for the e-sign message box: pick one to fill it in, or save what's
// typed under a name. Kept per agent, in this browser (localStorage) — no migration, and a
// note never leaves the machine until it's actually sent.
import React, { useEffect, useState } from 'react';

type Saved = { name: string; text: string };

const read = (key: string): Saved[] => {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string' && typeof x.text === 'string') : []; } catch { return []; }
};
const write = (key: string, v: Saved[]) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } };

export default function EsignSavedMessages({ message, onPick, ownerKey }: { message: string; onPick: (text: string) => void; ownerKey: string }) {
  const key = `esign:notes:${ownerKey || 'me'}`;
  const [items, setItems] = useState<Saved[]>([]);
  const [sel, setSel] = useState('');
  useEffect(() => { setItems(read(key)); }, [key]);

  const small: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' };

  function save() {
    const text = message.trim();
    if (!text) return;
    const name = window.prompt('Name this message (e.g. "Lease — standard"):', sel || '')?.trim().slice(0, 40);
    if (!name) return;
    const next = [...items.filter(i => i.name.toLowerCase() !== name.toLowerCase()), { name, text }].sort((a, b) => a.name.localeCompare(b.name));
    setItems(next); write(key, next); setSel(name);
  }
  function remove() {
    if (!sel || !window.confirm(`Delete the saved message “${sel}”?`)) return;
    const next = items.filter(i => i.name !== sel);
    setItems(next); write(key, next); setSel('');
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
      {items.length > 0 && (
        <select value={sel} aria-label="Saved messages"
          onChange={e => { const i = items.find(x => x.name === e.target.value); setSel(e.target.value); if (i) onPick(i.text); }}
          style={{ ...small, fontWeight: 600, maxWidth: 200 }}>
          <option value="">Saved messages…</option>
          {items.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
        </select>
      )}
      <button type="button" onClick={save} disabled={!message.trim()} style={{ ...small, opacity: message.trim() ? 1 : 0.5 }}>Save this message</button>
      {sel && <button type="button" onClick={remove} style={{ ...small, color: '#b91c1c', borderColor: '#fecaca' }}>Delete “{sel}”</button>}
    </div>
  );
}
