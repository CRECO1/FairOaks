'use client';
// Reusable invite notes for the e-sign message box: pick one to fill it in, or save what's
// typed under a name. Kept per agent, in this browser (localStorage) — no migration, and a
// note never leaves the machine until it's actually sent.
import React, { useEffect, useState } from 'react';
import { friendlyTitle } from '@/lib/esign-title';

type Saved = { name: string; text: string };

// Ready-made notes in the firm's voice: short, courteous, and specific about what the signer
// is being asked to do. Filled with the document's name and the sender's name when picked.
const TEMPLATES: Array<{ name: string; build: (doc: string, who: string) => string }> = [
  { name: 'Standard request', build: (d, w) => `Please review and electronically sign ${d} at your convenience. It takes only a few minutes and can be completed from any device.\n\nIf you have any questions, call or reply to this email and I will be glad to walk through it.\n\nThank you,\n${w}` },
  { name: 'Lease for signature', build: (d, w) => `Attached for your signature is ${d}. Please review each page and sign where indicated. Once every party has signed, you will automatically receive a fully executed copy for your records.\n\nIf anything needs to change before you sign, let me know and we will revise it first.\n\nThank you,\n${w}` },
  { name: 'Purchase / LOI', build: (d, w) => `Please find ${d} for your review and signature. We appreciate the opportunity to work with you on this transaction.\n\nWhen all parties have signed, a fully executed copy will be sent to everyone. Please reach out with any questions before signing.\n\nBest regards,\n${w}` },
  { name: 'Amendment / addendum', build: (d, w) => `Attached is ${d}, which updates the agreement we discussed. Please review the changes and sign where indicated; the amended terms take effect once all parties have signed.\n\nIf you would like to talk through any of it first, I am happy to.\n\nThank you,\n${w}` },
  { name: 'Follow-up', build: (d, w) => `I am following up on ${d}, which is still awaiting your signature. It only takes a few minutes, and the link in this email will take you straight to it.\n\nIf something is holding it up or you would like to change anything, just reply and I will help.\n\nThank you,\n${w}` },
];

const read = (key: string): Saved[] => {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string' && typeof x.text === 'string') : []; } catch { return []; }
};
const write = (key: string, v: Saved[]) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } };

export default function EsignSavedMessages({ message, onPick, ownerKey, docTitle, agentName }: { message: string; onPick: (text: string) => void; ownerKey: string; docTitle?: string | null; agentName?: string | null }) {
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
      <select value={sel} aria-label="Message templates and saved messages"
        onChange={e => {
          const v = e.target.value; setSel(v.startsWith('tpl:') ? '' : v);
          if (v.startsWith('tpl:')) {
            const t = TEMPLATES.find(x => x.name === v.slice(4));
            if (t) onPick(t.build(docTitle ? friendlyTitle(docTitle) : 'the attached document', (agentName || '').trim() || 'CRECO'));
          } else { const i = items.find(x => x.name === v); if (i) onPick(i.text); }
        }}
        style={{ ...small, fontWeight: 600, maxWidth: 220 }}>
        <option value="">Templates &amp; saved…</option>
        <optgroup label="Templates">
          {TEMPLATES.map(t => <option key={t.name} value={`tpl:${t.name}`}>{t.name}</option>)}
        </optgroup>
        {items.length > 0 && (
          <optgroup label="My saved messages">
            {items.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
          </optgroup>
        )}
      </select>
      <button type="button" onClick={save} disabled={!message.trim()} style={{ ...small, opacity: message.trim() ? 1 : 0.5 }}>Save this message</button>
      {sel && <button type="button" onClick={remove} style={{ ...small, color: '#b91c1c', borderColor: '#fecaca' }}>Delete “{sel}”</button>}
    </div>
  );
}
