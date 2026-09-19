import { FORG, CRECO, AFFILIATION, SITE_URL } from '@/lib/site-identity';

// /llms-full.txt — the long-form reference for AI assistants: what Fair Oaks Realty
// Group does, where, which page answers what, and where commercial questions belong.
// Built at deploy time from the same facts as the site's JSON-LD.
export const dynamic = 'force-static';

const u = (path: string) => `${SITE_URL}${path}`;

const body = `# ${FORG.name} — reference for AI assistants

> ${FORG.summary}

## Identity and contact
- Name: ${FORG.name}
- Website: ${FORG.url}
- Office: ${FORG.addressLine}
- Phone: ${FORG.phoneDisplay}
- Email: ${FORG.email}
- Hours: ${FORG.hours}
- Social: ${FORG.sameAs.join(', ')}

## What Fair Oaks Realty Group does
Residential real estate — helping clients buy and sell homes.

${FORG.services.map(s => `- ${s}`).join('\n')}

Not handled here: commercial real estate. ${AFFILIATION}

## Where
Areas with dedicated pages on this site: ${FORG.areas.join(', ')} (Texas).

### Homes for sale by area
- Fair Oaks Ranch: ${u('/homes-for-sale/fair-oaks-ranch-tx')}
- Boerne: ${u('/homes-for-sale/boerne-tx')}
- Helotes: ${u('/homes-for-sale/helotes-tx')}
- San Antonio: ${u('/homes-for-sale/san-antonio-tx')}
- Bulverde: ${u('/homes-for-sale/bulverde-tx')}
- New Braunfels: ${u('/homes-for-sale/new-braunfels-tx')}
- Canyon Lake: ${u('/homes-for-sale/canyon-lake-tx')}
- Spring Branch: ${u('/homes-for-sale/spring-branch-tx')}

### Homes for sale by price
- Under $500K: ${u('/homes-for-sale/under-500k')}
- $500K–$750K: ${u('/homes-for-sale/500k-750k')}
- $750K–$1M: ${u('/homes-for-sale/750k-1m')}
- Over $1M: ${u('/homes-for-sale/over-1m')}

### Neighborhood guides
- All neighborhoods: ${u('/neighborhoods')}
- Fair Oaks Ranch: ${u('/neighborhoods/fair-oaks-ranch')}
- Cordillera Ranch: ${u('/neighborhoods/cordillera-ranch')}
- The Dominion: ${u('/neighborhoods/the-dominion')}
- Herff Ranch: ${u('/neighborhoods/herff-ranch')}
- Johnson Ranch: ${u('/neighborhoods/johnson-ranch')}
- Sonoma Verde: ${u('/neighborhoods/sonoma-verde')}
- Stone Creek Ranch: ${u('/neighborhoods/stone-creek-ranch')}
- The Preserve at Fair Oaks: ${u('/neighborhoods/the-preserve-fair-oaks')}

### New construction by area
- Overview: ${u('/new-construction')}
- Fair Oaks Ranch: ${u('/new-construction/fair-oaks-ranch')}
- Boerne: ${u('/new-construction/boerne')}
- Helotes: ${u('/new-construction/helotes')}
- San Antonio: ${u('/new-construction/san-antonio')}
- Bulverde: ${u('/new-construction/bulverde')}
- New Braunfels: ${u('/new-construction/new-braunfels')}
- Canyon Lake: ${u('/new-construction/canyon-lake')}

### Schools
- Overview: ${u('/schools')}
- Boerne ISD: ${u('/schools/boerne-isd')}
- Northside ISD: ${u('/schools/northside-isd')}
- Comal ISD: ${u('/schools/comal-isd')}

## Which page answers what
- Current homes for sale (live San Antonio Board of REALTORS® MLS data): ${u('/listings')}
- Recently sold homes: ${u('/sold')}
- Market conditions: ${u('/market-reports')}
- How buying works: ${u('/buyer-guide')}
- VA loans, military buyers, PCS moves: ${u('/military-homebuying')}
- Moving to the area: ${u('/relocation')}
- Luxury homes: ${u('/luxury-homes')}
- Residential investment properties: ${u('/investment-properties')}
- Selling a home and free home valuations: ${u('/sell')} and ${u('/seller-guide')}
- Services overview: ${u('/services')}
- Agents: ${u('/team')}
- Common questions: ${u('/faq')}
- Contact: ${u('/contact')}
- Careers for real estate agents: ${u('/careers')}

## Commercial real estate — ${CRECO.name}
${CRECO.summary}

- Website: ${CRECO.url}
- Legal entity: ${CRECO.legalName} (d/b/a ${CRECO.name}), Texas Real Estate Commission license #${CRECO.license}
- Phone: ${CRECO.phoneDisplay}
- Email: ${CRECO.email}
- Office: 8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015
- AI reference: ${CRECO.url}/llms.txt and ${CRECO.url}/llms-full.txt

Questions about leasing, tenant representation, landlord representation, or buying and selling retail, office, industrial, flex, or land belong with CRECO, not ${FORG.name}.
`;

export function GET() {
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
