'use client';

import React from 'react';
import { COUNTY_NAME, type CountyAppraisal } from '@/lib/county-notes';
import type { CountyLive } from '@/lib/county-live';

// The deal card's Property Intel tab, first section: what the CRM already knows about the deal's property — the county appraisal the
// Property DB carries (owner, value, parcel…), and our own listing when the deal is tied to one. Free, loads on its own.

export interface IntelMatch {
  id: string; name?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; asset_type?: string | null;
  size_sf?: number | null; year_built?: number | null; zoning?: string | null; lot_size_acres?: number | null; parcel_apn?: string | null;
  owner_name?: string | null; owner_client_id?: string | null; listing_company?: string | null; listing_agent_name?: string | null; vacancy_status?: string | null; asking_rate?: string | null;
  county: CountyAppraisal | null;
}
export interface IntelListing { id: string; name?: string | null; address?: string | null; city?: string | null; type?: string | null; status?: string | null; sq_ft?: number | null; asking_price?: number | null; zoning?: string | null; year_built?: number | null; lot_size?: number | null }
export interface IntelData { address: string; match: IntelMatch | null; otherMatches: number; listing: IntelListing | null; live?: CountyLive | null; attomConfigured: boolean }

const usd = (n?: number | null) => (n && n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : '');
const num = (n?: number | null) => (n && n > 0 ? n.toLocaleString('en-US') : '');
const LABEL: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600 };

function Tile({ label, value, sub, onClick }: { label: string; value: string; sub?: string; onClick?: () => void }) {
  if (!value) return null;
  const body = (
    <>
      <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: onClick ? '#a06a12' : 'var(--k-111)', overflowWrap: 'anywhere' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 2 }}>{sub}</div>}
    </>
  );
  const box: React.CSSProperties = { background: 'var(--k-fff)', border: '1px solid var(--k-f0f0f0)', borderRadius: 7, padding: '10px 12px', textAlign: 'left', minWidth: 0, font: 'inherit' };
  return onClick
    ? <button type="button" onClick={onClick} title="Open this contact" style={{ ...box, cursor: 'pointer', borderColor: 'var(--k-e6d3a2)' }}>{body}</button>
    : <div style={box}>{body}</div>;
}

