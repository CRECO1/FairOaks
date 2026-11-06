import type { Metadata, Viewport } from 'next';

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

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
