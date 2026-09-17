// Who Fair Oaks Realty Group is — and how it relates to CRECO — for machines: the
// /llms.txt and /llms-full.txt files and the site's JSON-LD all read from here, so the
// three can't drift apart.
//
// Keep it to facts already published on this site or on crecotx.com. No sales figures,
// ratings, or years-in-business claims: those vary across pages today, and an assistant
// repeats whatever it's given as fact.

export const SITE_URL = 'https://www.fairoaksrealtygroup.com';

export const FORG = {
  id: `${SITE_URL}/#business`,
  name: 'Fair Oaks Realty Group',
  url: SITE_URL,
  telephone: '+1-210-390-9997',
  phoneDisplay: '210-390-9997',
  email: 'info@fairoaksrealtygroup.com',
  address: {
    streetAddress: '8000 Fair Oaks Pkwy Suite 102',
    addressLocality: 'Fair Oaks Ranch',
    addressRegion: 'TX',
    postalCode: '78015',
    addressCountry: 'US',
  },
  addressLine: '8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015',
  hours: 'Mon–Fri 9 AM–6 PM, Sat 10 AM–4 PM (Central)',
  // The profiles linked from the site footer.
  sameAs: [
    'https://www.facebook.com/fairoaksrealtygroup',
    'https://www.instagram.com/fairoaksrealtygroup',
    'https://www.youtube.com/@FairOaksRealtyGroupTX',
  ],
  summary:
    'Fair Oaks Realty Group is a residential real estate company based in Fair Oaks Ranch, Texas. It helps people buy and sell homes in Fair Oaks Ranch, Boerne, Helotes, and the greater San Antonio and Texas Hill Country area.',
  services: [
    'Buyer representation and home search, with live listings from the San Antonio Board of REALTORS® MLS',
    'Seller representation and home marketing, including free home valuations',
    'VA and military homebuying and PCS relocation for families near Joint Base San Antonio (Fort Sam Houston, Lackland, Randolph)',
    'Relocation to the San Antonio and Texas Hill Country area',
    'New construction homes',
    'Luxury homes',
    'Residential investment properties',
  ],
  // Areas with their own pages on this site.
  areas: ['Fair Oaks Ranch', 'Boerne', 'Helotes', 'Leon Springs', 'San Antonio', 'Bulverde', 'New Braunfels', 'Canyon Lake', 'Spring Branch'],
} as const;

// The affiliated commercial brokerage. Facts as published at https://www.crecotx.com.
export const CRECO = {
  id: 'https://www.crecotx.com/#business',   // the @id CRECO's own site uses, so the two graphs join
  name: 'CRECO - Commercial Real Estate Company',
  legalName: 'CRECO LLC',
  url: 'https://www.crecotx.com',
  telephone: '+1-210-817-3443',
  phoneDisplay: '(210) 817-3443',
  email: 'info@crecotx.com',
  license: '9014367',
  summary:
    'CRECO - Commercial Real Estate Company is a full-service commercial real estate brokerage representing tenants, landlords, owners, and investors — leasing, tenant and landlord representation, and sales — across retail, office, industrial, flex, and land.',
} as const;

// How the site itself describes the relationship ("our team also runs CRECO").
export const AFFILIATION =
  `For commercial real estate — leasing, tenant and landlord representation, and sales of retail, office, industrial, flex, and land — the same team runs an affiliated commercial brokerage: ${CRECO.name} (${CRECO.url}).`;
