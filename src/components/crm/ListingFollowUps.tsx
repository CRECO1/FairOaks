'use client';
import React, { useEffect, useState } from 'react';

type Item = { contact_id: string; name: string; listing_id: string; listing: string; days: number; snippet: string | null };
const DONE_KEY = 'crm:listing-followup-tasked';

/**
 * Dashboard card: people who asked about a property (a #tag) a week or more ago and have had nothing logged since — for the listings you
 * list (admins: all). "Call task" makes a call task for today on that contact; "Open" opens their card. Hidden when there is nothing to do.
 */
export default function ListingFollowUps({ authToken, userId, onOpenContact, onToast }: { authToken?: string; userId?: string; onOpenContact: (id: string) => void; onToast: (m: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [made, setMade] = useState<Set<string>>(() => { try { return new Set(JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '[]')); } catch { return new Set(); } });
  const [busy, setBusy] = useState<string | null>(null);
  const h = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (!authToken) return;
    let alive = true;
    fetch('/api/crm/listing-follow-ups', { headers: h }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive) setItems(j?.items ?? []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [authToken]); // eslint-disable-line

  const k = (i: Item) => `${i.contact_id}:${i.listing_id}`;
  const makeTask = async (i: Item) => {
    setBusy(k(i));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const r = await fetch('/api/crm/tasks', { method: 'POST', headers: h, body: JSON.stringify({ title: `Follow up: ${i.name} asked about ${i.listing}`, description: i.snippet ?? '', client_id: i.contact_id, due_date: today, type: 'follow_up', assigned_to: userId || undefined, priority: 'normal' }) }).catch(() => null);
    setBusy(null);
    if (!r?.ok) { onToast('Could not make that task'); return; }
    const n = new Set(made); n.add(k(i)); setMade(n);
    try { sessionStorage.setItem(DONE_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
    onToast(`Call task made for ${i.name}`);
  };

  if (!items || items.length === 0) return null;
  return (
    <div style={{ background: 'var(--k-fff, #fff)', border: '1px solid var(--k-e5e7eb, #e5e7eb)', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>🏠 Asked about a listing, no follow-up yet <span style={{ fontWeight: 500, color: 'var(--k-9ca3af, #9ca3af)' }}>· {items.length}</span></div>
      <div style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)', marginBottom: 8 }}>They asked a week or more ago and nothing has been logged on them since.</div>
      {items.slice(0, 6).map(i => (
        <div key={k(i)} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 0', borderTop: '1px solid #f1f3f5' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.name} <span style={{ fontWeight: 500, color: 'var(--k-6b7280, #6b7280)' }}>· {i.listing}</span></div>
            <div style={{ fontSize: 11.5, color: '#b45309' }}>asked {i.days} days ago</div>
          </div>
          <button onClick={() => onOpenContact(i.contact_id)} style={{ fontSize: 12.5, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'none', cursor: 'pointer', color: 'var(--k-374151, #374151)' }}>Open</button>
          {made.has(k(i))
            ? <span style={{ fontSize: 12.5, color: 'var(--k-0f766e, #0f766e)', fontWeight: 600 }}>✓ Task made</span>
            : <button disabled={busy === k(i)} onClick={() => makeTask(i)} style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-99f6e4, #99f6e4)', background: 'var(--k-f0fdfa, #f0fdfa)', color: 'var(--k-0f766e, #0f766e)', cursor: 'pointer' }}>{busy === k(i) ? '…' : 'Call task'}</button>}
        </div>
      ))}
      {items.length > 6 && <div style={{ fontSize: 12, color: 'var(--k-9ca3af, #9ca3af)', paddingTop: 6 }}>+ {items.length - 6} more (open each property to see them all)</div>}
    </div>
  );
}
