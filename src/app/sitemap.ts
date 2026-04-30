import { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

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
      url: `${BASE_URL}/neighborhoods/the-dominion`,
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
  ];

  // Dynamic listing pages
  let listingPages: MetadataRoute.Sitemap = [];
  try {
    const { data } = await supabase
      .from('listings')
      .select('slug, updated_at')
      .in('status', ['active', 'pending']);

    if (data) {
      listingPages = data.map((listing) => ({
        url: `${BASE_URL}/listings/${listing.slug}`,
        lastModified: new Date(listing.updated_at),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      }));
    }
  } catch {
    // Supabase not available, skip dynamic pages
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
