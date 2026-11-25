'use client';

import React from 'react';
import type { ThreadSummary } from '@/lib/gmail-live';
import type { SentGroup, SentPerson } from '@/lib/sent-groups';
import { when, whenShort, whenLong, initials, colorFor } from './mail-format';

// CRM open tracking for emails sent from the CRM, per Gmail thread.
export type Track = { tracked: boolean; opens: number; opened: boolean; first: string | null; last: string | null };

type Tracking = Map<string, Track>;
type G = SentGroup<ThreadSummary>;
type Person = SentPerson<ThreadSummary>;

const FONT = "'DM Sans',sans-serif";
const firstName = (p: { name: string; email: string }) => (p.name || p.email).split(/[\s@]/)[0];

/** One person's result across every copy they were sent: did they reply, did they open it, how often. */
export function personStatus(person: Person, tracking: Tracking) {
  let opens = 0, opened = false, first: string | null = null, last: string | null = null, repliedAt: number | null = null;
  for (const t of person.threads) {
    if (!t.lastMine) repliedAt = Math.max(repliedAt ?? 0, t.date);
    const tr = tracking.get(t.id);
    if (!tr) continue;
    opens += tr.opens; opened = opened || tr.opened;
    if (tr.first && (!first || tr.first < first)) first = tr.first;
    if (tr.last && (!last || tr.last > last)) last = tr.last;
  }
  return { opens, opened: opened || repliedAt !== null, firstOpen: first, lastOpen: last, repliedAt, replied: repliedAt !== null };
}

export function groupSummary(g: G, tracking: Tracking) {
  const st = g.people.map(p => personStatus(p, tracking));
  return { total: g.people.length, opened: st.filter(s => s.opened).length, replied: st.filter(s => s.replied).length, status: st };
}

const pill = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 600, padding: '1px 9px', borderRadius: 10, background: bg, color: fg, whiteSpace: 'nowrap' });
const sendLabel = (k: 'sent' | 'again' | 'followup') => (k === 'sent' ? 'sent' : k === 'again' ? 'sent again' : 'follow-up');

/**
 * One email chain sent to several people, as one plain row like Gmail's: who it went to, how many emails are in the chain,
 * the subject and a preview. The only extra is a small open count; the rest lives inside the conversation.
 */
