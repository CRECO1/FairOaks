import React from 'react';

/** Line icons for My Drive — the same drawing style as the CRM chrome (Ico.tsx), so the Drive no longer leans on emoji. Stroke follows currentColor. */
export type DIName =
  | 'folder' | 'folderLock' | 'folderDeal' | 'doc' | 'form' | 'file' | 'image' | 'sheet' | 'clock' | 'template' | 'trash' | 'search' | 'plus'
  | 'upload' | 'download' | 'lock' | 'users' | 'user' | 'briefcase' | 'open' | 'pen' | 'eye' | 'restore' | 'grid' | 'chevron' | 'dots' | 'move' | 'close';

const FOLDER = 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z';

const PATHS: Record<DIName, React.ReactNode> = {
  folder: <path d={FOLDER} />,
  folderLock: <><path d={FOLDER} /><rect x="9.5" y="12" width="5" height="4" rx="1" /><path d="M10.5 12v-1a1.5 1.5 0 013 0v1" /></>,
  folderDeal: <><path d={FOLDER} /><rect x="8.5" y="11" width="7" height="5" rx="1" /><path d="M8.5 13.5h7" /></>,
  doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  form: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6" /><path d="M9 16l1.5 1.5L14 14" /></>,
  file: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M4 18l5-5 4 4 3-3 4 4" /></>,
  sheet: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  template: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16M9 9v11" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 5a3.5 3.5 0 010 7M18 14c2.2.6 3.5 2.6 3.5 6" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18" /></>,
  open: <path d="M7 17L17 7M9 7h8v8" />,
  pen: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  restore: <><path d="M4 12a8 8 0 112.5 5.8" /><path d="M4 6v6h6" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  dots: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  move: <><path d={FOLDER} /><path d="M9 13h6M13 11l2 2-2 2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export default function DI({ n, size = 18, style }: { n: DIName; size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, ...style }}>
      {PATHS[n]}
    </svg>
  );
}

/** Which icon + colour a Drive item gets. Colours are applied with a low-alpha tint behind the icon, so they read in light and dark. */
export function toneFor(kind: 'folder' | 'doc' | 'form' | 'file', o: { visibility?: string; deal_id?: string | null; name?: string; mime?: string | null } = {}): { icon: DIName; color: string } {
  if (kind === 'folder') return o.visibility === 'private' ? { icon: 'folderLock', color: '#6b7280' } : o.deal_id ? { icon: 'folderDeal', color: '#2563eb' } : { icon: 'folder', color: '#c9922c' };
  if (kind === 'doc') return { icon: 'doc', color: '#2563eb' };
  if (kind === 'form') return { icon: 'form', color: '#7c3aed' };
  const n = (o.name ?? '').toLowerCase();
  if (o.mime === 'application/pdf' || n.endsWith('.pdf')) return { icon: 'file', color: '#dc2626' };
  if (o.mime?.startsWith('image/')) return { icon: 'image', color: '#059669' };
  if (/\.(xlsx?|csv)$/.test(n)) return { icon: 'sheet', color: '#16a34a' };
  if (/\.(docx?)$/.test(n)) return { icon: 'doc', color: '#2563eb' };
  if (/\.(pptx?)$/.test(n)) return { icon: 'template', color: '#ea580c' };
  return { icon: 'file', color: '#6b7280' };
}
