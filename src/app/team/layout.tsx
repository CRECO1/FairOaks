import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meet Our Real Estate Team | Fair Oaks Realty Group',
  description:
    'Meet the experienced real estate agents at Fair Oaks Realty Group. Local experts serving Fair Oaks Ranch, Boerne, Helotes, and the Texas Hill Country since 2004.',
  keywords: [
    'Fair Oaks Ranch real estate agents',
    'Fair Oaks Ranch realtor team',
    'best realtor Fair Oaks Ranch TX',
    'top real estate agent Fair Oaks Ranch',
    'Texas Hill Country real estate agent',
    'Fair Oaks Realty Group team',
    'Boerne TX realtor',
    'Helotes TX real estate agent',
    'experienced realtor Fair Oaks Ranch',
    'local real estate expert Texas Hill Country',
  ],
  openGraph: {
    title: 'Meet Our Real Estate Team | Fair Oaks Realty Group',
    description:
      'Local experts serving Fair Oaks Ranch, Boerne & Helotes TX. Meet the agents who know the Texas Hill Country market inside and out.',
    url: 'https://www.fairoaksrealtygroup.com/team',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com/team',
  },
};

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
