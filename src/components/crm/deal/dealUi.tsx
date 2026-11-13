'use client';
/**
 * Shared building blocks for the deal card + pipeline board: one stage palette, one
 * icon set, one avatar/chip style, the sticky header, the stage stepper and the
 * mobile action bar. Styling follows the CRM's existing look (black + #c9922c gold,
 * Cormorant Garamond headings, DM Sans body).
 */
import React, { useEffect, useRef, useState } from 'react';

export const DEAL_STAGES = ['Prospect', 'Active', 'LOI', 'In Contract', 'Closed', 'Lost'] as const;

/** ONE palette — stepper, chips, header and board tiles all read from here. */
export const STAGE_PALETTE: Record<string, { bg: string; border: string; dot: string; text: string }> = {
  'Prospect':    { bg: 'var(--k-f9fafb,#f9fafb)', border: 'var(--k-d1d5db,#d1d5db)', dot: '#9ca3af', text: '#4b5563' },
  'Active':      { bg: 'var(--k-eff6ff,#eff6ff)', border: 'var(--k-bfdbfe,#bfdbfe)', dot: '#3b82f6', text: '#1d4ed8' },
  'LOI':         { bg: 'var(--k-faf5ff,#faf5ff)', border: 'var(--k-e9d5ff,#e9d5ff)', dot: 'var(--k-a855f7,#a855f7)', text: '#7e22ce' },
  'In Contract': { bg: 'var(--k-fffbeb,#fffbeb)', border: 'var(--k-fde68a,#fde68a)', dot: '#f59e0b', text: '#b45309' },
  'Closed':      { bg: 'var(--k-f0fdf4,#f0fdf4)', border: 'var(--k-bbf7d0,#bbf7d0)', dot: '#22c55e', text: '#15803d' },
  'Lost':        { bg: 'var(--k-fef2f2,#fef2f2)', border: 'var(--k-fecaca,#fecaca)', dot: '#ef4444', text: '#b91c1c' },
};
const FALLBACK = STAGE_PALETTE['Prospect'];

/* ── Icons (one set, 16px stroke) ──────────────────────────────────────────── */
const P: Record<string, string> = {
  phone: 'M5 4h3l1.5 4-2 1.2a11 11 0 0 0 5.3 5.3L14 12.5l4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  note: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  next: 'M5 12h14M13 6l6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
  stage: 'M5 12h14M15 7l5 5-5 5',
  task: 'M9 11l3 3 8-8M4 5v14h14',
  meeting: 'M4 18v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 8a2.5 2.5 0 1 1 0 5M20 18v-1a3 3 0 0 0-2-2.8',
  dollar: 'M12 3v18M16 7.5c-.8-1-2-1.5-4-1.5-2.5 0-4 1-4 2.8s1.5 2.4 4 3.2 4 1.4 4 3.2-1.5 2.8-4 2.8c-2 0-3.3-.6-4.2-1.7',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
};
export function Icon({ name, size = 16, color = 'currentColor' }: { name: keyof typeof P | string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={P[name] ?? P.note} />
    </svg>
  );
}

/* ── Avatar + chips ────────────────────────────────────────────────────────── */
export interface DealPerson { id: string; first_name: string; last_name: string }
export function initials(p?: { first_name?: string; last_name?: string } | null) {
  return ((p?.first_name?.[0] ?? '') + (p?.last_name?.[0] ?? '')).toUpperCase() || '?';
}
export function Avatar({ person, size = 28, owner = false, title }: { person?: DealPerson | null; size?: number; owner?: boolean; title?: string }) {
  return (
    <span title={title ?? (person ? `${person.first_name} ${person.last_name}${owner ? ' (owner)' : ''}` : '')}
      style={{ width: size, height: size, borderRadius: '50%', background: owner ? '#c9922c' : '#111', color: owner ? '#111' : '#c9922c',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 700,
        border: '2px solid #fff', boxShadow: '0 0 0 1px #e5e7eb', flexShrink: 0, letterSpacing: .3 }}>
      {initials(person)}
    </span>
  );
}
export function StageChip({ stage, size = 'md' }: { stage: string; size?: 'sm' | 'md' }) {
  const c = STAGE_PALETTE[stage] ?? FALLBACK;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: 999, padding: size === 'sm' ? '1px 8px' : '3px 11px', fontSize: size === 'sm' ? 11 : 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.dot }} />{stage}
    </span>
  );
}

