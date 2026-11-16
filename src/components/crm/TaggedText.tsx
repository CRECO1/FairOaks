'use client';
import React from 'react';
import { parseListingTagIds, listingTagLabel, type TagListing } from '@/lib/listing-tags';

/**
 * Shows note text with its `#1222Chulie` property tags as small tappable links that open the property.
 * A tag that doesn't match exactly one of our listings (or text like "Unit #3") stays plain text.
 */
const RE = /(^|[^\w&])(#[A-Za-z0-9]+)/g;

export default function TaggedText({ text, listings, onOpen }: { text: string; listings: TagListing[]; onOpen?: (listingId: string) => void }) {
  if (!text || !onOpen || !listings.length || !text.includes('#')) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(text))) {
    const start = m.index + m[1].length;
    const ids = parseListingTagIds(m[2], listings);
    if (ids.length !== 1) continue;
    const l = listings.find(x => x.id === ids[0]);
    if (!l) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <button key={`${start}-${ids[0]}`} type="button" title={`${listingTagLabel(l)} — open the property`}
        onClick={e => { e.stopPropagation(); onOpen(ids[0]); }}
        style={{ display: 'inline', font: 'inherit', fontWeight: 700, color: 'var(--k-0f766e)', background: 'var(--k-f0fdfa)', border: '1px solid var(--k-99f6e4)', borderRadius: 10, padding: '0 6px', cursor: 'pointer' }}>
        🏠 {listingTagLabel(l)}
      </button>,
    );
    last = start + m[2].length;
  }
  if (!out.length) return <>{text}</>;
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
