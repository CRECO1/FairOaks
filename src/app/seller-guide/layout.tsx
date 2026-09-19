import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function SellerGuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: "Seller's Guide", path: '/seller-guide' }]} />
      {children}
    </>
  );
}
