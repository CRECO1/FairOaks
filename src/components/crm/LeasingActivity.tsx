'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { LEASING_STATUSES, REPORT_COLUMNS, type ReportLine, type ReportSection } from '@/lib/leasing-activity';

// Leasing Activity — the owner/developer's weekly leasing report (Headwall's sheet) as a
// living document on the property card. Vacancies and expirations come from the Rent
// Roll; prospects are its "backup / prospective tenant" rows. Edit here all week, then
// Download for the owner's exact .xlsx layout.

interface Header { property: string; fund: string; agent: string }
interface Mk { emailed: number; opened: number; sent: number; openRate: number; lines: { email: string; calls: string }; campaigns: { name: string; sent: number; opened: number; openRate: number }[] }

const GREEN = '#1f3d2e', GOLD = '#b8972a', MINT = '#d6e4d6';
const SOURCE_ICON: Record<string, string> = { 'Website inquiry': '🌐', 'Email reply': '✉️', 'Call / text': '📞', Deal: '💼' };
const authOf = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const money = (n: number | null) => n === null || n === undefined ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
const TH: React.CSSProperties = { background: GREEN, color: '#fff', fontSize: 10.5, fontWeight: 800, padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 };
const TD: React.CSSProperties = { fontSize: 12.5, color: GREEN, padding: '3px 6px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' };

// Click-to-edit cell; saves on blur / Enter. type="money" stores a plain number.
function Edit({ value, onSave, type = 'text', width, placeholder }: { value: string | number | null; onSave: (v: string) => void; type?: 'text' | 'number' | 'date'; width?: number; placeholder?: string }) {
  const [v, setV] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => { setV(value === null || value === undefined ? '' : String(value)); }, [value]);
  return (
    <input value={v} type={type} placeholder={placeholder} onChange={e => setV(e.target.value)}
      onBlur={() => { if (String(value ?? '') !== v) onSave(v); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ width: width ?? '100%', minWidth: 0, border: '1px solid transparent', background: 'transparent', borderRadius: 6, padding: '5px 6px', fontSize: 12.5, color: GREEN, fontFamily: "'DM Sans',sans-serif" }}
      onFocus={e => { e.currentTarget.style.border = '1px solid #c9922c'; e.currentTarget.style.background = '#fff'; }}
      onBlurCapture={e => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent'; }} />
  );
}

