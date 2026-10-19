import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Local vendor / business directory for fairoaksranchplaza.com (plaza_vendors). The public site reads
// published rows via RLS; everything here is admin-only through the service role. `local_owned` drives the
// "Locally owned & operated" badge, so it should only be ticked for businesses an owner has confirmed.

const FIELDS = 'id, name, category, description, phone, website, address, note, featured, published, local_owned, sort_order';
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function clean(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'name' in b) { const n = str(b.name, 160); if (!n) return { error: 'Name is required' }; out.name = n; }
  if (!partial || 'category' in b) out.category = str(b.category, 80) || 'Other';
  if (!partial || 'description' in b) out.description = str(b.description, 1500);
  if (!partial || 'phone' in b) out.phone = str(b.phone, 40) || null;
  if (!partial || 'address' in b) out.address = str(b.address, 200) || null;
  if (!partial || 'note' in b) out.note = str(b.note, 300) || null;
  if (!partial || 'website' in b) {
    const w = str(b.website, 300);
    if (w && !/^https?:\/\//i.test(w)) return { error: 'Website must start with http:// or https://' };
    out.website = w || null;
  }
  for (const k of ['featured', 'published', 'local_owned'] as const) if (!partial || k in b) out[k] = b[k] === true;
  if ('sort_order' in b) out.sort_order = Number.isFinite(Number(b.sort_order)) ? Math.round(Number(b.sort_order)) : 0;
  return { out };
}

export async function GET(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const { data, error } = await adminClient().from('plaza_vendors').select(FIELDS).order('category').order('sort_order').order('name').limit(500);
  if (error) { console.error('[plaza-vendors] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ vendors: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const { out, error } = clean(b, false);
  if (error || !out) return NextResponse.json({ error }, { status: 400 });
  const { data, error: dbErr } = await adminClient().from('plaza_vendors').insert(out).select(FIELDS).single();
  if (dbErr) { console.error('[plaza-vendors] POST', dbErr); return NextResponse.json({ error: 'Could not save' }, { status: 500 }); }
  return NextResponse.json({ vendor: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const { out, error } = clean(b, true);
  if (error || !out) return NextResponse.json({ error }, { status: 400 });
  const { data, error: dbErr } = await adminClient().from('plaza_vendors').update(out).eq('id', id).select(FIELDS).single();
  if (dbErr) { console.error('[plaza-vendors] PATCH', dbErr); return NextResponse.json({ error: 'Could not update' }, { status: 500 }); }
  return NextResponse.json({ vendor: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await adminClient().from('plaza_vendors').delete().eq('id', id);
  if (error) { console.error('[plaza-vendors] DELETE', error); return NextResponse.json({ error: 'Could not delete' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
