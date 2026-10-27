import React from 'react';

/**
 * Placeholder bars shown while a list or panel loads, in place of a bare "Loading…". The shimmer (.sk in the shell's
 * style block) uses the theme tokens, so it reads in light and dark; reduced-motion users get static bars.
 */
const WIDTHS = [92, 78, 86, 64, 90, 72];

export default function Skeleton({ rows = 4, pad = 0, label = 'Loading' }: { rows?: number; pad?: number; label?: string }) {
  return (
    <div className="sk-wrap" role="status" aria-label={label} style={pad ? { padding: pad } : undefined}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row">
          <i className="sk sk-dot" />
          <i className="sk" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
        </div>
      ))}
    </div>
  );
}
