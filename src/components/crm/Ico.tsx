import React from 'react';

/**
 * Line icons for the CRM chrome (sidebar, top bar). They replace the emoji that used to sit in the nav — emoji draw
 * differently on every device and can't take the theme's colour. Stroke follows `currentColor`, so an icon takes the
 * colour of the text next to it (active gold, muted grey, white on the dark sidebar).
 */
export type IcoName =
  | 'home' | 'check' | 'deals' | 'users' | 'briefcase' | 'calendar' | 'megaphone' | 'receipt' | 'building'
  | 'file' | 'pen' | 'phone' | 'eye' | 'tree' | 'chart' | 'search' | 'bell' | 'mail' | 'sun' | 'moon' | 'sparkle' | 'image';

const PATHS: Record<IcoName, React.ReactNode> = {
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  check: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12l3 3 5-6" /></>,
  deals: <><rect x="3" y="3" width="6" height="18" rx="1.5" /><rect x="11" y="3" width="6" height="12" rx="1.5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 5a3.5 3.5 0 010 7M18 14c2.2.6 3.5 2.6 3.5 6" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  megaphone: <><path d="M3 11v3a1 1 0 001 1h2l7 4V6L6 10H4a1 1 0 00-1 1z" /><path d="M17 9a4 4 0 010 6" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  pen: <><path d="M4 20l4-1 11-11-3-3L5 16z" /></>,
  phone: <><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  tree: <><path d="M12 21v-6" /><path d="M12 15c-4 0-6-2.5-6-5.5 0-2 1.2-3.4 2.6-4C9 3.4 10.4 2 12 2s3 1.4 3.4 3.5c1.4.6 2.6 2 2.6 4 0 3-2 5.5-6 5.5z" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  bell: <><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path d="M10 21h4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M4 18l5-5 4 4 3-3 4 4" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></>,
};

export default function Ico({ n, size = 18, style }: { n: IcoName; size?: number; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
      style={{ flex: 'none', stroke: 'currentColor', fill: 'none', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', ...style }}>
      {PATHS[n]}
    </svg>
  );
}
