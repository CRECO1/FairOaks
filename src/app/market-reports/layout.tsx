import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function MarketReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Market Reports', path: '/market-reports' }]} />
      {children}
    </>
  );
}
