import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let supabase: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  console.warn('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set - using placeholder for build');
  supabase = createClient('https://placeholder.supabase.co', 'placeholder-key');
}

export { supabase };

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface Listing {
  id: string;
  title: string;
  slug: string;
  price: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  lot_size: string | null;
  year_built: number | null;
  property_type: string;
  status: string;
  description: string | null;
  features: string[] | null;
  images: string[] | null;
  virtual_tour_url: string | null;
  mls_number: string | null;
  listing_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  slug: string;
  title: string;
  email: string;
  phone: string | null;
  bio: string | null;
  image_url: string | null;
  license_number: string | null;
  specialties: string[] | null;
  years_experience: number | null;
  featured: boolean;
  order: number;
  created_at: string;
  updated_at: string;
}

export interface Neighborhood {
  id: string;
  name: string;
  slug: string;
  city: string;
  description: string | null;
  image_url: string | null;
  avg_price: number | null;
  avg_sqft: number | null;
  highlights: string[] | null;
  school_district: string | null;
  featured: boolean;
  created_at: string;
  updated_at: string;
}

export interface Testimonial {
  id: string;
  client_name: string;
  client_location: string | null;
  quote: string;
  rating: number;
  image_url: string | null;
  featured: boolean;
  created_at: string;
}

export interface SoldProperty {
  id: string;
  address: string;
  city: string;
  sale_price: number;
  sale_date: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  image_url: string | null;
  days_on_market: number | null;
  created_at: string;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

export async function getListings(status = 'active'): Promise<Listing[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .in('status', ['active', 'pending'])   // show both active and pending on the listings page
    .order('listing_date', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getListingBySlug(slug: string): Promise<Listing | null> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error) return null;
  return data;
}

export async function getAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .order('order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getFeaturedAgent(): Promise<Agent | null> {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('featured', true)
    .order('order', { ascending: true })
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

export async function getNeighborhoods(): Promise<Neighborhood[]> {
  const { data, error } = await supabase
    .from('neighborhoods')
    .select('*')
    .order('order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getNeighborhoodBySlug(slug: string): Promise<Neighborhood | null> {
  const { data, error } = await supabase
    .from('neighborhoods')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error) return null;
  return data;
}

export async function getListingsByCity(city: string): Promise<Listing[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .ilike('city', city)
    .eq('status', 'active')
    .order('listing_date', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getListingCountsByCity(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('listings')
    .select('city')
    .eq('status', 'active');

  if (error) throw error;

  return (data ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.city] = (acc[row.city] ?? 0) + 1;
    return acc;
  }, {});
}

export async function getTestimonials(featuredOnly = false): Promise<Testimonial[]> {
  let query = supabase.from('testimonials').select('*');
  if (featuredOnly) query = query.eq('featured', true);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getSoldProperties(limit = 12): Promise<SoldProperty[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('id, address, city, price, sold_date, bedrooms, bathrooms, sqft, images, days_on_market, created_at')
    .eq('status', 'sold')
    .order('sold_date', { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Normalize field names to match what the sold page expects
  return (data ?? []).map((p: any) => ({
    ...p,
    sale_price: p.price,
    sale_date: p.sold_date,
    image_url: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null,
  })) as unknown as SoldProperty[];
}

export async function submitLead(lead: {
  name: string;
  email: string;
  phone?: string;
  message?: string;
  property_interest?: string;
  source?: string;
}) {
  const { data, error } = await supabase
    .from('leads')
    .insert([{
      name: lead.name,
      email: lead.email,
      phone: lead.phone ?? null,
      message: lead.message ?? null,
      property_interest: lead.property_interest ?? null,
      source: lead.source ?? 'contact',
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}
