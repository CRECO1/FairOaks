'use client';
import { LETTERHEAD } from '@/lib/doc-pdf';

/** CRECO letterhead for a document page: the logo, contact line and rule on top; the rule, tagline and contact line underneath. */
export function LetterheadHeader() {
  return (
    <div aria-hidden style={{ textAlign: 'center', marginBottom: 22, userSelect: 'none' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LETTERHEAD.logoPath} alt="CRECO" style={{ display: 'block', width: 280, maxWidth: '72%', margin: '0 auto 6px' }} />
      <div style={{ fontSize: 10.5, color: '#57595e' }}>{LETTERHEAD.contact}</div>
      <div style={{ borderBottom: '3px solid #1c1c1f', marginTop: 8 }} />
    </div>
  );
}
export function LetterheadFooter() {
  return (
    <div aria-hidden style={{ borderTop: '3px solid #1c1c1f', marginTop: 40, paddingTop: 8, textAlign: 'center', userSelect: 'none' }}>
      <div style={{ fontStyle: 'italic', fontSize: 11, color: '#3a3a3f' }}>{LETTERHEAD.tagline}</div>
      <div style={{ fontSize: 9.5, color: '#57595e', marginTop: 2 }}>{LETTERHEAD.footContact}</div>
    </div>
  );
}
