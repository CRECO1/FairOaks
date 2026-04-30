import { NextRequest, NextResponse } from 'next/server';
import { getListings } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? 'active';

  try {
    const listings = await getListings(status);
    return NextResponse.json({ listings });
  } catch {
    return NextResponse.json({ listings: [] });
  }
}
