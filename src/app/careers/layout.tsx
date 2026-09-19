import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

export const metadata: Metadata = {
  // Already carries the brand: absolute, so the layout template does not append it twice.
  title: { absolute: 'Careers | Fair Oaks Realty Group' },
  description: 'Join Fair Oaks Realty Group in the Texas Hill Country. Competitive splits, built-in lead flow, full marketing support, and a culture that has your back.',
  keywords: ['real estate agent jobs San Antonio', 'join real estate team Texas', 'real estate careers Hill Country', 'Fair Oaks Realty Group careers', 'real estate agent Fair Oaks Ranch', 'CRECO careers'],
  alternates: { canonical: 'https://www.fairoaksrealtygroup.com/careers' },
  openGraph: {
    title: 'Careers at Fair Oaks Realty Group',
    description: 'Build your real estate career with a team that invests in your success. Open positions in residential and commercial real estate.',
    url: 'https://www.fairoaksrealtygroup.com/careers',
    images: [{ url: 'https://www.fairoaksrealtygroup.com/images/og-home.jpg', width: 1200, height: 630 }],
  },
};

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Careers', path: '/careers' }]} />
      {children}
    </>
  );
}
