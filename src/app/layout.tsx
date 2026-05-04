import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.fairoaksrealtygroup.com'),
  title: {
    default: 'Fair Oaks Ranch Homes for Sale | Fair Oaks Realty Group',
    template: '%s | Fair Oaks Realty Group',
  },
  description:
    'Search homes for sale in Fair Oaks Ranch, Boerne & Helotes TX. Top-rated local realtors with 500+ homes sold. Free home valuations. Texas Hill Country real estate experts.',
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
      'Search homes for sale in Fair Oaks Ranch, Boerne & Helotes TX. Top-rated local realtors with 500+ homes sold. Free home valuations. Texas Hill Country real estate experts.',
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
      'Top-rated realtors in Fair Oaks Ranch, TX. Search listings, get a free home valuation, and connect with local experts.',
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
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-K45G8PR6"
            height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} />
        </noscript>
        {/* Google Tag Manager */}
        <Script id="google-tag-manager" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-K45G8PR6');`}
        </Script>
        {/* JSON-LD Structured Data — LocalBusiness + RealEstateAgent */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': ['RealEstateAgent', 'LocalBusiness'],
                  '@id': 'https://www.fairoaksrealtygroup.com/#business',
                  name: 'Fair Oaks Realty Group',
                  url: 'https://www.fairoaksrealtygroup.com',
                  logo: 'https://www.fairoaksrealtygroup.com/images/logo.png',
                  image: 'https://www.fairoaksrealtygroup.com/images/og-home.jpg',
                  description:
                    'Top-rated residential real estate agency serving Fair Oaks Ranch, Boerne, Helotes, and the Texas Hill Country. 500+ homes sold with a 103% list-to-sale price ratio.',
                  telephone: '+1-210-555-0100',
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
                    latitude: 29.7494,
                    longitude: -98.6318,
                  },
                  areaServed: [
                    { '@type': 'City', name: 'Fair Oaks Ranch', sameAs: 'https://en.wikipedia.org/wiki/Fair_Oaks_Ranch,_Texas' },
                    { '@type': 'City', name: 'Boerne', sameAs: 'https://en.wikipedia.org/wiki/Boerne,_Texas' },
                    { '@type': 'City', name: 'Helotes', sameAs: 'https://en.wikipedia.org/wiki/Helotes,_Texas' },
                    { '@type': 'City', name: 'San Antonio' },
                    { '@type': 'State', name: 'Texas' },
                  ],
                  openingHoursSpecification: [
                    {
                      '@type': 'OpeningHoursSpecification',
                      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
                      opens: '09:00',
                      closes: '18:00',
                    },
                    {
                      '@type': 'OpeningHoursSpecification',
                      dayOfWeek: ['Saturday'],
                      opens: '10:00',
                      closes: '16:00',
                    },
                  ],
                  aggregateRating: {
                    '@type': 'AggregateRating',
                    ratingValue: '5.0',
                    reviewCount: '127',
                    bestRating: '5',
                  },
                  sameAs: [
                    'https://www.facebook.com/fairoaksrealtygroup',
                    'https://www.instagram.com/fairoaksrealtygroup',
                  ],
                  priceRange: '$$$',
                },
                {
                  '@type': 'WebSite',
                  '@id': 'https://www.fairoaksrealtygroup.com/#website',
                  url: 'https://www.fairoaksrealtygroup.com',
                  name: 'Fair Oaks Realty Group',
                  description: 'Fair Oaks Ranch TX Homes for Sale – Texas Hill Country Real Estate',
                  publisher: { '@id': 'https://www.fairoaksrealtygroup.com/#business' },
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
        {/* Microsoft Clarity Heatmap */}
        <Script id="microsoft-clarity" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "wjbx7c74ra");
          `}
        </Script>
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-SYPXDGGWQS"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-SYPXDGGWQS');
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
