'use client';

import { useEffect, useState } from 'react';

/**
 * "Who engaged" — the call list for a campaign (or every campaign in the last
 * 90 days). Data: /api/campaigns/engagement (see lib/campaign-engagement.ts for
 * what counts and why opens and mail-scanner clicks don't).
 */

interface Signal { kind: 'click' | 'report' | 'bov' | 'call' | 'reply'; at: string; label: string }
interface Person {
  client_id: string;
  tier: 'hot' | 'warm';
  signals: Signal[];
  last_signal_at: string;
  contacted_at: string | null;
  contacted_how: string | null;
  open_task: boolean;
  campaigns: { id: string; name: string }[];
  contact: { first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; phone: string | null; cell_phone: string | null; unsubscribed_at: string | null };
}

interface Props {
  campaign: { id: string; name: string } | null;
  authToken?: string;
  isMobile: boolean;
  onClose: () => void;
  onOpenContact: (clientId: string) => void;
  showToast: (msg: string) => void;
  /** Who a call task can be handed to (admins). Omitted = tasks go to the person clicking. */
  agents?: { id: string; name: string }[];
  meId?: string;
  businessUnit?: string;
}

const ICON: Record<Signal['kind'], string> = { click: '🔗', report: '📄', bov: '💰', call: '📞', reply: '✉️' };
const ago = (iso: string) => {
  const d = Math.round((Date.now() - Date.parse(iso)) / 86400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function CampaignEngagedPanel({ campaign, authToken, isMobile, onClose, onOpenContact, showToast, agents, meId, businessUnit }: Props) {
  const [assignTo, setAssignTo] = useState<string>(meId ?? '');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'todo' | 'all'>('todo');
  const [tasked, setTasked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    // The list shows who has been contacted, so it must end up exact (`fresh=1` recomputes).
    // That takes a second or two, so the server's stored copy is asked for at the same time
    // and painted the moment it lands; the exact one then replaces it.
    const base = campaign ? `?campaign_id=${campaign.id}` : '';
    const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    let exact = false;
    let failures = 0;
    const apply = (j: { people?: Person[]; replies_checked?: string[] }, isExact: boolean) => {
      if (!live || (exact && !isExact)) return; // never let the cached copy overwrite the exact one
      if (isExact) exact = true;
      setPeople(j.people ?? []);
      setChecked(j.replies_checked ?? []);
      if (isExact && !(j.people ?? []).some((p: Person) => !p.contacted_at)) setView('all');
    };
    const load = async (url: string, isExact: boolean) => {
      try {
        const r = await fetch(url, { headers });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? 'Could not load engagement');
        apply(j, isExact);
      } catch (e) {
        failures++;
        // Only an error if neither copy arrived.
        if (live && failures >= 2 && !exact) setError((e as Error).message || 'Network error — try again');
      }
    };
    void load(`/api/campaigns/engagement${base}`, false);
    void load(`/api/campaigns/engagement${base ? `${base}&` : '?'}fresh=1`, true);
    return () => { live = false; };
  }, [campaign, authToken]);

  async function addTask(p: Person) {
    const who = [p.contact.first_name, p.contact.last_name].filter(Boolean).join(' ') || p.contact.business_name || 'contact';
    const r = await fetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({
        title: `Call ${who} — engaged with "${p.campaigns[0]?.name ?? 'campaign'}"`,
        description: p.signals.map(s => `${s.label} (${ago(s.at)})`).join('\n'),
        client_id: p.client_id, type: 'call', priority: p.tier === 'hot' ? 'high' : 'normal',
        due_date: new Date().toISOString().slice(0, 10),
        assigned_to: assignTo || undefined,
      }),
    });
    const toName = agents?.find(a => a.id === assignTo)?.name?.split(' ')[0];
    if (r.ok) { setTasked(prev => new Set(prev).add(p.client_id)); showToast(`Call task added for ${assignTo && assignTo !== meId ? (toName ?? 'them') : 'today'} ✓`); }
    else showToast('Could not add the task');
  }

  // Everyone still to call → open call tasks for the chosen agent (skips anyone already in their queue).
  async function assignAll(list: Person[]) {
    if (!list.length) return;
    const to = assignTo || meId || '';
    const items = list.filter(p => !p.open_task && !tasked.has(p.client_id)).map(p => {
      const c = p.contact;
      const who = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.business_name || 'contact';
      return {
        client_id: p.client_id, title: `Call ${who} — engaged with "${p.campaigns[0]?.name ?? 'campaign'}"`,
        description: p.signals.map(s => `${s.label} (${ago(s.at)})`).join('\n'), priority: p.tier === 'hot' ? 'high' : 'normal',
      };
    });
    if (!items.length) { showToast('Everyone here already has a call task'); return; }
    const r = await fetch('/api/crm/tasks/assign-calls', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({ assigned_to: to, due_date: new Date().toLocaleDateString('en-CA'), business_unit: businessUnit, items }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error ?? 'Could not assign the calls'); return; }
    setTasked(prev => { const n = new Set(prev); for (const i of items) n.add(i.client_id); return n; });
    showToast(`Assigned ${j.created} call${j.created === 1 ? '' : 's'} to ${String(j.assignee_name ?? '').split(' ')[0] || 'them'}${j.skipped_existing ? ` (${j.skipped_existing} already in their queue)` : ''} ✓`);
  }

  const todo = (people ?? []).filter(p => !p.contacted_at);
  const shown = view === 'todo' ? todo : (people ?? []);

  return (
    <div className="crm-sheet" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={onClose}>
      <div className="crm-sheet-panel" style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 720, boxShadow: '0 24px 80px rgba(0,0,0,.3)', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>🔥 Who engaged{campaign ? '' : ' — last 90 days'}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, overflowWrap: 'anywhere' }}>{campaign ? campaign.name : 'Every campaign that sent in the last 90 days'}</div>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6, lineHeight: 1.45 }}>
              Real clicks, owner-report views, calls in and replies. Opens and spam-filter link checks are left out.
              {people && (checked.length ? ` Replies checked in ${checked.join(', ')}.` : ' Connect Gmail in Settings to include replies.')}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#9ca3af', lineHeight: 1, padding: '0 4px', minWidth: 32, minHeight: 32 }}>×</button>
        </div>

        {people && people.length > 0 && (
          <div style={{ display: 'flex', gap: 6, padding: '12px 20px 0' }}>
            {([['todo', `To call (${todo.length})`], ['all', `All engaged (${people.length})`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} style={{ padding: isMobile ? '8px 14px' : '4px 14px', minHeight: isMobile ? 38 : undefined, borderRadius: 20, fontSize: 13, cursor: 'pointer', border: '1px solid', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, background: view === k ? '#111' : '#fff', color: view === k ? '#fff' : '#6b7280', borderColor: view === k ? '#111' : '#e5e7eb', whiteSpace: 'nowrap' }}>{label}</button>
            ))}
          </div>
        )}

        {people && todo.length > 0 && agents && agents.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 20px 0' }}>
            <span style={{ fontSize: 12.5, color: '#6b7280', fontWeight: 600 }}>Call tasks go to</span>
            <select value={assignTo || meId || ''} onChange={e => setAssignTo(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, fontWeight: 600, background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
              {agents.map(a => <option key={a.id} value={a.id}>{a.id === meId ? 'Me' : a.name}</option>)}
            </select>
            <button onClick={() => assignAll(todo)} className="crm-btn crm-btn-sm" style={{ background: '#c9922c', color: '#111', border: 'none', fontWeight: 800 }}>
              Assign all {todo.length} to {(agents.find(a => a.id === (assignTo || meId))?.name ?? 'me').split(' ')[0] === 'Me' ? 'me' : (agents.find(a => a.id === (assignTo || meId))?.name ?? 'me').split(' ')[0]}
            </button>
          </div>
        )}

        <div style={{ padding: '12px 20px 20px', maxHeight: isMobile ? undefined : '70vh', overflowY: isMobile ? undefined : 'auto' }}>
          {error ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#b91c1c', fontSize: 14 }}>{error}</div>
          ) : !people ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Checking clicks, calls and replies…</div>
          ) : !people.length ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>
              Nobody has engaged yet.<br /><span style={{ fontSize: 12.5, color: '#9ca3af' }}>When someone clicks through, views their report, calls or replies, they show up here.</span>
            </div>
          ) : !shown.length ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#16a34a', fontSize: 14 }}>✓ Everyone who engaged has been contacted.</div>
          ) : shown.map(p => {
            const c = p.contact;
            const who = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
            const phone = c.cell_phone || c.phone;
            const hasTask = p.open_task || tasked.has(p.client_id);
            return (
              <div key={p.client_id} style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: '12px 14px', marginBottom: 10, background: p.contacted_at ? '#fafafa' : '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => onOpenContact(p.client_id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14, fontWeight: 700, color: '#111', textAlign: 'left', fontFamily: 'inherit', overflowWrap: 'anywhere' }}>
                    {who || c.business_name || c.email}
                  </button>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: .5, padding: '2px 7px', borderRadius: 10, textTransform: 'uppercase', background: p.tier === 'hot' ? '#fee2e2' : '#fef3c7', color: p.tier === 'hot' ? '#991b1b' : '#92400e' }}>{p.tier}</span>
                  {c.unsubscribed_at && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#f3f4f6', color: '#6b7280', textTransform: 'uppercase' }}>Unsubscribed</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: p.contacted_at ? '#16a34a' : '#b45309', fontWeight: 600 }}>
                    {p.contacted_at ? `✓ Contacted ${ago(p.contacted_at)}${p.contacted_how ? ` · ${p.contacted_how}` : ''}` : hasTask ? 'Call task open' : 'Not contacted yet'}
                  </span>
                </div>
                {who && c.business_name && <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 1 }}>{c.business_name}</div>}
                {!campaign && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{p.campaigns.map(x => x.name).join(' · ')}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
                  {p.signals.slice(0, 4).map((s, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#374151', display: 'flex', gap: 6 }}>
                      <span aria-hidden="true">{ICON[s.kind]}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
                      <span style={{ color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>{ago(s.at)}</span>
                    </div>
                  ))}
                  {p.signals.length > 4 && <div style={{ fontSize: 12, color: '#9ca3af' }}>+{p.signals.length - 4} more</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} data-contact-id={p.client_id} data-name={who || c.business_name || ''} className="crm-btn crm-btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', ...(isMobile ? { flex: '1 1 calc(50% - 4px)', minHeight: 44, whiteSpace: 'nowrap', justifyContent: 'center' } : {}) }}>📞 {isMobile ? 'Call' : phone}</a>}
                  {c.email && <a href={`mailto:${c.email}`} className="crm-btn crm-btn-ghost crm-btn-sm" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', ...(isMobile ? { flex: '1 1 calc(50% - 4px)', minHeight: 44, whiteSpace: 'nowrap', justifyContent: 'center' } : {}) }}>✉ Email</a>}
                  {!p.contacted_at && !hasTask && <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => addTask(p)} style={isMobile ? { flex: '1 1 calc(50% - 4px)', minHeight: 44, whiteSpace: 'nowrap' } : undefined}>＋ Call task</button>}
                  <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => onOpenContact(p.client_id)} style={isMobile ? { flex: '1 1 calc(50% - 4px)', minHeight: 44, whiteSpace: 'nowrap' } : undefined}>Open contact</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
