import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const city      = searchParams.get('city') ?? '';
  const minPrice  = searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : null;
  const maxPrice  = searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : null;
  const minBeds   = searchParams.get('minBeds')  ? Number(searchParams.get('minBeds'))  : null;
  const search    = searchParams.get('search')   ?? '';
  const page      = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const limit     = Math.min(48, Math.max(1, Number(searchParams.get('limit') ?? '24')));
  const offset    = (page - 1) * limit;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let query = supabase
    .from('listings')
    .select('*', { count: 'exact' })
    .in('status', ['active', 'pending']);

  if (city && city !== 'All Areas') {
    query = query.ilike('city', city);
  }
  if (minPrice !== null) {
    query = query.gte('price', minPrice);
  }
  if (maxPrice !== null) {
    query = query.lte('price', maxPrice);
  }
  if (minBeds !== null && minBeds > 0) {
    query = query.gte('bedrooms', minBeds);
  }
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,address.ilike.%${search}%,city.ilike.%${search}%,mls_number.ilike.%${search}%`,
    );
  }

  query = query
    .order('listing_date', { ascending: false })
    .range(offset, offset + limit - 1);

  try {
    const { data, count, error } = await query;

    if (error) {
      console.error('[listings API] Supabase error:', error);
      return NextResponse.json({ listings: [], total: 0, page, totalPages: 0 }, { status: 500 });
    }

    const total      = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({ listings: data ?? [], total, page, totalPages });
  } catch (err: any) {
    console.error('[listings API] error:', err);
    return NextResponse.json({ listings: [], total: 0, page, totalPages: 0 }, { status: 500 });
  }
}
