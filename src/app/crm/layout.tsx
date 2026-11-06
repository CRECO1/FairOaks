import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Fair Oaks CRM',
  description: 'Fair Oaks Realty Group — Agent CRM',
  manifest: '/crm-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Fair Oaks CRM',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#111111',
};

export default async function CRMLayout({ children }: { children: React.ReactNode }) {
  // TEMPORARY DIAGNOSTIC (removed in the next commit): what does the render step receive from the middleware?
  const h = await headers();
  const dbg = `x-nonce=${h.get('x-nonce') ? 'yes' : 'no'}; csp=${(h.get('content-security-policy') ?? 'none').slice(0, 60)}; ro=${h.get('content-security-policy-report-only') ? 'yes' : 'no'}; names=${[...h.keys()].filter(k => /csp|nonce|middleware|security/i.test(k)).join(',')}`;
  return <><meta name="csp-diagnostic" content={dbg} />{children}</>;
}