export function SentGroupCard(p: {
  g: G; tracking: Tracking; isMobile: boolean; first: boolean; selected: boolean; checked: boolean; canTick: boolean; preview: string;
  onOpen: () => void; onTick: () => void;
}) {
  const { g } = p;
  const sum = groupSummary(g, p.tracking);
  const names = g.people.map(firstName).join(', ');
  const n = g.count;
  const lead = g.people[0];
  const chain = [...g.sends].reverse().map(s => `${whenShort(s.at)} ${sendLabel(s.kind)}`).join(' · ');
  const outer: React.CSSProperties = p.isMobile
    ? { position: 'relative', overflow: 'hidden', marginBottom: 10, borderRadius: 18, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 8px 18px rgba(0,0,0,.05)' }
    : { position: 'relative' };
  return (
    <div style={outer}>
      <div role="button" tabIndex={0} className="gm-row" onClick={p.onOpen} onKeyDown={e => { if (e.key === 'Enter') p.onOpen(); }}
        style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: p.isMobile ? '14px' : '10px 14px', borderTop: !p.isMobile && !p.first ? '1px solid var(--k-f0f0f0)' : 'none', cursor: 'pointer', borderLeft: `3px solid ${p.selected ? '#c9922c' : 'transparent'}`, background: p.checked ? 'var(--k-fdf6e8)' : p.selected ? 'var(--k-fef9f0)' : 'var(--k-fff)' }}>
        <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
          <div className="gm-av" aria-hidden><span style={{ width: 36, height: 36, borderRadius: '50%', background: colorFor(lead.email || lead.name), color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(lead.name || lead.email)}</span></div>
          {p.canTick && !p.isMobile && (
            <div className="gm-chk" onClick={e => { e.stopPropagation(); p.onTick(); }} title="Select every email in this chain">
              <input type="checkbox" aria-label={`Select the emails to ${names}`} checked={p.checked} onChange={() => {}} style={{ width: 18, height: 18, accentColor: '#c9922c', cursor: 'pointer' }} />
            </div>
          )}
          {p.isMobile && p.checked && <div aria-label="Selected" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✓</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}>To: </span>{names}
              {n > 1 && <span title={chain} style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> {n}</span>}
            </span>
            <span title={`${sum.opened} of ${sum.total} people have opened it${sum.replied ? `, ${sum.replied} replied` : ''}`}
              style={{ fontSize: 11.5, fontWeight: 600, flexShrink: 0, color: sum.opened ? 'var(--k-065f46)' : 'var(--k-9ca3af)' }}>👁 {sum.opened}/{sum.total}{sum.replied > 0 && <span style={{ color: 'var(--k-1e40af)' }}> ↩{'\uFE0E'} {sum.replied}</span>}</span>
            <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(g.sends[0].at)}>{when(g.sends[0].at)}</span>
          </div>
          <div style={{ fontSize: 13.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--k-4b5563)' }}>
            <span style={{ fontWeight: 600, color: 'var(--k-374151)' }}>{g.subject}</span>
            {p.preview && <span style={{ color: 'var(--k-9ca3af)' }}> — {p.preview}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export type OverviewItem = { key: string; who: string; subject: string; at: number; days?: number; lastOpen?: number | null; open: () => void; follow?: () => void; following?: boolean };

const ago = (ms: number) => {
  const m = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** What the empty reading pane shows on Sent: the numbers, who still owes you a reply, and what was just opened. */
export function SentOverview(p: { sentToday: number; tracked: number; opened: number; waiting: OverviewItem[]; recent: OverviewItem[] }) {
  const tile = (label: string, big: React.ReactNode, sub: string, warm = false): React.ReactNode => (
    <div style={{ flex: '1 1 0', minWidth: 120, background: warm ? 'var(--k-fffbeb)' : 'var(--k-f9fafb)', border: `1px solid ${warm ? 'var(--k-fde68a)' : 'var(--k-eef0f2)'}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: warm ? 'var(--k-92400e)' : 'var(--k-9ca3af)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: warm ? 'var(--k-92400e)' : 'var(--k-111)', lineHeight: 1.2, fontFamily: "'Cormorant Garamond',serif" }}>{big}</div>
      <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>{sub}</div>
    </div>
  );
  const row = (it: OverviewItem, right: React.ReactNode) => (
    <div key={it.key} role="button" tabIndex={0} onClick={it.open} onKeyDown={e => { if (e.key === 'Enter') it.open(); }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--k-f3f4f6)', cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.who}</div>
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.subject}</div>
      </div>
      {right}
    </div>
  );
  const box = (title: string, sub: string, items: React.ReactNode[], empty: string) => (
    <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{sub}</div>
      </div>
      {items.length ? items : <div style={{ padding: '14px', borderTop: '1px solid var(--k-f3f4f6)', fontSize: 13, color: 'var(--k-9ca3af)' }}>{empty}</div>}
    </div>
  );
  const pct = p.tracked ? Math.round((p.opened / p.tracked) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tile('Opened', p.tracked ? `${pct}%` : '–', p.tracked ? `${p.opened} of ${p.tracked} tracked emails` : 'no tracked emails yet')}
        {tile('Waiting', p.waiting.length, 'no reply in 3+ days', p.waiting.length > 0)}
        {tile('Sent today', p.sentToday, p.sentToday === 1 ? 'email' : 'emails')}
      </div>
      {box('Waiting on a reply', 'Sent 3+ days ago and nobody has answered', p.waiting.slice(0, 6).map(it => row(it,
        <>
          <span style={{ ...pill('var(--k-fdf6e8)', 'var(--k-92400e)'), flexShrink: 0 }}>{it.days}d</span>
          {it.follow && <button type="button" disabled={it.following} onClick={e => { e.stopPropagation(); it.follow!(); }} style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid var(--k-d1d5db)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>{it.following ? 'Opening…' : 'Follow up'}</button>}
        </>)), 'Nothing waiting. Everyone you wrote to has answered or it is still fresh.')}
      {box('Recently opened', 'The last emails someone opened', p.recent.slice(0, 5).map(it => row(it,
        <span style={{ ...pill('var(--k-d1fae5)', 'var(--k-065f46)'), flexShrink: 0 }}>👁 {it.lastOpen ? ago(it.lastOpen) : 'opened'}</span>)), 'No opens yet on the emails loaded here.')}
      <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', textAlign: 'center', padding: '4px 0 8px' }}>Pick an email to read it · j / k to move · r reply · a reply all · f forward</div>
    </div>
  );
}
