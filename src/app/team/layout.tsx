import type { Metadata } from 'next';
import { jsonLdScript } from '@/lib/json-ld';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

// The real team, and only the real team: two people.
//
// This graph previously asserted four Person entities, none of whom exist. They
// carried invented @fairoaksrealtygroup.com addresses and were published as
// structured data, so search engines and AI assistants were told four fictitious
// licensed agents worked here.
//
// Every field below is either confirmed by the brokerage or omitted. No emails,
// telephone numbers, specialties or licence numbers appear per person: the
// organisation's own contact details already live in the site-wide Organization
// schema, and a licence number is published only once a real one is supplied.
const personSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person',
      name: 'Zachary Stovall',
      jobTitle: 'Broker / Owner',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      url: `${BASE_URL}/team`,
    },
    {
      '@type': 'Person',
      name: 'Brian Blanco',
      jobTitle: 'Real Estate Agent',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      url: `${BASE_URL}/team`,
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
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personSchema) }}
      />
      {children}
    </>
  );
}
