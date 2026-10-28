'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { loadMailRows, buildThreads, loadDone, setDone, onDoneChanged, isDone, WAITING_AFTER_DAYS, type MailRow, type MailThread } from '@/lib/needs-reply';

// Needs reply (Zack, 2026-10-28): the conversations where the other person had the last word and we haven't
// answered, plus the ones we're waiting on. Inbound mail files itself every 10 minutes (cron/gmail-replies),
// so this stays current without anyone pressing Sync.

const supabase = createClient();
const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const firstAddr = (raw: string | null | undefined) => {
  const first = (raw ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0]?.trim() ?? '';
  const m = first.match(/^"?(.*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: first };
};
const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';
const plain = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li)>/gi, ' ').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const ageLabel = (d: number) => d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;

type Props = {
  isMobile: boolean;
  myAddresses: string[];
  nameFor: (email: string) => string | undefined;
  dealLabel: (id: string) => string | null;
  clientLabel: (id: string) => string | null;
  onOpenDeal: (id: string) => void;
  onOpenContact: (id: string) => void;
};

export default function NeedsReplySection(p: Props) {
  const [rows, setRows] = useState<MailRow[] | null>(null);
  const [tab, setTab] = useState<'needs' | 'waiting'>('needs');
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [showDone, setShowDone] = useState(false);
  const [done, setDoneState] = useState<Record<string, string>>(() => loadDone());
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const addrKey = p.myAddresses.map(a => a.toLowerCase()).filter(Boolean).sort().join(',');

  useEffect(() => {
    let live = true;
    const load = () => loadMailRows().then(r => { if (live) setRows(r); });
    void load();
    const t = setInterval(load, 5 * 60_000);
    const off = onDoneChanged(() => setDoneState(loadDone()));
    return () => { live = false; clearInterval(t); off(); };
  }, []);

  const { needsReply, waiting } = useMemo(() => buildThreads(rows ?? [], addrKey.split(',').filter(Boolean), scope), [rows, addrKey, scope]);
  const list: MailThread[] = tab === 'needs' ? needsReply : waiting;
  const doneCount = needsReply.filter(t => isDone(done, t)).length;
  const shown = useMemo(() => {
    let l = tab === 'needs' ? list.filter(t => showDone || !isDone(done, t)) : list;
    const needle = q.trim().toLowerCase();
    if (needle) {
      l = l.filter(t => {
        const who = tab === 'needs' ? t.latest.from_email : t.latest.to_email;
        return `${who} ${t.latest.subject} ${p.nameFor(firstAddr(who).email) ?? ''}`.toLowerCase().includes(needle);
      });
    }
    return l;
  }, [list, tab, showDone, done, q, p]);

  // Bodies are fetched only for the rows on screen (the list query leaves them out: 2,500 rows of mail is heavy).
  const idsKey = shown.slice(0, 60).map(t => t.latest.id).join(',');
  useEffect(() => {
    const need = idsKey.split(',').filter(id => id && !(id in bodies));
    if (!need.length) return;
    let live = true;
    supabase.from('crm_deal_emails').select('id,body').in('id', need).then(({ data }) => {
      if (!live || !data) return;
      setBodies(b => { const n = { ...b }; for (const r of data as { id: string; body: string | null }[]) n[r.id] = plain(r.body ?? '').slice(0, 140); return n; });
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const chip = (on: boolean): React.CSSProperties => ({
    padding: p.isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });
  const sel: React.CSSProperties = { height: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 8px', flex: p.isMobile ? 1 : undefined };
  const open = (t: MailThread) => {
    const { deal_id, client_id } = t.latest;
    if (deal_id && p.dealLabel(deal_id)) p.onOpenDeal(deal_id); else if (client_id) p.onOpenContact(client_id);
  };
  const empty = (title: string, sub: string) => (
    <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)' }}>{title}</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>{sub}</div>
    </div>
  );
  const openCount = needsReply.filter(t => !isDone(done, t)).length;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: p.isMobile ? '12px 12px 96px' : '20px 24px 48px' }}>
      <div style={{ fontSize: 13, color: 'var(--k-6b7280)', marginBottom: 14 }}>
        Conversations where they had the last word, and the ones waiting on them. New replies file themselves every 10 minutes.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
          <button onClick={() => setTab('needs')} style={chip(tab === 'needs')}>Needs my reply{rows ? ` · ${openCount}` : ''}</button>
          <button onClick={() => setTab('waiting')} style={chip(tab === 'waiting')}>Waiting on them{rows ? ` · ${waiting.length}` : ''}</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: p.isMobile ? 0 : 'auto', flexWrap: 'wrap', width: p.isMobile ? '100%' : undefined }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or subject" aria-label="Search conversations"
            style={{ flex: p.isMobile ? '1 1 100%' : '0 1 220px', minWidth: 0, height: p.isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
          <select value={scope} onChange={e => setScope(e.target.value as typeof scope)} aria-label="Whose email" style={sel}>
            <option value="mine">My email</option>
            <option value="team">Whole team</option>
          </select>
        </div>
      </div>

      {rows === null ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 14, padding: 24 }}>Loading conversations…</div>
      : shown.length === 0 ? (tab === 'needs'
          ? empty(q ? 'Nothing matches' : 'You’re all caught up', q ? 'Try another search.' : 'Every conversation in the last 30 days has your answer, or was marked done.')
          : empty(q ? 'Nothing matches' : 'Nobody is overdue', `Emails you sent that still have no reply after ${WAITING_AFTER_DAYS} days show up here.`))
      : (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {shown.map((t, i) => {
            const r = t.latest;
            const needs = tab === 'needs';
            const a = firstAddr(needs ? r.from_email : r.to_email);
            const name = a.name || p.nameFor(a.email) || a.email;
            const isDone_ = needs && isDone(done, t);
            const ctx = r.deal_id && p.dealLabel(r.deal_id) ? `Deal · ${p.dealLabel(r.deal_id)}` : r.client_id && p.clientLabel(r.client_id) ? `Contact · ${p.clientLabel(r.client_id)}` : null;
            const hot = needs && t.ageDays >= 2;
            return (
              <div key={t.key} onClick={() => open(t)}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', cursor: r.deal_id || r.client_id ? 'pointer' : 'default', opacity: isDone_ ? 0.55 : 1 }}>
                <div aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: needs ? '#c9922c' : '#475569' }}>{initials(name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {name}{t.count > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> · {t.count}</span>}
                    </span>
                    <span style={{ fontSize: 12, flexShrink: 0, fontWeight: hot ? 700 : 400, color: hot ? 'var(--k-b45309)' : 'var(--k-9ca3af)' }}>{ageLabel(t.ageDays)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--k-374151)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b style={{ fontWeight: 600 }}>{r.subject || '(no subject)'}</b>
                    {bodies[r.id] && <span style={{ color: 'var(--k-9ca3af)' }}> — {bodies[r.id]}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    {ctx && <span style={{ fontSize: 12, color: 'var(--k-a06a12)', fontWeight: 600 }}>{ctx} →</span>}
                    {scope === 'team' && <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{needs ? `to ${firstAddr(r.to_email).email}` : `from ${r.from_email}`}</span>}
                    {needs && (
                      <button type="button" onClick={e => { e.stopPropagation(); setDone(t.key, isDone_ ? null : r.id); }}
                        title={isDone_ ? 'Put it back on the list' : 'No reply needed — hide it until they write again'}
                        style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--k-e5e7eb)', borderRadius: 999, padding: p.isMobile ? '6px 12px' : '3px 10px', fontSize: 12, fontWeight: 600, color: 'var(--k-374151)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        {isDone_ ? 'Undo' : '✓ Done'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'needs' && doneCount > 0 && (
        <button onClick={() => setShowDone(v => !v)} style={{ ...chip(false), marginTop: 12, fontWeight: 500 }}>
          {showDone ? 'Hide' : 'Show'} {doneCount} marked done
        </button>
      )}
      <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 10 }}>
        “Done” is remembered on this device. Looks at the last 30 days of mail logged in the CRM.
      </div>
    </div>
  );
}
