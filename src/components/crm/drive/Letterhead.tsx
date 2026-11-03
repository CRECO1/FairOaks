'use client';
import { LETTERHEAD } from '@/lib/doc-pdf';

/** CRECO letterhead for a document page: the logo, contact line and rule on top; the rule, tagline and contact line underneath. */
export function LetterheadHeader() {
  return (
    <div aria-hidden style={{ textAlign: 'center', marginBottom: 22, userSelect: 'none' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LETTERHEAD.logoPath} alt="CRECO" style={{ display: 'block', width: 240, maxWidth: '66%', margin: '0 auto 6px' }} />
      <div style={{ fontSize: 10, color: '#57595e', whiteSpace: 'pre-wrap' }}>{LETTERHEAD.contact}</div>
      <div style={{ borderBottom: '2.4px solid #1c1c1f', marginTop: 8 }} />
    </div>
  );
}
export function LetterheadFooter() {
  return (
    <div aria-hidden style={{ borderTop: '2.4px solid #1c1c1f', marginTop: 40, paddingTop: 8, textAlign: 'center', userSelect: 'none' }}>
      <div style={{ fontStyle: 'italic', fontSize: 10.5, color: '#3a3a3f' }}>{LETTERHEAD.tagline}</div>
      <div style={{ fontSize: 9, color: '#57595e', marginTop: 2, whiteSpace: 'pre-wrap' }}>{LETTERHEAD.footContact}</div>
    </div>
  );
}
