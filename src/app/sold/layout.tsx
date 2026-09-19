import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function SoldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Recently Sold', path: '/sold' }]} />
      {children}
    </>
  );
}
