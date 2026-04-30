import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Homes for Sale in Fair Oaks Ranch TX | Search All Listings',
  description:
    'Browse homes for sale in Fair Oaks Ranch, Boerne, Helotes & the Texas Hill Country. Filter by price, bedrooms, and location. New listings updated daily. View photos, details & schedule tours.',
  keywords: [
    'homes for sale Fair Oaks Ranch TX',
    'Fair Oaks Ranch real estate listings',
    'houses for sale Fair Oaks Ranch',
    'Boerne TX homes for sale',
    'Helotes TX homes for sale',
    'Texas Hill Country homes for sale',
    'Fair Oaks Ranch MLS listings',
    'residential homes for sale near San Antonio TX',
    'luxury homes Fair Oaks Ranch Texas',
    'new listings Fair Oaks Ranch',
  ],
  openGraph: {
    title: 'Homes for Sale in Fair Oaks Ranch TX | Fair Oaks Realty Group',
    description:
      'Browse all homes for sale in Fair Oaks Ranch, Boerne & Helotes TX. Filter by price, beds, and neighborhood. New listings added daily.',
    url: 'https://www.fairoaksrealtygroup.com/listings',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com/listings',
  },
};

export default function ListingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
