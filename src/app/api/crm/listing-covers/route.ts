import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { LISTING_FILES_BUCKET as BUCKET, listingAccessible } from '@/lib/listing-files-access';

/**
 * GET /api/crm/listing-covers?ids=<id>,<id>…  ->  { covers: { <listingId>: <signed photo url> } }
 *
 * The cover is the listing's FIRST photo in gallery order (the same photo the flyer uses as its cover).
 * One round trip for a whole page of cards: one query for the listings, one for their photos and one batch
 * call to sign the URLs. Access follows the listing rule (admins; else same workspace, and a Restricted
 * folder only for its owner / assigned agents) — a listing you can't open simply has no cover in the answer.
 */
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const ids = [...new Set((req.nextUrl.searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(s => UUID.test(s)))].slice(0, 150);
  if (!ids.length) return NextResponse.json({ covers: {} });

  const db = adminClient();
  const { data: ls, error: e1 } = await db.from('crm_listings')
    .select('id, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').in('id', ids);
  if (e1) return dbError('api/crm/listing-covers listings', e1);
  const allowed = (ls ?? []).filter(r => listingAccessible(r as Record<string, unknown>, ctx)).map(r => r.id as string);
  if (!allowed.length) return NextResponse.json({ covers: {} });

  const { data: files, error: e2 } = await db.from('crm_listing_files')
    .select('listing_id, storage_path')
    .in('listing_id', allowed).eq('category', 'photo')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (e2) return dbError('api/crm/listing-covers files', e2);

  const first = new Map<string, string>();
  for (const f of files ?? []) if (!first.has(f.listing_id as string)) first.set(f.listing_id as string, f.storage_path as string);
  const paths = [...new Set(first.values())];
  if (!paths.length) return NextResponse.json({ covers: {} });

  const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const urlByPath = new Map((signed ?? []).filter(s => s.signedUrl).map(s => [s.path as string, s.signedUrl as string]));
  const covers: Record<string, string> = {};
  for (const [lid, path] of first) { const u = urlByPath.get(path); if (u) covers[lid] = u; }
  return NextResponse.json({ covers });
}
