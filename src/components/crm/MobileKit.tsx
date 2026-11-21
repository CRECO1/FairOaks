'use client';
import type { ReactNode } from 'react';

/** Phone page header: big serif title + one line of context. Styles (.m-head, .m-tiles, .m-tile, .m-pills, .m-pill) live in CRMApp's <style>. */
export function MHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="m-head" style={action ? { display: 'flex', alignItems: 'flex-start', gap: 12 } : undefined}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export type MTileData = { label: string; value: string | number; sub?: string; tone?: 'warn' | 'good' | 'blue'; onClick?: () => void };

/** 2-up grid of big-number tiles (tap a tile to jump to what it counts). */
export function MTiles({ tiles }: { tiles: MTileData[] }) {
  return (
    <div className="m-tiles">
      {tiles.map((t) => {
        const cls = `m-tile${t.tone ? ' ' + t.tone : ''}${t.onClick ? ' tap' : ''}`;
        const inner = (<><div className="l">{t.label}</div><div className="v">{t.value}</div>{t.sub && <div className="s">{t.sub}</div>}</>);
        return t.onClick
          ? <button key={t.label} type="button" className={cls} onClick={t.onClick}>{inner}</button>
          : <div key={t.label} className={cls}>{inner}</div>;
      })}
    </div>
  );
}

/** One scrolling row of rounded filter pills. */
export function MPills<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="m-pills" role="tablist">
      {items.map((p) => (
        <button key={p.id} type="button" role="tab" aria-selected={value === p.id} className={`m-pill${value === p.id ? ' on' : ''}`} onClick={() => onChange(p.id)}>{p.label}</button>
      ))}
    </div>
  );
}