export default function PropertyIntelCard({ data, loading, failed, onOpenOwner }: { data: IntelData | null; loading: boolean; failed: boolean; onOpenOwner: (clientId: string) => void }) {
  if (loading && !data) return <div style={{ padding: '18px 0', fontSize: 13, color: 'var(--k-9ca3af)' }}>Looking up this property…</div>;
  if (failed && !data) return <div style={{ padding: '14px 0', fontSize: 13, color: 'var(--k-9ca3af)' }}>Could not load the property details just now — close and reopen the deal to try again.</div>;
  if (!data) return null;
  const m = data.match, l = data.listing, lv = data.live ?? null;
  if (!m && !l && !lv) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 18px', color: 'var(--k-9ca3af)', background: 'var(--k-f9fafb)', border: '1px dashed var(--k-d1d5db)', borderRadius: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-374151)', marginBottom: 4 }}>{data.address ? `Nothing on file yet for “${data.address}”` : 'This deal has no property address'}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>County owner, appraised value and parcel details appear here once the Property DB has this street address{data.address ? '' : ' — add the address on the Overview tab'}.</div>
      </div>
    );
  }
  const c = m?.county ?? null;
  const cadCode = c?.source.replace(/\s*\d{4}\s*$/, '').trim() ?? '';
  const cadYear = c?.source.match(/(\d{4})\s*$/)?.[1];
  const acres = c?.acres ?? m?.lot_size_acres ?? undefined;
  const owner = c?.owner ?? m?.owner_name ?? '';
  const addr = [m?.address ?? l?.address, m?.city ?? l?.city].filter(Boolean).join(', ');
  const grid = (children: React.ReactNode) => <div className="stats-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>{children}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {m && (
        <div style={{ background: 'var(--k-f9fafb)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={LABEL}>County &amp; Property DB</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)', minWidth: 0, overflowWrap: 'anywhere' }}>{addr}</div>
            {m.asset_type && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: 'var(--k-eef2ff)', color: 'var(--k-3730a3)' }}>{m.asset_type}</span>}
          </div>
          {grid(<>
            <Tile label="Owner" value={owner} onClick={m.owner_client_id ? () => onOpenOwner(m.owner_client_id!) : undefined} />
            <Tile label="Appraised value" value={usd(c?.market)} sub={cadYear ? `${cadYear} appraisal` : undefined} />
            <Tile label="Land" value={usd(c?.land)} />
            <Tile label="Improvements" value={usd(c?.improvements)} />
            <Tile label="Acres" value={acres ? String(acres) : ''} />
            <Tile label="Building SF" value={num(m.size_sf)} />
            <Tile label="Year built" value={m.year_built ? String(m.year_built) : ''} />
            <Tile label="Zoning / use" value={[m.zoning, c?.use && `use ${c.use}`].filter(Boolean).join(' · ')} />
            <Tile label="Parcel" value={c?.parcel ?? m.parcel_apn ?? ''} />
          </>)}
          {c?.legal && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--k-9ca3af)' }}>Legal: {c.legal}</div>}
          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--k-9ca3af)' }}>
            {c ? `Source: ${COUNTY_NAME[cadCode] ?? cadCode} appraisal district${cadYear ? `, ${cadYear} tax year` : ''}, via the Property DB. ` : 'From the Property DB. '}Verify before quoting a number to a client.
            {data.otherMatches > 0 ? ` ${data.otherMatches} more record${data.otherMatches === 1 ? '' : 's'} at this address in the Property DB.` : ''}
          </div>
        </div>
      )}
      {lv && (
        <div style={{ background: 'var(--k-f9fafb)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={LABEL}>County record</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)', minWidth: 0, overflowWrap: 'anywhere' }}>{lv.situs}</div>
          </div>
          {grid(<>
            <Tile label="Owner of record" value={lv.owner} />
            <Tile label={lv.parcels.length > 1 ? 'Parcels' : 'Parcel'} value={lv.parcels.map(p => p.parcel).filter(Boolean).join(' · ')} sub={lv.parcels.length > 1 ? `${lv.parcels.length} parcels at this address` : undefined} />
            <Tile label="Appraised value" value={usd(lv.parcels.find(p => p.appraised)?.appraised)} sub={lv.year ? `${lv.year} roll` : undefined} />
            <Tile label="Property type" value={[...new Set(lv.parcels.map(p => p.use).filter(Boolean))].join(' · ')} />
            <Tile label="Business on file" value={[...new Set(lv.parcels.map(p => p.dba).filter(Boolean))].join(' · ')} />
          </>)}
          {lv.parcels[0]?.legal && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--k-9ca3af)' }}>Legal: {lv.parcels[0].legal}</div>}
          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--k-9ca3af)' }}>
            Source: {lv.source}, public records, looked up just now. {lv.parcels.some(p => p.appraised) ? '' : 'The district shows no appraised value until the new year is certified. '}Verify before quoting a number to a client.
          </div>
        </div>
      )}
      {l && (
        <div style={{ background: 'var(--k-f9fafb)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={LABEL}>Our listing</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)' }}>{l.name || l.address}</div>
            {l.status && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: l.status === 'active' ? 'var(--k-d1fae5)' : 'var(--k-f3f4f6)', color: l.status === 'active' ? 'var(--k-065f46)' : 'var(--k-6b7280)' }}>{l.status}</span>}
          </div>
          {grid(<>
            <Tile label="Type" value={l.type ?? ''} />
            <Tile label="Square feet" value={num(l.sq_ft)} />
            <Tile label="Asking price" value={usd(l.asking_price)} />
            <Tile label="Zoning" value={l.zoning ?? ''} />
            <Tile label="Year built" value={l.year_built ? String(l.year_built) : ''} />
            <Tile label="Lot" value={l.lot_size ? `${num(l.lot_size)}` : ''} />
          </>)}
        </div>
      )}
    </div>
  );
}
