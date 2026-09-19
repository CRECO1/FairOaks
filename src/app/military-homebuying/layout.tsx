import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export default function MilitaryHomebuyingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Military & VA Home Buying', path: '/military-homebuying' }]} />
      {children}
    </>
  );
}
