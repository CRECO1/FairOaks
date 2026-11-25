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

const sendTimes = (g: G) => g.sends.map(s => whenShort(s.at)).reverse(); // oldest first
const pill = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 600, padding: '1px 9px', borderRadius: 10, background: bg, color: fg, whiteSpace: 'nowrap' });

function Stack({ people }: { people: Array<{ name: string; email: string }> }) {
  const shown = people.slice(0, 3);
  return (
    <div aria-hidden style={{ position: 'relative', width: 28 + (shown.length - 1) * 17, height: 28 }}>
      {shown.map((p, i) => (
        <span key={p.email + i} style={{ position: 'absolute', left: i * 17, top: 0, zIndex: shown.length - i, width: 28, height: 28, borderRadius: '50%', background: colorFor(p.email || p.name), color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px var(--k-fff)' }}>{(p.name || p.email).trim()[0]?.toUpperCase() ?? '✉'}</span>
      ))}
    </div>
  );
}

/** The list row for one email sent to several people (and every repeat send of it). */
export function SentGroupCard(p: {
  g: G; tracking: Tracking; isMobile: boolean; first: boolean; selected: boolean; checked: boolean; canTick: boolean; preview: string;
  onOpen: () => void; onTick: () => void;
}) {
  const { g } = p;
  const sum = groupSummary(g, p.tracking);
  const names = g.people.map(firstName).join(', ');
  const repeats = g.sends.length;
  const allOpened = sum.opened === sum.total;
  const sentTimes = sendTimes(g);
  const outer: React.CSSProperties = p.isMobile
    ? { position: 'relative', overflow: 'hidden', marginBottom: 10, borderRadius: 18, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 8px 18px rgba(0,0,0,.05)' }
    : { position: 'relative' };
  return (
    <div style={outer}>
      <div role="button" tabIndex={0} className="gm-row" onClick={p.onOpen} onKeyDown={e => { if (e.key === 'Enter') p.onOpen(); }}
        style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: p.isMobile ? '14px' : '10px 14px', borderTop: !p.isMobile && !p.first ? '1px solid var(--k-f0f0f0)' : 'none', cursor: 'pointer', borderLeft: `3px solid ${p.selected ? '#c9922c' : 'transparent'}`, background: p.checked ? 'var(--k-fdf6e8)' : p.selected ? 'var(--k-fef9f0)' : 'var(--k-fff)' }}>
        <div style={{ position: 'relative', width: 62, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <div className="gm-av"><Stack people={g.people} /></div>
          {p.canTick && !p.isMobile && (
            <div className="gm-chk" onClick={e => { e.stopPropagation(); p.onTick(); }} title="Select all copies" style={{ justifyContent: 'flex-start', paddingLeft: 8 }}>
              <input type="checkbox" aria-label={`Select the email to ${names}`} checked={p.checked} onChange={() => {}} style={{ width: 18, height: 18, accentColor: '#c9922c', cursor: 'pointer' }} />
            </div>
          )}
          {p.isMobile && p.checked && <div aria-label="Selected" style={{ position: 'absolute', inset: 0, borderRadius: 18, background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✓</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}>To: </span>{names}
            </span>
            <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(g.sends[0].at)}>{when(g.sends[0].at)}</span>
          </div>
          <div style={{ fontSize: 13.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--k-4b5563)' }}>
            <span style={{ fontWeight: 600, color: 'var(--k-374151)' }}>{g.lead.subject}</span>
            {p.preview && <span style={{ color: 'var(--k-9ca3af)' }}> — {p.preview}</span>}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center' }}>
            <span title={`${sum.opened} of ${sum.total} people have opened it`} style={allOpened ? pill('var(--k-d1fae5)', 'var(--k-065f46)') : sum.opened ? pill('var(--k-fdf6e8)', 'var(--k-92400e)') : pill('var(--k-f3f4f6)', 'var(--k-6b7280)')}>
              {sum.opened === 0 ? `Not opened · 0 of ${sum.total}` : `👁 ${sum.opened} of ${sum.total} opened`}
            </span>
            {sum.replied > 0 && <span style={pill('var(--k-dbeafe)', 'var(--k-1e40af)')}>↩ {sum.replied} replied</span>}
            {repeats > 1 && <span title={`You sent this ${repeats} times: ${sentTimes.join(', ')}. Everyone got ${repeats} copies.`} style={pill('var(--k-fdf6e8)', 'var(--k-92400e)')}>Sent {repeats}×</span>}
            <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
              {g.people.slice(0, 4).map((pe, i) => {
                const s = sum.status[i];
                return <span key={pe.email} style={{ color: s.replied ? 'var(--k-1e40af)' : s.opened ? 'var(--k-065f46)' : 'var(--k-9ca3af)', fontWeight: s.opened ? 700 : 500 }}>{s.replied ? '↩' : s.opened ? '👁' : '○'} {firstName(pe)}{s.opens > 1 ? ` ${s.opens}×` : ''}</span>;
              })}
              {g.people.length > 4 && <span>+{g.people.length - 4}</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shown above the email when you open one that went to several people: who got it, and what each of them did. */
export function SentGroupPanel(p: { g: G; currentId: string; tracking: Tracking; isMobile: boolean; onOpen: (t: ThreadSummary) => void }) {
  const { g } = p;
  const sum = groupSummary(g, p.tracking);
  const repeats = g.sends.length;
  const sentTimes = g.sends.map(s => whenShort(s.at)).reverse();
  const rel = (iso: string | null) => (iso ? when(new Date(iso).getTime()) : '');
  return (
    <div style={{ margin: '0 0 14px', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--k-fafafa)', borderBottom: '1px solid var(--k-f0f0f0)' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)' }}>Sent to {sum.total} people</div>
          <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>One email, tracked separately for each person.</div>
        </div>
        <span style={sum.opened === sum.total ? pill('var(--k-d1fae5)', 'var(--k-065f46)') : sum.opened ? pill('var(--k-fdf6e8)', 'var(--k-92400e)') : pill('var(--k-f3f4f6)', 'var(--k-6b7280)')}>{sum.opened} of {sum.total} opened</span>
      </div>
      {repeats > 1 && (
        <div style={{ padding: '8px 14px', fontSize: 12.5, color: 'var(--k-92400e)', background: 'var(--k-fffbeb)', borderBottom: '1px solid var(--k-fde68a)' }}>
          <b>Sent {repeats} times</b>: {sentTimes.join(' and ')}. Each person got {repeats} copies, and the results below cover all of them.
        </div>
      )}
      {g.people.map((pe, i) => {
        const s = sum.status[i];
        const here = pe.threads.some(t => t.id === p.currentId);
        return (
          <div key={pe.email} style={{ display: 'grid', gridTemplateColumns: p.isMobile ? '32px minmax(0, 1fr) auto' : '32px minmax(140px, 1fr) minmax(200px, 1.4fr) 78px', alignItems: 'center', gap: p.isMobile ? '6px 12px' : 12, padding: p.isMobile ? '10px 12px' : '9px 14px', borderTop: i ? '1px solid var(--k-f3f4f6)' : 'none', background: here ? 'var(--k-fef9f0)' : 'transparent' }}>
            <span aria-hidden style={{ width: 32, height: 32, borderRadius: '50%', background: colorFor(pe.email || pe.name), color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...(p.isMobile ? { gridColumn: 1, gridRow: 1 } : {}) }}>{initials(pe.name || pe.email)}</span>
            <div style={{ minWidth: 0, ...(p.isMobile ? { gridColumn: 2, gridRow: 1 } : {}) }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pe.name || firstName(pe)}</div>
              <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pe.email}</div>
            </div>
            <div style={{ minWidth: 0, fontSize: 12.5, ...(p.isMobile ? { gridColumn: '2 / -1', gridRow: 2 } : {}) }}>
              {s.replied ? <span style={{ color: 'var(--k-1e40af)', fontWeight: 700 }}>↩ Replied · {when(s.repliedAt!)}</span>
                : s.opened ? <span style={{ color: 'var(--k-065f46)', fontWeight: 700 }} title={s.lastOpen ? `Last opened ${whenLong(new Date(s.lastOpen).getTime())}` : undefined}>👁 Opened{s.opens > 1 ? ` ${s.opens}×` : ''}{s.firstOpen ? ` · first ${rel(s.firstOpen)}` : ''}</span>
                : <span style={{ color: 'var(--k-9ca3af)' }}>○ Not opened yet</span>}
              {repeats > 1 && (
                <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--k-9ca3af)' }}>
                  {[...g.sends].reverse().map(sd => {
                    const t = sd.threads.find(x => pe.threads.some(y => y.id === x.id));
                    const tr = t ? p.tracking.get(t.id) : undefined;
                    return `${whenShort(sd.at)}: ${tr?.opened ? `opened${tr.opens > 1 ? ` ${tr.opens}×` : ''}` : 'not opened'}`;
                  }).join(' · ')}
                </div>
              )}
            </div>
            <button type="button" disabled={here} onClick={() => p.onOpen(pe.threads[0])} title={here ? 'This is the conversation you are reading' : `Open ${pe.name || pe.email}'s conversation`}
              style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid var(--k-d1d5db)', background: here ? 'var(--k-f3f4f6)' : 'var(--k-fff)', color: here ? 'var(--k-9ca3af)' : 'var(--k-374151)', fontSize: 12.5, fontWeight: 600, cursor: here ? 'default' : 'pointer', fontFamily: FONT, flexShrink: 0, justifySelf: 'end', ...(p.isMobile ? { gridColumn: 3, gridRow: 1 } : {}) }}>{here ? 'Viewing' : 'Open'}</button>
          </div>
        );
      })}
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
