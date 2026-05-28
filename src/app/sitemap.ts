import { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';
import { searchPropertiesAll, ACTIVE_FILTER } from '@/lib/sabor-reso';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/listings`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${BASE_URL}/sell`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      url: `${BASE_URL}/neighborhoods`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    {
      url: `${BASE_URL}/neighborhoods/fair-oaks-ranch`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/neighborhoods/boerne`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/neighborhoods/helotes`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${BASE_URL}/neighborhoods/leon-springs`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${BASE_URL}/sold`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${BASE_URL}/team`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/market-reports`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.75,
    },
    {
      url: `${BASE_URL}/quiz`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.65,
    },
    {
      url: `${BASE_URL}/services`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    // Blog
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/blog/veramendi-new-braunfels`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.65 },
    { url: `${BASE_URL}/blog/headwaters-barton-creek`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.65 },
    { url: `${BASE_URL}/blog/miralomas-helotes`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.65 },
    { url: `${BASE_URL}/blog/boerne-market-report-spring-2025`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.65 },
    { url: `${BASE_URL}/blog/fair-oaks-ranch-best-value`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.65 },
    { url: `${BASE_URL}/blog/questions-before-buying-master-planned`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.65 },
    // Careers & join
    { url: `${BASE_URL}/careers`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/join`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.65 },
    // City landing pages
    { url: `${BASE_URL}/homes-for-sale`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/homes-for-sale/boerne-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/homes-for-sale/helotes-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/homes-for-sale/san-antonio-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/homes-for-sale/fair-oaks-ranch-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/homes-for-sale/bulverde-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/homes-for-sale/new-braunfels-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/homes-for-sale/canyon-lake-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.75 },
    { url: `${BASE_URL}/homes-for-sale/spring-branch-tx`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.75 },
    // Price range landing pages
    { url: `${BASE_URL}/homes-for-sale/under-500k`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/homes-for-sale/500k-750k`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/homes-for-sale/750k-1m`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/homes-for-sale/over-1m`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    // Specialty landing pages
    { url: `${BASE_URL}/luxury-homes`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/new-construction`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/new-construction/fair-oaks-ranch`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.75 },
    { url: `${BASE_URL}/new-construction/boerne`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.75 },
    { url: `${BASE_URL}/new-construction/helotes`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.75 },
    { url: `${BASE_URL}/new-construction/san-antonio`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.75 },
    { url: `${BASE_URL}/new-construction/bulverde`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/new-construction/new-braunfels`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/new-construction/canyon-lake`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/military-homebuying`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    // School district pages
    { url: `${BASE_URL}/schools`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/schools/boerne-isd`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
    { url: `${BASE_URL}/schools/northside-isd`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
    { url: `${BASE_URL}/schools/comal-isd`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
    // Subdivision pages
    { url: `${BASE_URL}/neighborhoods/the-dominion`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/neighborhoods/cordillera-ranch`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/neighborhoods/fair-oaks-ranch`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
    { url: `${BASE_URL}/neighborhoods/stone-creek-ranch`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.75 },
    { url: `${BASE_URL}/neighborhoods/the-preserve-fair-oaks`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.75 },
    { url: `${BASE_URL}/neighborhoods/sonoma-verde`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.75 },
    { url: `${BASE_URL}/neighborhoods/herff-ranch`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.75 },
    { url: `${BASE_URL}/neighborhoods/johnson-ranch`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.75 },
    // Guides & resources
    { url: `${BASE_URL}/relocation`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/investment-properties`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
    // Content / guides
    { url: `${BASE_URL}/faq`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
    { url: `${BASE_URL}/buyer-guide`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
    { url: `${BASE_URL}/seller-guide`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
  ];

  // Dynamic listing pages — pulled live from SABOR MLS
  let listingPages: MetadataRoute.Sitemap = [];
  try {
    const properties = await searchPropertiesAll(
      { filter: ACTIVE_FILTER, top: 200, select: 'ListingId,StreetNumber,StreetName,ModificationTimestamp' },
      3 // up to 3 pages × 200 = 600, effectively 500+
    );
    const limited = properties.slice(0, 500);
    listingPages = limited.map((p) => {
      const addressStr = [p.StreetNumber, p.StreetName].filter(Boolean).join(' ') || p.ListingId;
      const titleSlug = addressStr
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const slug = `${titleSlug}-${p.ListingId}`;
      return {
        url: `${BASE_URL}/listings/${slug}`,
        lastModified: p.ModificationTimestamp ? new Date(p.ModificationTimestamp) : new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      };
    });
  } catch {
    // SABOR API not available, skip dynamic listing pages
  }

  // Dynamic neighborhood pages
  let neighborhoodPages: MetadataRoute.Sitemap = [];
  try {
    const { data } = await supabase
      .from('neighborhoods')
      .select('slug, updated_at');

    if (data) {
      neighborhoodPages = data.map((n) => ({
        url: `${BASE_URL}/neighborhoods/${n.slug}`,
        lastModified: new Date(n.updated_at),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      }));
    }
  } catch {
    // Supabase not available, skip dynamic pages
  }

  return [...staticPages, ...listingPages, ...neighborhoodPages];
}
