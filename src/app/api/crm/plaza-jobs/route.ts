import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// "Hire Local" job board for fairoaksranchplaza.com (plaza_jobs). The public site reads published rows via RLS;
// everything here is admin-only through the service role.

const FIELDS = 'id, company, title, summary, location, employment_type, apply_url, apply_email, company_url, featured, published, sort_order, posted_at, source, expires_at, submitter_name, submitter_email, submitter_phone';
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const urlOk = (u: string) => !u || /^https?:\/\//i.test(u);

function clean(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'company' in b) { const c = str(b.company, 160); if (!c) return { error: 'Company is required' }; out.company = c; }
  if (!partial || 'title' in b) { const t = str(b.title, 160); if (!t) return { error: 'Job title is required' }; out.title = t; }
  if (!partial || 'summary' in b) out.summary = str(b.summary, 1500);
  if (!partial || 'location' in b) out.location = str(b.location, 200) || null;
  if (!partial || 'employment_type' in b) out.employment_type = str(b.employment_type, 60) || null;
  if (!partial || 'apply_email' in b) out.apply_email = str(b.apply_email, 160) || null;
  for (const k of ['apply_url', 'company_url'] as const) if (!partial || k in b) {
    const v = str(b[k], 300); if (!urlOk(v)) return { error: 'Links must start with http:// or https://' }; out[k] = v || null;
  }
  for (const k of ['featured', 'published'] as const) if (!partial || k in b) out[k] = b[k] === true;
  return { out };
}

export async function GET(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const { data, error } = await adminClient().from('plaza_jobs').select(FIELDS).order('sort_order').order('posted_at', { ascending: false }).limit(300);
  if (error) { console.error('[plaza-jobs] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ jobs: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const { out, error } = clean(b, false);
  if (error || !out) return NextResponse.json({ error }, { status: 400 });
  const { data, error: dbErr } = await adminClient().from('plaza_jobs').insert({ ...out, posted_at: new Date().toISOString() }).select(FIELDS).single();
  if (dbErr) { console.error('[plaza-jobs] POST', dbErr); return NextResponse.json({ error: 'Could not save' }, { status: 500 }); }
  return NextResponse.json({ job: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const { out, error } = clean(b, true);
  if (error || !out) return NextResponse.json({ error }, { status: 400 });
  if (out.published === true) {
    out.posted_at = new Date().toISOString();   // re-publishing refreshes the posted date
    // Community postings stay up for 60 days from approval, then drop off the board by themselves.
    const cur = await adminClient().from('plaza_jobs').select('source, expires_at').eq('id', id).single();
    if (cur.data?.source === 'community') out.expires_at = new Date(Date.now() + 60 * 86400_000).toISOString();
  }
  const { data, error: dbErr } = await adminClient().from('plaza_jobs').update(out).eq('id', id).select(FIELDS).single();
  if (dbErr) { console.error('[plaza-jobs] PATCH', dbErr); return NextResponse.json({ error: 'Could not update' }, { status: 500 }); }
  return NextResponse.json({ job: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await adminClient().from('plaza_jobs').delete().eq('id', id);
  if (error) { console.error('[plaza-jobs] DELETE', error); return NextResponse.json({ error: 'Could not delete' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