export default function LeasingActivity({ listingId, authToken, isAdmin, onToast }: { listingId: string; authToken?: string; isAdmin?: boolean; onToast?: (m: string) => void }) {
  const [header, setHeader] = useState<Header | null>(null);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [mk, setMk] = useState<Mk | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch(`/api/crm/leasing-activity?listing_id=${listingId}`, { headers: authOf(authToken) }).then(r => r.json()).catch(() => ({}));
    setHeader(j.header ?? null); setSections(j.sections ?? []); setMk(j.marketing ?? null);
  }, [listingId, authToken]);
  useEffect(() => { load(); }, [load]);

  const save = async (id: string | null, patch: Record<string, unknown>) => {
    if (!id) return;
    const res = await fetch('/api/crm/rent-roll', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ id, ...patch }) });
    if (!res.ok) onToast?.('Could not save that change');
    load();
  };
  const addProspect = async (suite: string, sf: number | null) => {
    const res = await fetch('/api/crm/rent-roll', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(authToken) },
      body: JSON.stringify({ listing_id: listingId, is_backup: true, suite: suite || null, size_sf: sf, leasing_status: 'Prospect', activity_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) }) });
    if (!res.ok) onToast?.('Could not add the prospect'); else onToast?.('Prospect added — fill in the tenant');
    load();
  };
  const remove = async (id: string | null, name: string) => {
    if (!id || !confirm(`Remove ${name || 'this prospect'} from the report?`)) return;
    await fetch(`/api/crm/rent-roll?id=${id}`, { method: 'DELETE', headers: authOf(authToken) });
    load();
  };
  const saveFund = async (fund: string) => {
    await fetch('/api/crm/leasing-activity', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ listing_id: listingId, report_fund: fund }) });
    load();
  };
  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/leasing-activity?listing_id=${listingId}&format=xlsx`, { headers: authOf(authToken) });
      if (!res.ok) throw new Error();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Leasing Activity Report.xlsx';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { onToast?.('Could not build the report'); } finally { setBusy(false); }
  };

  if (!header) return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading leasing activity…</div>;
  const vacantSuites = (sections[0]?.lines ?? []).filter(l => l.occupant === 'VACANT' && (l.kind === 'vacancy' || l.kind === 'prospect'))
    .reduce<{ suite: string; sf: number | null }[]>((a, l) => (a.some(x => x.suite === l.suite) ? a : [...a, { suite: l.suite, sf: l.sf }]), []);

  const lineRow = (l: ReportLine, s: ReportSection, i: number) => {
    const bg = s.tone === 'vacant' ? MINT : '#fff';
    const isProspect = l.kind === 'prospect' || l.kind === 'passed';
    const p = (k: string) => (v: string) => save(l.rowId, { [k]: v });
    const firstOfSuite = l.occupant.startsWith('VACANT') && (i === 0 || s.lines[i - 1].suite !== l.suite);
    return (
      <tr key={`${l.rowId}-${i}`} style={{ background: bg }}>
        <td style={{ ...TD, fontWeight: 800, whiteSpace: 'nowrap' }}>{l.occupant}</td>
        <td style={TD}>{isProspect
          ? <select value={l.status} onChange={e => save(l.rowId, { leasing_status: e.target.value })} style={{ fontSize: 12, border: '1px solid #cbd5c0', borderRadius: 6, padding: '4px 4px', color: GREEN, background: '#fff' }}>
              {LEASING_STATUSES.map(x => <option key={x}>{x}</option>)}
            </select>
          : l.kind === 'expiring' ? <Edit value={l.status} onSave={p('renewal_status')} placeholder="Renewal status" /> : <span style={{ color: '#6b7280', fontSize: 11.5 }}>Marketing</span>}</td>
        <td style={TD}>{isProspect ? <><Edit value={l.dba} onSave={p('tenant_name')} placeholder="Tenant DBA" />{l.source && <span title="How this lead came in" style={{ display: 'inline-block', margin: '0 0 3px 6px', fontSize: 10, fontWeight: 800, letterSpacing: .3, color: '#a06a12', background: '#fff7e6', border: '1px solid #f0e2c4', borderRadius: 6, padding: '1px 6px' }}>{SOURCE_ICON[l.source] ?? '•'} {l.source}</span>}</> : l.kind === 'expiring' ? l.dba : ''}</td>
        <td style={TD}>{isProspect || l.kind === 'expiring' ? <Edit value={l.use} onSave={p('tenant_use')} placeholder="Use" /> : ''}</td>
        <td style={{ ...TD, textAlign: 'center' }}>{isProspect
          ? <select value={l.suite} onChange={e => save(l.rowId, { suite: e.target.value || null, size_sf: vacantSuites.find(v => v.suite === e.target.value)?.sf ?? null })} style={{ fontSize: 12, border: '1px solid #cbd5c0', borderRadius: 6, padding: '4px 2px', color: GREEN, background: '#fff' }}>
              <option value="">TBD</option>{vacantSuites.map(v => <option key={v.suite} value={v.suite}>{v.suite}</option>)}
            </select>
          : <b>{l.suite}</b>}</td>
        <td style={{ ...TD, textAlign: 'center' }}>{l.sf ? Number(l.sf).toLocaleString() : ''}</td>
        <td style={TD}>{isProspect || l.kind === 'expiring' ? <Edit type="date" value={l.date} onSave={p('activity_date')} /> : ''}</td>
        <td style={TD}>{isProspect || l.kind === 'expiring' ? <Edit type="number" value={l.proposedRent} onSave={p('proposed_rent')} placeholder="$/SF" /> : ''}</td>
        <td style={TD}>{isProspect || l.kind === 'expiring' ? <Edit type="number" value={l.proposedTi} onSave={p('proposed_ti')} placeholder="$/SF" /> : ''}</td>
        <td style={{ ...TD, textAlign: 'center' }}>{isProspect || l.kind === 'expiring'
          ? <select value={l.national === null ? '' : l.national ? 'Y' : 'N'} onChange={e => save(l.rowId, { is_national: e.target.value })} style={{ fontSize: 12, border: '1px solid #cbd5c0', borderRadius: 6, padding: '4px 2px', color: GREEN, background: '#fff' }}>
              <option value="">—</option><option value="Y">Y</option><option value="N">N</option>
            </select> : ''}</td>
        <td style={{ ...TD, textAlign: 'center', whiteSpace: 'nowrap' }}>{day(l.expiration)}</td>
        <td style={TD}>{l.kind === 'expiring' ? <Edit value={l.renewalType} onSave={p('renewal_type')} placeholder="Renewal type" /> : ''}</td>
        <td style={{ ...TD, minWidth: 220 }}><Edit value={l.notes} onSave={p('notes')} placeholder={l.kind === 'vacancy' ? 'Notes for this space' : 'Notes'} /></td>
        <td style={{ ...TD, textAlign: 'center' }}>{money(l.prevRentPsf)}</td>
        <td style={{ ...TD, whiteSpace: 'nowrap', textAlign: 'right' }}>
          {firstOfSuite && s.tone === 'vacant' && l.occupant === 'VACANT' && (
            <button onClick={() => addProspect(l.suite, l.sf)} title="Add a prospect for this suite" style={{ fontSize: 11.5, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px dashed #e6d3a2', borderRadius: 7, padding: '4px 8px', cursor: 'pointer' }}>＋ Prospect</button>
          )}
          {isProspect && isAdmin && <button onClick={() => remove(l.rowId, l.dba)} title="Remove from the report" style={{ background: 'none', border: 'none', color: '#d9a3a3', fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>✕</button>}
        </td>
      </tr>
    );
  };

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: GREEN, color: '#fff', borderRadius: 10, padding: '12px 14px', marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 16, flex: '1 1 180px' }}>{header.property}<div style={{ fontSize: 11, fontWeight: 600, color: '#cfe0cf', marginTop: 2 }}>Leasing Activity Report · live</div></div>
        <label style={{ fontSize: 11, color: GOLD, fontWeight: 800 }}>FUND
          <input defaultValue={header.fund} onBlur={e => { if (e.target.value !== header.fund) saveFund(e.target.value); }}
            style={{ display: 'block', marginTop: 2, width: 130, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.25)', borderRadius: 6, color: '#fff', padding: '4px 7px', fontSize: 12.5 }} /></label>
        <div style={{ fontSize: 11, color: GOLD, fontWeight: 800 }}>LEASING AGENT<div style={{ color: '#fff', fontWeight: 600, fontSize: 12.5, marginTop: 4 }}>{header.agent || '—'}</div></div>
        <button onClick={download} disabled={busy} style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 800, color: GREEN, background: '#fff', border: 'none', borderRadius: 8, padding: '9px 13px', cursor: 'pointer' }}>
          {busy ? 'Building…' : '⬇ Download report (.xlsx)'}
        </button>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'auto', background: '#fff', maxHeight: '70vh' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1280 }}>
          <thead><tr>{REPORT_COLUMNS.map(c => <th key={c} style={TH}>{c}</th>)}<th style={{ ...TH, width: 90 }} /></tr></thead>
          <tbody>
            {sections.map(s => (
              <React.Fragment key={s.title}>
                <tr><td colSpan={15} style={{ background: s.tone === 'expiring' ? GOLD : GREEN, color: '#fff', fontWeight: 800, fontSize: 12.5, textAlign: 'center', padding: '7px 8px' }}>{s.title}</td></tr>
                {s.lines.length ? s.lines.map((l, i) => lineRow(l, s, i))
                  : <tr><td colSpan={15} style={{ ...TD, color: '#9ca3af', textAlign: 'center', padding: 10 }}>{s.tone === 'passed' ? 'No prospects have passed.' : 'None.'}</td></tr>}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 7 }}>
        Suites and expirations come from the Rent Roll tab; prospects are its backup / prospective-tenant rows. Set a prospect to <b>Passed</b> to move it to Passed Status. Rent and TI are $/SF.
      </div>

      {mk && (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12.5, color: '#374151' }}>
          <span style={{ fontSize: 11, letterSpacing: .7, textTransform: 'uppercase', color: GOLD, fontWeight: 800 }}>Email marketing</span><span>{mk.lines.email}</span>
          <span style={{ fontSize: 11, letterSpacing: .7, textTransform: 'uppercase', color: GOLD, fontWeight: 800 }}>Calls</span><span>{mk.lines.calls}</span>
          <span /><span style={{ color: '#9ca3af' }}>Both lines appear in the header of the downloaded sheet; per-campaign detail is on its second sheet.</span>
        </div>
      )}
    </div>
  );
}
