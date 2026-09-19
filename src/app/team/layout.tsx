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
// telephone numbers or specialties appear per person — the organisation's own
// contact details already live in the site-wide Organization schema.
//
// The licence numbers are the individual TREC numbers taken from the brokerage's
// Information About Brokerage Services (IABS) forms held in transaction-forms
// storage, not the firm's number (#9014367, which belongs to the entity and is
// shown in the footer).
const TREC = (id: string) => ({
  '@type': 'EducationalOccupationalCredential',
  credentialCategory: 'Texas Real Estate License',
  identifier: id,
  recognizedBy: {
    '@type': 'Organization',
    name: 'Texas Real Estate Commission',
    url: 'https://www.trec.texas.gov',
  },
});

const personSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person',
      name: 'Zachary Stovall',
      jobTitle: 'Broker / Owner',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      url: `${BASE_URL}/team`,
      identifier: '691174',
      hasCredential: TREC('691174'),
    },
    {
      '@type': 'Person',
      name: 'Brian Blanco',
      jobTitle: 'Director of Leasing',
      worksFor: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
      url: `${BASE_URL}/team`,
      identifier: '848449',
      hasCredential: TREC('848449'),
    },
  ],
};

export const metadata: Metadata = {
  title: 'Meet Our Real Estate Team | Fair Oaks Realty Group',
  description:
    'Meet the real estate agents at Fair Oaks Realty Group. Local experts serving Fair Oaks Ranch, Boerne, Helotes, and the Texas Hill Country.',
  keywords: [
    'Fair Oaks Ranch real estate agents',
    'Fair Oaks Ranch realtor team',
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
