import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function BuyerGuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: "Buyer's Guide", path: '/buyer-guide' }]} />
      {children}
    </>
  );
}
