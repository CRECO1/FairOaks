'use client';

import { useState, useRef, useCallback } from 'react';

interface Profile { id: string; first_name: string; last_name: string; role: string; }
// A CRM contact (client). Tagging one is silent — it records who is involved in the
// deal for the team; the contact is never notified.
export interface MentionContact { id: string; first_name?: string; last_name?: string; business_name?: string; type?: string }

interface Props {
  value: string;
  onChange: (val: string) => void;
  onMentionedIds?: (ids: string[]) => void;
  onMentionedContactIds?: (ids: string[]) => void;
  profiles: Profile[];
  contacts?: MentionContact[];
  /**
   * Called when the typed name matches nobody and the user chooses to add them.
   * Should create the contact and resolve to it (or null on failure). Without this
   * the "add" row simply isn't offered.
   */
  onCreateContact?: (name: string) => Promise<MentionContact | null>;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}

// Parse all @FirstName mentions from text → return matching profile IDs
export function parseMentionIds(text: string, profiles: Profile[]): string[] {
  const hits = [...text.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase());
  if (!hits.length) return [];
  return profiles
    .filter(p => hits.includes(p.first_name.toLowerCase()))
    .map(p => p.id);
}

// The single word a contact is mentioned by — their first name, or the first word of
// the business name for company records.
export const contactToken = (c: MentionContact): string =>
  ((c.first_name || c.business_name || '').trim().split(/\s+/)[0] || '').replace(/\W/g, '');
export const contactLabel = (c: MentionContact): string =>
  c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';

export function parseMentionContactIds(text: string, contacts: MentionContact[]): string[] {
  const hits = [...text.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase());
  if (!hits.length) return [];
  return contacts.filter(c => { const t = contactToken(c).toLowerCase(); return t && hits.includes(t); }).map(c => c.id);
}

