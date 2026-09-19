'use client';

import dynamic from 'next/dynamic';

/**
 * CRMApp, loaded in the browser only.
 *
 * /crm/commercial and /crm/residential used to render <CRMApp> during SSR, where
 * it throws — so a hard load of either URL (the "Agent Login" link on crecotx.com,
 * a refresh, a bookmark) returned a 500 error page, while in-app navigation from
 * /crm worked because it only fetched the RSC payload. CRMApp is a session-gated,
 * fully client-side app, so server rendering it adds nothing.
 *
 * `ssr: false` is only permitted inside a Client Component, which is why this thin
 * wrapper exists rather than calling next/dynamic from the page files directly.
 */
const CRMApp = dynamic(() => import('@/components/crm/CRMApp'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
      Loading CRM…
    </div>
  ),
});

export default function CRMAppClient({ businessUnit }: { businessUnit: 'commercial' | 'residential' }) {
  return <CRMApp businessUnit={businessUnit} />;
}
