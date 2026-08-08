'use client';

import { useState, useRef, useCallback } from 'react';

interface Profile { id: string; first_name: string; last_name: string; role: string; }

interface Props {
  value: string;
  onChange: (val: string) => void;
  onMentionedIds?: (ids: string[]) => void;
  profiles: Profile[];
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

export default function MentionTextarea({ value, onChange, onMentionedIds, profiles, placeholder, className, style, id }: Props) {
  const [search, setSearch]     = useState('');
  const [showDrop, setShowDrop] = useState(false);
  const [atPos, setAtPos]       = useState(-1);
  const [rect, setRect]         = useState<{ top: number; left: number; width: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = search.length === 0
    ? profiles.slice(0, 8)
    : profiles.filter(p =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8);

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
  }, [onChange, onMentionedIds, profiles]);

  const pickProfile = useCallback((p: Profile) => {
    const mention = `@${p.first_name} `;
    const before  = value.slice(0, atPos);
    const after   = value.slice(atPos + 1 + search.length);
    const next    = before + mention + after;
    onChange(next);
    if (onMentionedIds) onMentionedIds(parseMentionIds(next, profiles));
    setShowDrop(false);
    setSearch('');
    setTimeout(() => {
      if (taRef.current) {
        const pos = before.length + mention.length;
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [value, atPos, search, onChange, onMentionedIds, profiles]);

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

        {value.includes('@') && (
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
            {[...value.matchAll(/@(\w+)/g)].map(m => `@${m[1]}`).join(', ')} will be notified on save
          </div>
        )}
      </div>

      {/* Dropdown rendered fixed to viewport — bypasses all overflow clipping */}
      {showDrop && suggestions.length > 0 && rect && (
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
          <div style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #f1f5f9' }}>
            Tag a team member
          </div>
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
        </div>
      )}
    </>
  );
}
