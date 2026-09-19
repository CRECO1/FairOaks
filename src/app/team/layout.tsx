import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { jsonLdScript } from '@/lib/json-ld';
import { ORG_ID, BROKER_ID, AGENT_ID } from '@/lib/site-identity';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

// The two licensed people (Zachary Stovall, Brian Blanco) are declared once, in the
// site-wide graph (root layout → peopleNodes()), with stable @ids and their
// individual TREC licences. This page used to emit them a second time as
// anonymous Person nodes, which read as two more people; now it only points at
// the canonical nodes.
const teamPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': `${BASE_URL}/team#webpage`,
  url: `${BASE_URL}/team`,
  name: 'Meet the Fair Oaks Realty Group Team',
  about: { '@id': ORG_ID },
  mentions: [{ '@id': BROKER_ID }, { '@id': AGENT_ID }],
};

export const metadata: Metadata = {
  // Already carries the brand: absolute, so the layout template does not append it twice.
  title: { absolute: 'Meet Our Real Estate Team | Fair Oaks Realty Group' },
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
        dangerouslySetInnerHTML={{ __html: jsonLdScript(teamPageSchema) }}
      />
      <BreadcrumbJsonLd crumbs={[{ name: 'Our Team', path: '/team' }]} />
      {children}
    </>
  );
}