export function daysAgo(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
export function touchLabel(iso?: string | null) {
  const d = daysAgo(iso);
  return d == null ? 'No touch yet' : d === 0 ? 'Touched today' : d === 1 ? 'Touched yesterday' : `Touched ${d}d ago`;
}

/* ── Global styles for the card (motion respects reduced-motion) ───────────── */
export function DealCardStyles() {
  return (
    <style>{`
      .dc-modal{max-width:880px!important;display:flex;flex-direction:column;max-height:94vh}
      .dc-head{position:sticky;top:0;z-index:5;background:#111;color:#fff;border-radius:12px 12px 0 0;padding:18px 26px 0}
      .dc-qa{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;
        padding:8px 14px;border-radius:9px;font:600 13px 'DM Sans',sans-serif;cursor:pointer;text-decoration:none;transition:background .15s,transform .15s}
      .dc-qa:hover{background:rgba(255,255,255,.14)}
      .dc-qa:active{transform:scale(.97)}
      .dc-qa.gold{background:#c9922c;border-color:#c9922c;color:#111}
      .dc-qa.gold:hover{background:#d9a23c}
      .dc-qa[aria-disabled=true]{opacity:.4;pointer-events:none}
      .dc-menu{position:absolute;right:0;top:calc(100% + 6px);background:var(--c-surface,#fff);color:var(--c-ink,#111);border:1px solid var(--c-line,#e5e7eb);border-radius:10px;
        box-shadow:0 12px 32px rgba(0,0,0,.2);min-width:210px;padding:6px;z-index:70;animation:dc-pop .14s ease-out}
      .dc-menu button{display:flex;width:100%;align-items:center;gap:9px;padding:9px 10px;background:none;border:none;border-radius:7px;
        font:500 13.5px 'DM Sans',sans-serif;color:var(--c-ink,#111);cursor:pointer;text-align:left}
      .dc-menu button:hover{background:var(--c-surface-2,#f6f3ec)}
      .dc-menu button.danger{color:#b91c1c}
      .dc-step{display:flex;gap:0;margin:14px -26px 0;padding:0 26px}
      .dc-step button{flex:1;position:relative;background:none;border:none;padding:10px 4px 12px;cursor:pointer;color:rgba(255,255,255,.45);
        font:600 12px 'DM Sans',sans-serif;display:flex;flex-direction:column;align-items:center;gap:6px;transition:color .15s}
      .dc-step button:hover{color:#fff}
      .dc-step .bar{height:4px;border-radius:2px;width:100%;background:rgba(255,255,255,.15);transition:background .25s}
      .dc-step button.done .bar{background:rgba(201,146,44,.55)}
      .dc-step button.cur{color:#fff}
      .dc-step button.cur .bar{background:var(--dc-cur,#c9922c)}
      .dc-tabs{display:flex;gap:2px;border-bottom:1px solid var(--c-line,#eee7d6);margin-bottom:18px;overflow-x:auto;scrollbar-width:none}
      .dc-tabs::-webkit-scrollbar{display:none}
      .dc-tab{padding:10px 15px;white-space:nowrap;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;
        font:500 14px 'DM Sans',sans-serif;color:var(--c-muted,#6b7280);cursor:pointer;transition:color .15s,border-color .15s;display:inline-flex;align-items:center;gap:7px}
      .dc-tab:hover{color:var(--c-ink,#111)}
      .dc-tab.on{color:var(--c-ink,#111);border-bottom-color:#c9922c;font-weight:700}
      .dc-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
      .dc-stat{background:var(--c-surface,#fff);border:1px solid var(--c-line,#eee7d6);border-radius:12px;padding:12px 14px;animation:dc-rise .25s ease-out both}
      .dc-stat .l{font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;color:var(--c-faint,#9ca3af);font-weight:700}
      .dc-stat .v{font:700 20px 'Cormorant Garamond',serif;color:var(--c-ink,#111);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dc-card{background:var(--c-surface,#fff);border:1px solid var(--c-line,#eee7d6);border-radius:12px;padding:14px 16px}
      .dc-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;border:1px solid var(--c-line,#e5e7eb);background:var(--c-surface,#fff);
        font:600 12.5px 'DM Sans',sans-serif;color:var(--c-ink-2,#4b5563);cursor:pointer;transition:all .15s}
      .dc-chip:hover{border-color:#c9922c}
      .dc-chip.on{background:#111;color:#fff;border-color:var(--c-ink,#111)}
      .dc-tl-item{display:flex;gap:12px;padding:10px 0;animation:dc-rise .22s ease-out both}
      .dc-tl-dot{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid transparent}
      .dc-mbar{display:none}
      @keyframes dc-pop{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
      @keyframes dc-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      @media (max-width:700px){
        .dc-modal{max-height:100dvh!important;height:100dvh;border-radius:0!important}
        .dc-head{padding:14px 16px 0;border-radius:0}
        .dc-step{margin:10px -16px 0;padding:0 12px}
        .dc-step button{font-size:10px;padding:8px 1px 10px}
        .dc-hq{display:none!important}
        .dc-stats{grid-template-columns:repeat(2,1fr)}
        .dc-mbar{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#111;border-top:1px solid rgba(255,255,255,.12)}
        .dc-mbar .dc-qa{flex:1;justify-content:center;padding:11px 6px}
        .dc-tab{padding:11px 12px;min-height:44px}
      }
      @media (prefers-reduced-motion:reduce){
        .dc-menu,.dc-stat,.dc-tl-item{animation:none!important}
        .dc-qa,.dc-chip,.dc-tab,.dc-step .bar{transition:none!important}
      }
    `}</style>
  );
}

/* ── Sticky header with quick actions + stage stepper ──────────────────────── */
export interface DealHeaderProps {
  deal: { id: string; client: string; client_phone?: string; type: string; property?: string; value: number; stage: string; agent_id: string; assigned_agent_ids: string[]; last_touch?: string; client_id?: string | null };
  valueLabel: string;
  typeStyle: React.CSSProperties;
  profiles: DealPerson[];
  isAdmin: boolean;
  onClose: () => void;
  onEmail: () => void;
  onNote: () => void;
  onMoveStage: (stage: string) => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onOpenContact?: () => void;
  /** The app's own call control (number picker + text), rendered in place of a plain tel: link. */
  callSlot?: React.ReactNode;
  onText?: () => void;
  textOpen?: boolean;
  /** Phones: the card folds its detail rows away once you scroll. */
  compact?: boolean;
}
export function nextStageOf(stage: string): string | null {
  const i = DEAL_STAGES.indexOf(stage as typeof DEAL_STAGES[number]);
  if (i < 0 || stage === 'Lost' || stage === 'Closed') return null;
  return DEAL_STAGES[i + 1] === 'Lost' ? null : DEAL_STAGES[i + 1];
}

export function DealHeader(p: DealHeaderProps) {
  const { deal } = p;
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);
  useEffect(() => { setPending(null); }, [deal.id, deal.stage]);

  const cur = STAGE_PALETTE[deal.stage] ?? FALLBACK;
  const ci = DEAL_STAGES.indexOf(deal.stage as typeof DEAL_STAGES[number]);
  const owner = p.profiles.find(x => x.id === deal.agent_id);
  const team = p.profiles.filter(x => (deal.assigned_agent_ids ?? []).includes(x.id) && x.id !== deal.agent_id);
  const nxt = nextStageOf(deal.stage);
  const tel = deal.client_phone ? `tel:${deal.client_phone.replace(/[^\d+]/g, '')}` : undefined;

  const actions = (mobile: boolean) => (
    <>
      {p.callSlot ?? <a className="dc-qa gold" href={tel} aria-disabled={!tel} title={tel ? `Call ${deal.client_phone}` : 'No phone on this deal'}><Icon name="phone" />Call</a>}
      <button className="dc-qa" onClick={p.onEmail}><Icon name="mail" />Email</button>
      {p.onText && <button className={`dc-qa${p.textOpen ? ' gold' : ''}`} onClick={p.onText}><Icon name="note" />Text</button>}
      <button className="dc-qa" onClick={p.onNote}><Icon name="note" />Note</button>
      <button className="dc-qa" disabled={!nxt} aria-disabled={!nxt} onClick={() => nxt && setPending(nxt)} title={nxt ? `Move to ${nxt}` : 'No next stage'}>
        <Icon name="next" />{mobile ? 'Next' : 'Next stage'}
      </button>
    </>
  );

  return (
    <>
      <div className="dc-head" style={{ ['--dc-cur' as string]: cur.dot }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, fontWeight: 600, margin: 0, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis' }}>{deal.client}</h3>
              <StageChip stage={deal.stage} />
              <span style={{ ...p.typeStyle, display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }}>{deal.type}</span>
            </div>
            <div style={{ display: p.compact ? 'none' : 'flex', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap', fontSize: 13, color: 'rgba(255,255,255,.7)' }}>
              {deal.property && <span style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.property}</span>}
              {deal.value > 0 && <span style={{ color: '#e8c477', fontWeight: 700 }}>{p.valueLabel}</span>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="clock" size={13} />{touchLabel(deal.last_touch)}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                {owner && <Avatar person={owner} size={26} owner />}
                {team.slice(0, 4).map(t => <span key={t.id} style={{ marginLeft: -6 }}><Avatar person={t} size={26} /></span>)}
                {team.length > 4 && <span style={{ marginLeft: 6, fontSize: 12 }}>+{team.length - 4}</span>}
              </span>
            </div>
          </div>
          <button onClick={p.onClose} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.7)', cursor: 'pointer', padding: 4 }}><Icon name="close" size={22} /></button>
        </div>

        <div className="dc-hq" style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {actions(false)}
          <div ref={menuRef} style={{ position: 'relative', marginLeft: 'auto' }}>
            <button className="dc-qa" onClick={() => setMenu(v => !v)} aria-label="More actions" aria-haspopup="menu" aria-expanded={menu}><Icon name="more" /></button>
            {menu && (
              <div className="dc-menu" role="menu">
                {deal.client_id && p.onOpenContact && <button role="menuitem" onClick={() => { setMenu(false); p.onOpenContact?.(); }}><Icon name="user" />Open contact</button>}
                <button role="menuitem" onClick={() => { setMenu(false); p.onCopyLink(); }}><Icon name="link" />Copy deal link</button>
                {deal.stage !== 'Closed' && <button role="menuitem" onClick={() => { setMenu(false); setPending('Closed'); }}><Icon name="check" />Mark won (Closed)</button>}
                {deal.stage !== 'Lost' && <button role="menuitem" onClick={() => { setMenu(false); setPending('Lost'); }}><Icon name="flag" />Mark lost</button>}
                {p.isAdmin && <button role="menuitem" className="danger" onClick={() => { setMenu(false); p.onDelete(); }}><Icon name="trash" />Delete deal</button>}
              </div>
            )}
          </div>
        </div>

        {/* Stage stepper */}
        <div className="dc-step" role="group" aria-label="Deal stage">
          {DEAL_STAGES.map((s, i) => {
            const isLost = deal.stage === 'Lost';
            const state = s === deal.stage ? 'cur' : (!isLost && ci >= 0 && i < ci && s !== 'Lost') ? 'done' : '';
            return (
              <button key={s} className={state} aria-current={s === deal.stage ? 'step' : undefined} onClick={() => s !== deal.stage && setPending(s)}
                style={s === 'Lost' ? { flex: '0 0 auto', minWidth: 54, marginLeft: 8 } : undefined}>
                <span className="bar" style={s === 'Lost' && state === 'cur' ? { background: STAGE_PALETTE.Lost.dot } : undefined} />
                {s}
              </button>
            );
          })}
        </div>
        {pending && (
          <div role="alertdialog" style={{ margin: '0 -26px', padding: '11px 26px', background: '#1d1d1d', borderTop: '1px solid rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, flex: 1, minWidth: 180 }}>
              Move <strong>{deal.client}</strong> from <StageChip stage={deal.stage} size="sm" /> to <StageChip stage={pending} size="sm" />?
              {pending === 'Lost' && <span style={{ color: 'rgba(255,255,255,.55)' }}> You&apos;ll be asked for a reason.</span>}
              {pending === 'Closed' && <span style={{ color: 'rgba(255,255,255,.55)' }}> You&apos;ll be offered follow-up enrollment.</span>}
            </span>
            <button className="dc-qa gold" onClick={() => { const s = pending; setPending(null); p.onMoveStage(s); }}>Confirm</button>
            <button className="dc-qa" onClick={() => setPending(null)}>Cancel</button>
          </div>
        )}
      </div>
      {/* Mobile bottom action bar lives in the modal flex column, below the scroller */}
      <MobileBarSlot>{actions(true)}</MobileBarSlot>
    </>
  );
}

/** Rendered by DealHeader but positioned last in the modal via CSS order. */
function MobileBarSlot({ children }: { children: React.ReactNode }) {
  return <div className="dc-mbar" style={{ order: 99 }}>{children}</div>;
}

/* ── Overview stat tiles ───────────────────────────────────────────────────── */
export function StatTiles({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="dc-stats">
      {items.map((s, i) => (
        <div key={s.label} className="dc-stat" style={{ animationDelay: `${i * 40}ms` }}>
          <div className="l">{s.label}</div>
          <div className="v" style={s.color ? { color: s.color } : undefined}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Pipeline board tile (matches the deal card: stage accent, avatar, chips) ── */
export function TileStyles() {
  return (
    <style>{`
      .dc-tile{position:relative;background:var(--c-surface,#fff);border:1px solid var(--c-line,#e5e7eb);border-radius:12px;padding:11px 13px 11px 16px;cursor:pointer;
        box-shadow:0 1px 2px rgba(0,0,0,.04);transition:box-shadow .15s,transform .15s,opacity .15s;user-select:none;overflow:hidden}
      .dc-tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--dc-dot,#9ca3af)}
      .dc-tile:hover{box-shadow:0 8px 20px rgba(0,0,0,.1);transform:translateY(-1px)}
      @media (prefers-reduced-motion:reduce){.dc-tile{transition:none}.dc-tile:hover{transform:none}}
    `}</style>
  );
}
export function DealTile({ deal, ownerName, valueLabel, typeStyle, dragging, onClick, dragProps, showOwner }: {
  deal: { client: string; property?: string; type: string; value: number; stage: string; earned_commission?: number | null; tags?: string[]; last_touch?: string };
  ownerName: string; valueLabel: string; typeStyle: React.CSSProperties; dragging?: boolean; showOwner?: boolean;
  onClick: () => void; dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const c = STAGE_PALETTE[deal.stage] ?? FALLBACK;
  const [first = '', ...rest] = (ownerName || '').split(' ');
  const touched = daysAgo(deal.last_touch);
  return (
    <div className="dc-tile" style={{ ['--dc-dot' as string]: c.dot, opacity: dragging ? 0.5 : 1, borderColor: dragging ? c.dot : undefined, cursor: dragProps?.draggable ? 'grab' : 'pointer' }}
      onClick={onClick} {...dragProps}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--c-ink,#111)', lineHeight: 1.3, flex: 1, minWidth: 0 }}>{deal.client}</div>
        {showOwner && ownerName && <Avatar person={{ id: '', first_name: first, last_name: rest.join(' ') }} size={22} title={ownerName} />}
      </div>
      {deal.property && <div style={{ fontSize: 12, color: 'var(--c-muted,#6b7280)', margin: '3px 0 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.property}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: deal.property ? 0 : 7 }}>
        <span style={{ ...typeStyle, display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{deal.type.split(' ')[0]}</span>
        {deal.value > 0 && <span style={{ fontSize: 12.5, color: 'var(--c-ink,#111)', fontWeight: 700 }}>{valueLabel}</span>}
        {deal.earned_commission != null && deal.earned_commission > 0 && (
          <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>${Number(deal.earned_commission).toLocaleString()} billable</span>
        )}
      </div>
      {((deal.tags ?? []).length > 0 || touched != null) && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
          {(deal.tags ?? []).slice(0, 2).map(t => (
            <span key={t} style={{ background: '#fef3c7', color: '#92400e', padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600 }}>{t}</span>
          ))}
          {(deal.tags ?? []).length > 2 && <span style={{ fontSize: 10.5, color: '#9ca3af', fontWeight: 600 }}>+{(deal.tags ?? []).length - 2}</span>}
          {touched != null && (
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: touched > 14 ? '#b45309' : '#9ca3af', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="clock" size={11} />{touched === 0 ? 'today' : `${touched}d`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
