import type { Metadata } from 'next';

// The crecotx.com (commercial) CRM installs as its own app — "CRECO CRM", opening straight into this workspace —
// instead of the residential "Fair Oaks CRM" identity the parent /crm layout gives the other workspace.
export const metadata: Metadata = {
  title: 'CRECO CRM',
  description: 'CRECO Commercial Real Estate — Agent CRM',
  manifest: '/crm-commercial-manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'CRECO CRM' },
};

export default function CommercialCRMLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
