import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MLS Listings in Fair Oaks Ranch, Boerne & Texas Hill Country | Fair Oaks Realty Group',
  description:
    'Search all active MLS listings in Fair Oaks Ranch, Boerne, Helotes, San Antonio and the Texas Hill Country. Filter by price, beds, and city. Powered by SABOR MLS.',
  keywords: [
    'fair oaks ranch homes for sale',
    'boerne tx mls listings',
    'helotes homes for sale',
    'san antonio mls search',
    'texas hill country listings',
    'active listings fair oaks ranch',
    'search homes texas',
    'sabor mls listings',
    'new listings hill country',
    'homes for sale texas',
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
