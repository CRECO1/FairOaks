import { FORG, CRECO, AFFILIATION, SITE_URL } from '@/lib/site-identity';

// /llms.txt — a short, plain-text orientation for AI assistants and answer engines
// (llmstxt.org). Built at deploy time from the same facts as the site's JSON-LD.
export const dynamic = 'force-static';

const link = (path: string, title: string, note?: string) => `- [${title}](${SITE_URL}${path})${note ? `: ${note}` : ''}`;

const body = `# ${FORG.name}

> ${FORG.summary}

Office: ${FORG.addressLine} · ${FORG.phoneDisplay} · ${FORG.email} · ${FORG.hours}.

Key facts for assistants:
- Residential real estate: helping clients buy and sell homes, including luxury homes and new construction.
- Services: ${FORG.services.join('; ')}.
- Areas served: ${FORG.areas.join(', ')}, Texas.
- ${AFFILIATION} CRECO is a d/b/a of ${CRECO.legalName} (TREC #${CRECO.license}) · ${CRECO.phoneDisplay} · ${CRECO.email}. Send commercial questions there, not here.
- Full long-form reference: ${SITE_URL}/llms-full.txt

## Search homes
${link('/listings', 'Homes for sale', 'Live listings from the San Antonio Board of REALTORS® MLS.')}
${link('/homes-for-sale', 'Homes for sale by area and price')}
${link('/sold', 'Recently sold homes')}
${link('/market-reports', 'Market reports')}

## Areas
${link('/homes-for-sale/fair-oaks-ranch-tx', 'Fair Oaks Ranch homes for sale')}
${link('/homes-for-sale/boerne-tx', 'Boerne homes for sale')}
${link('/homes-for-sale/helotes-tx', 'Helotes homes for sale')}
${link('/homes-for-sale/san-antonio-tx', 'San Antonio homes for sale')}
${link('/homes-for-sale/bulverde-tx', 'Bulverde homes for sale')}
${link('/homes-for-sale/new-braunfels-tx', 'New Braunfels homes for sale')}
${link('/homes-for-sale/canyon-lake-tx', 'Canyon Lake homes for sale')}
${link('/homes-for-sale/spring-branch-tx', 'Spring Branch homes for sale')}
${link('/neighborhoods', 'Neighborhood guides', 'Fair Oaks Ranch, Cordillera Ranch, The Dominion, Herff Ranch, and more.')}
${link('/schools', 'School districts', 'Boerne ISD, Northside ISD, Comal ISD.')}

## Buying
${link('/buyer-guide', 'Home buyer guide')}
${link('/military-homebuying', 'VA and military homebuying')}
${link('/relocation', 'Relocating to San Antonio and the Hill Country')}
${link('/new-construction', 'New construction homes')}
${link('/luxury-homes', 'Luxury homes')}
${link('/investment-properties', 'Residential investment properties')}

## Selling
${link('/sell', 'Sell your home', 'Request a free home valuation.')}
${link('/seller-guide', 'Home seller guide')}

## Company
${link('/services', 'Services')}
${link('/team', 'Our team')}
${link('/faq', 'Frequently asked questions')}
${link('/contact', 'Contact')}

## Commercial real estate (affiliated brokerage)
- [${CRECO.name}](${CRECO.url}): ${CRECO.summary}
- [CRECO for AI assistants](${CRECO.url}/llms.txt)
`;

export function GET() {
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