export default function MentionTextarea({ value, onChange, onMentionedIds, onMentionedContactIds, profiles, contacts = [], onCreateContact, placeholder, className, style, id }: Props) {
  const [creating, setCreating] = useState(false);
  const [search, setSearch]     = useState('');
  const [showDrop, setShowDrop] = useState(false);
  const [atPos, setAtPos]       = useState(-1);
  const [rect, setRect]         = useState<{ top: number; left: number; width: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = search.length === 0
    ? profiles.slice(0, 6)
    : profiles.filter(p =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 6);
  // Contacts only surface once there's something to match on, so the menu doesn't open
  // with hundreds of names.
  const contactHits = search.length === 0 ? [] :
    contacts.filter(c => contactLabel(c).toLowerCase().includes(search.toLowerCase()) && contactToken(c)).slice(0, 6);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val    = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const match  = before.match(/@(\w*)$/);

    if (match) {
      setAtPos(cursor - match[0].length);
      setSearch(match[1]);
      setShowDrop(true);
      if (taRef.current) {
        const r = taRef.current.getBoundingClientRect();
        setRect({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    } else {
      setShowDrop(false);
      setSearch('');
    }

    onChange(val);
    if (onMentionedIds) onMentionedIds(parseMentionIds(val, profiles));
    if (onMentionedContactIds) onMentionedContactIds(parseMentionContactIds(val, contacts));
  }, [onChange, onMentionedIds, onMentionedContactIds, profiles, contacts]);

  const insertMention = useCallback((token: string) => {
    const mention = `@${token} `;
    const before  = value.slice(0, atPos);
    const after   = value.slice(atPos + 1 + search.length);
    const next    = before + mention + after;
    onChange(next);
    if (onMentionedIds) onMentionedIds(parseMentionIds(next, profiles));
    if (onMentionedContactIds) onMentionedContactIds(parseMentionContactIds(next, contacts));
    setShowDrop(false);
    setSearch('');
    setTimeout(() => {
      if (taRef.current) {
        const pos = before.length + mention.length;
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [value, atPos, search, onChange, onMentionedIds, onMentionedContactIds, profiles, contacts]);
  // Somebody from outside the CRM — the other side's broker, a lender, an attorney.
  // Offered only once the name looks like a name, so the row doesn't flash up on the
  // first keystroke of every mention.
  const canCreate = !!onCreateContact && search.trim().length >= 2 && suggestions.length === 0 && contactHits.length === 0;
  const createAndPick = useCallback(async () => {
    if (!onCreateContact) return;
    setCreating(true);
    try {
      const made = await onCreateContact(search.trim());
      if (made) insertMention(contactToken(made) || search.trim());
    } finally { setCreating(false); }
  }, [onCreateContact, search, insertMention]);

  const pickProfile = useCallback((p: Profile) => insertMention(p.first_name), [insertMention]);
  const pickContact = useCallback((c: MentionContact) => insertMention(contactToken(c)), [insertMention]);

  return (
    <>
      <div style={{ position: 'relative' }}>
        <textarea
          ref={taRef}
          id={id}
          className={className}
          style={style}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        />

        {value.includes('@') && (() => {
          const team = parseMentionIds(value, profiles);
          const tagged = parseMentionContactIds(value, contacts);
          const names = (ids: string[], list: { id: string }[], label: (x: never) => string) =>
            ids.map(i => label(list.find(x => x.id === i) as never)).filter(Boolean);
          const teamNames = names(team, profiles, (p: Profile) => `@${p.first_name}`);
          const contactNames = names(tagged, contacts, (c: MentionContact) => contactLabel(c));
          if (!teamNames.length && !contactNames.length) return null;
          return (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
              {teamNames.length > 0 && <span>{teamNames.join(', ')} will be notified on save. </span>}
              {contactNames.length > 0 && <span>Tagged (not notified): {contactNames.join(', ')}.</span>}
            </div>
          );
        })()}
      </div>

      {/* Dropdown rendered fixed to viewport — bypasses all overflow clipping */}
      {showDrop && (suggestions.length > 0 || contactHits.length > 0 || canCreate) && rect && (
        <div style={{
          position: 'fixed',
          top: rect.top,
          left: rect.left,
          width: rect.width,
          zIndex: 99999,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,.18)',
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}>
          {suggestions.length > 0 && (
            <div style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #f1f5f9' }}>
              Team member · notified
            </div>
          )}
          {suggestions.map(p => (
            <button
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); pickProfile(p); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif" }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{
                width: 28, height: 28, borderRadius: '50%', background: '#c9922c',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>
                {p.first_name[0]}{p.last_name[0]}
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{p.first_name} {p.last_name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{p.role}</div>
              </div>
            </button>
          ))}

          {canCreate && (
            <button
              onMouseDown={e => { e.preventDefault(); createAndPick(); }}
              disabled={creating}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', background: '#fffdf6', border: 'none', cursor: creating ? 'default' : 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif" }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fdf6e8')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fffdf6')}
            >
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#fdf6e8', color: '#a06a12', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0, border: '1px dashed #e6d3a2' }}>＋</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#a06a12' }}>{creating ? 'Adding…' : `Add “${search.trim()}” as a contact`}</div>
                <div style={{ fontSize: 11, color: '#b8935a' }}>Not in the CRM yet — creates the record and tags them</div>
              </div>
            </button>
          )}

          {contactHits.length > 0 && (
            <div style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, borderTop: suggestions.length ? '1px solid #f1f5f9' : undefined, borderBottom: '1px solid #f1f5f9' }}>
              Contact · not notified
            </div>
          )}
          {contactHits.map(c => (
            <button
              key={c.id}
              onMouseDown={(e) => { e.preventDefault(); pickContact(c); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif" }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{
                width: 28, height: 28, borderRadius: '50%', background: '#eef2ff', color: '#4338ca',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>
                {contactLabel(c).slice(0, 2).toUpperCase()}
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{contactLabel(c)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.type || 'Contact'}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
