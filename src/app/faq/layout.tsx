import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'FAQ', path: '/faq' }]} />
      {children}
    </>
  );
}
