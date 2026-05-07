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
