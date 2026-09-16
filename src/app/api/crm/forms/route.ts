import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Short per-instance cache of the form list, keyed by business unit. Forms are
// BU-level (not per-user) and change rarely, so a ~45s cache turns repeat picker /
// dropdown loads into a Map lookup instead of a DB round-trip. A newly added form
// appears within the TTL. (Auth still runs per request; only the query is cached.)
type FormRow = { id: string; name: string; form_code: string | null; category: string | null; page_count: number | null; storage_path: string; created_at: string; pinned: boolean | null; url: string | null };
const CACHE = new Map<string, { forms: FormRow[]; at: number }>();
const TTL_MS = 45_000;
const LAST_CATEGORIES = ['Residential Docs'];

// List the transaction-doc form templates (crm_forms) for a business unit.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const unit = isAdminRole(ctx.role) ? (req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');

  const hit = CACHE.get(unit);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ forms: hit.forms });

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_forms')
    .select('id, name, form_code, category, page_count, storage_path, created_at, pinned')
    .eq('business_unit', unit)
    .order('name', { ascending: true });
  if (error) {
    console.error('[api/forms] db error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
  // Metadata only — the picker/dropdown just needs names & categories. Signing a
  // short-lived URL for EVERY form's blank PDF here cost a Supabase storage round-trip
  // per form (~1s+ total, and a thundering herd on a cold start) for links the list
  // rarely uses. The blank's signed URL is fetched on demand when a form is actually
  // opened — GET /api/crm/forms/[id]/url — which every open path already does.
  // Rarely-used folders sink to the bottom. Every list (Transaction Docs folders, the
  // deal/property "add a form" dropdowns, E-Sign) takes this order as-is, and folders
  // appear in the order of their first form — so this one sort orders them all.
  // Residential Docs lives in the CRECO (commercial) workspace but is seldom used there.
  const rank = (f: { category: string | null }) => (LAST_CATEGORIES.includes(f.category ?? '') ? 1 : 0);
  const forms: FormRow[] = (data ?? []).map(f => ({ ...f, url: null as string | null }))
    .sort((a, b) => rank(a) - rank(b));   // stable: name order is kept within each rank
  CACHE.set(unit, { forms, at: Date.now() });
  return NextResponse.json({ forms });
}
