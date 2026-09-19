// Who Fair Oaks Realty Group is — and how it relates to CRECO — for machines: the
// /llms.txt and /llms-full.txt files and the site's JSON-LD all read from here, so the
// three can't drift apart.
//
// Keep it to facts already published on this site, confirmed by the brokerage, or
// evidenced in a document we hold. No sales figures, ratings, or years-in-business
// claims: an assistant repeats whatever it's given as fact.

export const SITE_URL = 'https://www.fairoaksrealtygroup.com';

/**
 * Stable node ids. Every page that references the business links to ORG_ID rather
 * than restating name/address/phone, so the graph has one authoritative node.
 */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const BROKER_ID = `${SITE_URL}/team#zachary-stovall`;
export const AGENT_ID = `${SITE_URL}/team#brian-blanco`;

/**
 * The licensed people, with the individual TREC numbers taken from the brokerage's
 * IABS forms (transaction-forms/agents/iabs-<crm_profiles id>.pdf, corroborated for
 * Zachary by two further IABS copies). These are individual licences — distinct from
 * the firm licence below.
 */
export const PEOPLE = [
  { id: BROKER_ID, name: 'Zachary Stovall', jobTitle: 'Broker / Owner', trecLicense: '691174' },
  { id: AGENT_ID, name: 'Brian Blanco', jobTitle: 'Director of Leasing', trecLicense: '848449' },
] as const;

export const FORG = {
  id: ORG_ID,
  name: 'Fair Oaks Realty Group',
  // Spellings a person or an assistant might actually type.
  alternateName: [
    'Fair Oaks Realty',
    'Fair Oaks Realty Group TX',
    'Fair Oaks Ranch Realty Group',
  ],
  url: SITE_URL,
  telephone: '+1-210-390-9997',
  phoneDisplay: '210-390-9997',
  email: 'info@fairoaksrealtygroup.com',
  // The firm's TREC licence, as displayed in the site footer. Distinct from the
  // individual licences in PEOPLE above.
  trecLicense: '9014367',
  trecLicenseDisplay: '9014367-BB',
  address: {
    streetAddress: '8000 Fair Oaks Pkwy Suite 102',
    addressLocality: 'Fair Oaks Ranch',
    addressRegion: 'TX',
    postalCode: '78015',
    addressCountry: 'US',
  },
  addressLine: '8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015',
  // The building's OSM house-number geocode ("8000, Fair Oaks Parkway") — the same
  // point crecotx.com uses. The old 29.7494, -98.6318 sat about 2 km away.
  latitude: 29.734008,
  longitude: -98.643139,
  hours: 'Mon–Fri 9 AM–6 PM, Sat 10 AM–4 PM (Central)',
  /**
   * Only profiles the brokerage has confirmed. An entry here asserts to search
   * engines that this IS the same entity, so a wrong handle points them at a
   * stranger — the previously published Instagram handle was wrong
   * (fairoaksrealtygroup, versus the real fairoaksrealty_group).
   *
   * TODO: add the Fair Oaks Google Business Profile Maps URL once the brokerage
   * confirms which account manages that profile.
   * YouTube confirmed 2026-09-19: the channel's own description carries this
   * site's URL, (210) 390-9997 and info@fairoaksrealtygroup.com, and the footer
   * links it — a two-way match.
   * TODO: the footer Facebook link is unverified — confirm or retire it before
   * asserting it here.
   */
  sameAs: [
    'https://www.instagram.com/fairoaksrealty_group',
    'https://www.youtube.com/@FairOaksRealtyGroupTX',
  ],
  /** Residential topics, in the plain nouns someone would actually search. */
  knowsAbout: [
    'Residential real estate',
    'Home buying',
    'Home selling',
    'First-time home buyers',
    'Luxury homes',
    'New construction homes',
    'Relocation',
    'VA loans and military homebuying',
    'PCS relocation',
    'Residential investment properties',
    'Free home valuations',
    'Texas Hill Country real estate',
  ],
  /** Cities with their own pages on this site. */
  areas: ['Fair Oaks Ranch', 'Boerne', 'Helotes', 'Leon Springs', 'San Antonio', 'Bulverde', 'New Braunfels', 'Canyon Lake', 'Spring Branch'],
  counties: ['Bexar County', 'Kendall County', 'Comal County'],
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
} as const;

// The affiliated commercial brokerage. Facts as published at https://www.crecotx.com.
export const CRECO = {
  // crecotx.com publishes its business node as #organization — verified live in its
  // own JSON-LD. This must match exactly or the two graphs never join.
  id: 'https://www.crecotx.com/#organization',
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

/** A TREC credential node, used for both the firm and the individual licences. */
export function trecCredential(licenseNumber: string, name: string, category: string) {
  return {
    '@type': 'EducationalOccupationalCredential',
    name,
    credentialCategory: category,
    identifier: { '@type': 'PropertyValue', propertyID: 'TREC License', value: licenseNumber },
    recognizedBy: {
      '@type': 'GovernmentOrganization',
      name: 'Texas Real Estate Commission',
      alternateName: 'TREC',
      url: 'https://www.trec.texas.gov',
    },
    validIn: { '@type': 'State', name: 'Texas' },
  };
}

/** areaServed for the org node: state, region, counties, then the cities we cover. */
export function areaServed() {
  return [
    { '@type': 'State', name: 'Texas' },
    { '@type': 'AdministrativeArea', name: 'Texas Hill Country' },
    { '@type': 'AdministrativeArea', name: 'Greater San Antonio (San Antonio–New Braunfels metro)' },
    ...FORG.counties.map(name => ({ '@type': 'AdministrativeArea', name: `${name}, Texas` })),
    ...FORG.areas.map(name => ({
      '@type': 'City',
      name,
      containedInPlace: { '@type': 'State', name: 'Texas' },
    })),
  ];
}

/** The two licensed people, as Person nodes carrying their own TREC credential. */
export function peopleNodes() {
  return PEOPLE.map(p => ({
    '@type': 'Person',
    '@id': p.id,
    name: p.name,
    jobTitle: p.jobTitle,
    worksFor: { '@id': ORG_ID },
    url: `${SITE_URL}/team`,
    identifier: { '@type': 'PropertyValue', propertyID: 'TREC License', value: p.trecLicense },
    hasCredential: trecCredential(
      p.trecLicense,
      `Texas Real Estate License ${p.trecLicense}`,
      p.jobTitle.includes('Broker') ? 'Texas Real Estate Broker License' : 'Texas Real Estate Sales Agent License',
    ),
  }));
}
