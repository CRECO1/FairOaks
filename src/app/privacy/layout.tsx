import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Privacy Policy', path: '/privacy' }]} />
      {children}
    </>
  );
}
