import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanSeeRentRoll } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { buildCamPackets, type CamData, type CamTenant } from '@/lib/cam-doc';

// Annual expense reconciliation for a property: one row per listing per year,
// holding the year's expenses, next year's projection, the leasable-SF figures the
// allocation divides by, and the per-tenant paid/base-rent numbers.
//
//   GET  ?listing_id=&year=       → the saved figures, plus the rent roll to bill against
//   PUT                           → save the figures
//   POST ?…&suite=                → generate the packet PDF (one suite, or all)

const BUCKET = 'transaction-forms';

async function guard(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return { err: unauthorized() };
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return { err: NextResponse.json({ error: 'listing_id required' }, { status: 400 }) };
  // The packets bill straight off the rent roll, so they answer to the same gate.
  if (!(await assertCanSeeRentRoll(listingId, ctx))) return { err: notFound('Property not found') };
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getFullYear() - 1;
  return { ctx, listingId, year };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.err) return g.err;
  const { ctx, listingId, year } = g;
  const db = adminClient();

  const [{ data: row }, { data: roll }] = await Promise.all([
    db.from('crm_cam_reconciliations').select('*').eq('listing_id', listingId).eq('year', year).maybeSingle(),
    db.from('crm_property_tenants')
      .select('suite, tenant_name, building, size_sf, monthly_rent, contact_name, email, mail_only')
      .eq('listing_id', listingId).order('suite'),
  ]);

  // The rent roll is the tenant list; the saved row only carries the numbers that
  // can't be derived from it (what each tenant actually paid, next year's base rent).
  // Mail-only tenants rent no space: they are neither billed nor counted.
  const tenants = (roll ?? []).filter(t => !t.mail_only).map(t => ({
    suite: String(t.suite ?? ''), name: t.tenant_name ?? '', building: t.building ?? '',
    sf: t.size_sf == null ? null : Number(t.size_sf),
    monthly_rent: t.monthly_rent == null ? null : Number(t.monthly_rent),
    contactName: t.contact_name ?? null, email: t.email ?? null,
  })).filter(t => t.suite && t.name && !/^vacant$/i.test(t.name));

  // Surfaced rather than silently worked around: every allocation divides by leasable
  // SF, so a suite with none makes the property total — and every tenant's share of
  // it — wrong.
  const missingSf = tenants.filter(t => !t.sf).map(t => `${t.suite} (${t.name})`);
  const rollSf = tenants.reduce((s, t) => s + (t.sf ?? 0), 0);

  return NextResponse.json({
    year, data: (row?.data ?? {}) as CamData, saved_at: row?.updated_at ?? null,
    tenants, rollSf, missingSf,
    can_edit: isAdminRole(ctx.role),
  });
}

export async function PUT(req: NextRequest) {
  const g = await guard(req);
  if (g.err) return g.err;
  const { ctx, listingId, year } = g;
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Only an admin can edit the reconciliation.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.data || typeof body.data !== 'object') return NextResponse.json({ error: 'data required' }, { status: 400 });

  const db = adminClient();
  const { error } = await db.from('crm_cam_reconciliations').upsert({
    listing_id: listingId, year, business_unit: ctx.businessUnit ?? 'commercial',
    data: body.data, created_by: ctx.userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'listing_id,year' });
  if (error) { console.error('[cam-reconciliation] PUT', error); return NextResponse.json({ error: 'Could not save' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.err) return g.err;
  const { ctx, listingId, year } = g;
  const suite = req.nextUrl.searchParams.get('suite');
  const db = adminClient();

  const { data: row } = await db.from('crm_cam_reconciliations').select('data').eq('listing_id', listingId).eq('year', year).maybeSingle();
  const data = (row?.data ?? {}) as CamData;
  if (!data.propertySf) return NextResponse.json({ error: 'Set the property’s total leasable square footage first — every allocation divides by it.' }, { status: 400 });

  const { data: roll } = await db.from('crm_property_tenants')
    .select('suite, tenant_name, building, size_sf, contact_name, mail_only')
    .eq('listing_id', listingId).order('suite');

  const saved = data.tenants ?? {};
  const tenants: CamTenant[] = (roll ?? [])
    .filter(t => t.suite && t.tenant_name && !/^vacant$/i.test(t.tenant_name) && !t.mail_only)
    .filter(t => !suite || String(t.suite) === suite)
    // A tenant with no square footage cannot be allocated to, and billing them a
    // guess is worse than leaving them out of the run.
    .filter(t => t.size_sf != null && Number(t.size_sf) > 0)
    .map(t => {
      const s = saved[String(t.suite)] ?? {} as CamTenant;
      return {
        suite: String(t.suite), name: t.tenant_name as string, building: t.building ?? '',
        sf: Number(t.size_sf), contactName: s.contactName ?? t.contact_name ?? undefined,
        paid: s.paid, paidNote: s.paidNote, baseRentNext: s.baseRentNext, baseRentJan: s.baseRentJan,
      };
    });
  if (!tenants.length) return NextResponse.json({ error: 'No tenants with square footage to bill.' }, { status: 400 });

  const pdf = await buildCamPackets(data, tenants);
  const name = suite ? `${year}-reconciliation-suite-${suite}.pdf` : `${year}-reconciliation-all-tenants.pdf`;
  const path = `cam/${listingId}/${Date.now()}_${name}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
  if (upErr) { console.error('[cam-reconciliation] upload', upErr); return NextResponse.json({ error: 'Could not save the packet' }, { status: 500 }); }
  const { data: sg } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  void ctx;
  return NextResponse.json({ url: sg?.signedUrl ?? null, name, count: tenants.length });
}
