import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Terms of Use', path: '/terms' }]} />
      {children}
    </>
  );
}
