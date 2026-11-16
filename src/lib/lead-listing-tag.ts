import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchListing, type ListingLite } from '@/lib/direct-inquiry';
import { listingTagToken, parseListingTagIds } from '@/lib/listing-tags';

/**
 * A new lead that names one of our properties gets the tag from day one: the note gains a "🏠 #1222Chulie" line and the contact is stored
 * with that listing, so the inquiry counts on the property immediately (no review backlog). `hints` are the fields that say which property
 * ("Property: …", "Property interest: …"); with none, the message text itself is searched. Best effort and silent: any failure (or no match)
 * returns the note untouched. Restricted listings are never tagged by an automatic import.
 */
export async function tagLeadNotes(db: SupabaseClient, unit: string, notes: string, hints: (string | null | undefined)[] = []): Promise<{ notes: string; tagged_listing_ids: string[] }> {
  const plain = { notes, tagged_listing_ids: [] as string[] };
  try {
    if (!notes || !/\d/.test(notes + hints.join(' '))) return plain;
    const { data } = await db.from('crm_listings').select('id, name, address, is_restricted').eq('business_unit', unit);
    const listings = (data ?? []).filter(l => !l.is_restricted) as (ListingLite & { is_restricted?: boolean })[];
    if (!listings.length) return plain;
    const hint = hints.filter(Boolean).join('\n');
    const hit = (hint && matchListing(hint, listings)) || matchListing(notes, listings);
    if (!hit) return plain;
    const token = `#${listingTagToken(hit)}`;
    if (!token || token === '#') return plain;
    const text = notes.toLowerCase().includes(token.toLowerCase()) ? notes : `${notes}\n🏠 ${token}`;
    const ids = parseListingTagIds(text, listings);
    return ids.length ? { notes: text, tagged_listing_ids: ids } : plain;
  } catch (e) {
    console.error('[lead-listing-tag] skipped:', e);
    return plain;
  }
}
