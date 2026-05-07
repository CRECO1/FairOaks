import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Real Estate Services in Fair Oaks Ranch TX | Buyer, Seller, VA & Military',
  description:
    'Full-service real estate in Texas Hill Country — buyer representation, seller marketing, VA & military homebuying, relocation, new construction, and commercial via CRECO. Fair Oaks Realty Group.',
  keywords: [
    'Fair Oaks Ranch realtor',
    'VA home loan Texas',
    'military relocation San Antonio',
    'PCS move Texas Hill Country',
    'Fort Sam Houston housing',
    'Lackland AFB housing',
    'buy home Fair Oaks Ranch',
    'sell home Fair Oaks Ranch',
    'new construction Hill Country',
    'Texas Hill Country real estate services',
  ],
  openGraph: {
    title: 'Real Estate Services in Fair Oaks Ranch TX | Buyer, Seller, VA & Military',
    description:
      'Full-service real estate in Texas Hill Country — buyer representation, seller marketing, VA & military homebuying, relocation, new construction, and commercial via CRECO. Fair Oaks Realty Group.',
    url: 'https://www.fairoaksrealtygroup.com/services',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com/services',
  },
};

export default function ServicesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
