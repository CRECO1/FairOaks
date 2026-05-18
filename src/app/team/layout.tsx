import type { Metadata } from 'next';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

const personSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person',
      name: 'Sandra Whitfield',
      jobTitle: 'Broker / Owner',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      email: 'sandra@fairoaksrealtygroup.com',
      url: `${BASE_URL}/team`,
      knowsAbout: ['Luxury Estates', 'Relocation', 'Hill Country Acreage', 'Texas Real Estate'],
    },
    {
      '@type': 'Person',
      name: 'James Morales',
      jobTitle: 'Realtor® — Buyer Specialist',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      email: 'james@fairoaksrealtygroup.com',
      url: `${BASE_URL}/team`,
      knowsAbout: ['First-Time Buyers', 'New Construction', 'Investment Properties'],
    },
    {
      '@type': 'Person',
      name: 'Karen Liu',
      jobTitle: 'Realtor® — Listing Specialist',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      email: 'karen@fairoaksrealtygroup.com',
      url: `${BASE_URL}/team`,
      knowsAbout: ['Home Staging', 'Negotiation', 'Downsizing'],
    },
    {
      '@type': 'Person',
      name: 'David Reyes',
      jobTitle: 'Realtor® — Military & VA Specialist',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      email: 'david@fairoaksrealtygroup.com',
      url: `${BASE_URL}/team`,
      knowsAbout: ['VA Loans', 'Military Relocation', 'Investment Properties'],
    },
  ],
};

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
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
      />
      {children}
    </>
  );
}
