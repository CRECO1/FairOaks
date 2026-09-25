import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import AnalyticsScripts from '@/components/AnalyticsScripts';
import UtmCapture from '@/components/analytics/UtmCapture';
import StickyCTA from '@/components/ui/StickyCTA';
import { FORG, CRECO, AFFILIATION, ORG_ID, areaServed, peopleNodes, trecCredential } from '@/lib/site-identity';
import './globals.css';
import { jsonLdScript } from '@/lib/json-ld';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover', // safe-area support for iPhone notch/Dynamic Island
};

export const metadata: Metadata = {
  metadataBase: new URL('https://www.fairoaksrealtygroup.com'),
  alternates: {
    canonical: '/',
  },
  title: {
    default: 'Fair Oaks Ranch Homes for Sale | Fair Oaks Realty Group',
    template: '%s | Fair Oaks Realty Group',
  },
  description:
    'Search homes for sale in Fair Oaks Ranch, Boerne & Helotes TX. Local realtors and free home valuations across the Texas Hill Country.',
  keywords: [
    'Fair Oaks Ranch homes for sale',
    'Fair Oaks Ranch real estate',
    'Fair Oaks Ranch TX realtor',
    'homes for sale Fair Oaks Ranch Texas',
    'Texas Hill Country homes for sale',
    'Boerne TX homes for sale',
    'Helotes TX homes for sale',
    'Fair Oaks Ranch real estate agent',
    'luxury homes Fair Oaks Ranch',
    'sell my home Fair Oaks Ranch',
    'home value Fair Oaks Ranch TX',
    'residential real estate San Antonio TX',
    'Fair Oaks Ranch property listings',
    'buy a home Fair Oaks Ranch',
    'Fair Oaks Ranch neighborhood guide',
  ],
  authors: [{ name: 'Fair Oaks Realty Group' }],
  creator: 'Fair Oaks Realty Group',
  publisher: 'Fair Oaks Realty Group',
  formatDetection: { telephone: true, address: true, email: true },
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'mask-icon', url: '/icon.svg', color: '#DAA520' },
    ],
  },
  manifest: '/site.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Fair Oaks Realty',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#1A365D',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://www.fairoaksrealtygroup.com',
    siteName: 'Fair Oaks Realty Group',
    title: 'Fair Oaks Ranch Homes for Sale | Fair Oaks Realty Group',
    description:
      'Search homes for sale in Fair Oaks Ranch, Boerne & Helotes TX. Local realtors and free home valuations across the Texas Hill Country.',
    images: [
      {
        url: '/images/og-home.jpg',
        width: 1200,
        height: 630,
        alt: 'Fair Oaks Realty Group - Fair Oaks Ranch, Texas Homes for Sale',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Fair Oaks Ranch Homes for Sale | Fair Oaks Realty Group',
    description:
      'Fair Oaks Ranch, TX realtors. Search listings, get a free home valuation, and connect with local experts.',
    images: ['/images/og-home.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? '',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AnalyticsScripts />
        {/* Attribution capture. Wrapped in Suspense because it reads
            useSearchParams — without a boundary that would opt every page out
            of static rendering. It renders nothing, so the fallback is null. */}
        <Suspense fallback={null}>
          <UtmCapture />
        </Suspense>
        <StickyCTA />
        {/* JSON-LD Structured Data — LocalBusiness + RealEstateAgent */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': ['RealEstateAgent', 'LocalBusiness', 'Organization'],
                  '@id': ORG_ID,
                  name: 'Fair Oaks Realty Group',
                  alternateName: [...FORG.alternateName],
                  url: 'https://www.fairoaksrealtygroup.com',
                  logo: 'https://www.fairoaksrealtygroup.com/images/logo.png',
                  image: 'https://www.fairoaksrealtygroup.com/images/og-home.jpg',
                  description:
                    'Residential real estate agency serving Fair Oaks Ranch, Boerne, Helotes, and the Texas Hill Country.',
                  telephone: FORG.telephone,
                  email: 'info@fairoaksrealtygroup.com',
                  address: {
                    '@type': 'PostalAddress',
                    streetAddress: '8000 Fair Oaks Pkwy Suite 102',
                    addressLocality: 'Fair Oaks Ranch',
                    addressRegion: 'TX',
                    postalCode: '78015',
                    addressCountry: 'US',
                  },
                  geo: {
                    '@type': 'GeoCoordinates',
                    latitude: FORG.latitude,
                    longitude: FORG.longitude,
                  },
                  // State → region → counties → the cities with their own pages here.
                  areaServed: areaServed(),
                  hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(FORG.addressLine)}`,
                  // The firm's own TREC licence, machine-readable and labelled.
                  identifier: { '@type': 'PropertyValue', propertyID: 'TREC License', value: FORG.trecLicense },
                  hasCredential: trecCredential(
                    FORG.trecLicense,
                    `Texas Real Estate Broker License ${FORG.trecLicenseDisplay}`,
                    'Texas Real Estate Broker License (business entity)',
                  ),
                  contactPoint: [{
                    '@type': 'ContactPoint',
                    contactType: 'sales',
                    telephone: FORG.telephone,
                    email: FORG.email,
                    areaServed: 'US-TX',
                    availableLanguage: ['English'],
                  }],
                  // Fair Oaks Realty Group and CRECO are assumed names on the same TREC
                  // licence (#9014367); CRECO is the parent brokerage. crecotx.com
                  // declares the inverse (subOrganization), so the link is two-way.
                  parentOrganization: { '@id': CRECO.id },
                  founder: { '@id': `${FORG.url}/team#zachary-stovall` },
                  employee: [
                    { '@id': `${FORG.url}/team#zachary-stovall` },
                    { '@id': `${FORG.url}/team#brian-blanco` },
                  ],
                  openingHoursSpecification: [
                    {
                      '@type': 'OpeningHoursSpecification',
                      dayOfWeek: [...FORG.openingHours.dayOfWeek],
                      opens: FORG.openingHours.opens,
                      closes: FORG.openingHours.closes,
                    },
                  ],
                  // No aggregateRating: a 5.0 / 127-review rating was published here with
                  // nothing behind it — the site stores three testimonials and no review
                  // records. Google also requires an aggregateRating to reflect reviews
                  // shown on the page. Reinstate only from real, displayed review data.
                  // Profiles linked from the site footer. crecotx.com is deliberately NOT
                  // here: sameAs asserts the same entity, and CRECO is an affiliated brand
                  // — see disambiguatingDescription and the CRECO node below.
                  sameAs: [...FORG.sameAs],
                  priceRange: '$$$',
                  disambiguatingDescription: `${FORG.summary} ${AFFILIATION}`,
                  knowsAbout: [...FORG.knowsAbout, ...FORG.services],
                },
                // The affiliated commercial brokerage, under the @id crecotx.com itself uses,
                // so AI systems and search engines join the two sites' graphs.
                {
                  '@type': ['RealEstateAgent', 'LocalBusiness', 'Organization'],
                  '@id': CRECO.id,
                  name: CRECO.name,
                  legalName: CRECO.legalName,
                  url: CRECO.url,
                  description: CRECO.summary,
                  telephone: CRECO.telephone,
                  email: CRECO.email,
                  // CRECO is Suite 100 — a different suite from Fair Oaks' 102. This
                  // node previously reused the Fair Oaks address wholesale.
                  address: {
                    '@type': 'PostalAddress',
                    streetAddress: '8000 Fair Oaks Pkwy, Suite 100',
                    addressLocality: 'Fair Oaks Ranch',
                    addressRegion: 'TX',
                    postalCode: '78015',
                    addressCountry: 'US',
                  },
                  identifier: { '@type': 'PropertyValue', propertyID: 'TREC License', value: CRECO.license },
                },
                // The licensed people, each carrying their own individual TREC number.
                ...peopleNodes(),
                {
                  '@type': 'WebSite',
                  '@id': 'https://www.fairoaksrealtygroup.com/#website',
                  url: 'https://www.fairoaksrealtygroup.com',
                  name: 'Fair Oaks Realty Group',
                  description: 'Fair Oaks Ranch TX Homes for Sale – Texas Hill Country Real Estate',
                  publisher: { '@id': 'https://www.fairoaksrealtygroup.com/#organization' },
                  potentialAction: {
                    '@type': 'SearchAction',
                    target: {
                      '@type': 'EntryPoint',
                      urlTemplate: 'https://www.fairoaksrealtygroup.com/listings?q={search_term_string}',
                    },
                    'query-input': 'required name=search_term_string',
                  },
                },
              ],
            }),
          }}
        />
        {children}
      </body>
    </html>
  );
}
