import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Saved email replies ("templates"): yours, plus the ones teammates in your workspace chose to share.
// GET                      → { snippets: [{ id, name, subject, body_html, shared, mine, by }] }
// POST { name, subject, body_html }          → save (replaces your template of the same name)
// POST { import: [{ name, subject, body }] } → one-time import of templates that only lived in this browser
// PATCH { id, shared }     → share / stop sharing one of yours
// DELETE ?id=              → delete one of yours (an admin may delete any in the workspace)
const MAX_BODY = 60_000;
const unit = (ctx: { businessUnit: string | null }) => (ctx.businessUnit === 'residential' ? 'residential' : 'commercial');
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const { data, error } = await db.from('crm_email_snippets')
    .select('id, user_id, name, subject, body_html, shared, updated_at, owner:crm_profiles!user_id(first_name)')
    .or(`user_id.eq.${ctx.userId},and(shared.eq.true,business_unit.eq.${unit(ctx)})`)
    .order('name', { ascending: true });
  if (error) return dbError('api/crm/email-snippets GET', error);
  const snippets = (data ?? []).map((r: any) => ({
    id: r.id as string, name: r.name as string, subject: r.subject as string, body_html: r.body_html as string,
    shared: !!r.shared, mine: r.user_id === ctx.userId, by: r.user_id === ctx.userId ? '' : (r.owner?.first_name ?? 'A teammate'),
  }));
  return NextResponse.json({ snippets });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => null) as { name?: string; subject?: string; body_html?: string; shared?: boolean; import?: Array<{ name?: string; subject?: string; body?: string }> } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const db = adminClient();
  const rows = (Array.isArray(body.import) ? body.import.slice(0, 50).map(t => ({ name: clean(t.name, 80), subject: clean(t.subject, 200), body_html: clean(t.body, MAX_BODY), shared: false }))
    : [{ name: clean(body.name, 80), subject: clean(body.subject, 200), body_html: clean(body.body_html, MAX_BODY), shared: !!body.shared }]).filter(r => r.name && r.body_html);
  if (!rows.length) return NextResponse.json({ error: 'A template needs a name and some text.' }, { status: 400 });
  const out: unknown[] = [];
  for (const r of rows) {
    // Same name = replace yours (what "save as template" has always done).
    const { data: existing } = await db.from('crm_email_snippets').select('id').eq('user_id', ctx.userId).eq('name', r.name).maybeSingle();
    const fields = { ...r, business_unit: unit(ctx), updated_at: new Date().toISOString() };
    const q = existing?.id
      ? db.from('crm_email_snippets').update(fields).eq('id', existing.id).eq('user_id', ctx.userId)
      : db.from('crm_email_snippets').insert({ ...fields, user_id: ctx.userId });
    const { data, error } = await q.select('id, name, subject, body_html, shared').single();
    if (error) return dbError('api/crm/email-snippets POST', error);
    out.push({ ...data, mine: true, by: '' });
  }
  return NextResponse.json({ snippets: out });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({})) as { id?: string; shared?: boolean };
  if (!b.id || typeof b.shared !== 'boolean') return NextResponse.json({ error: 'id and shared required' }, { status: 400 });
  const { error } = await adminClient().from('crm_email_snippets').update({ shared: b.shared, updated_at: new Date().toISOString() }).eq('id', b.id).eq('user_id', ctx.userId);
  if (error) return dbError('api/crm/email-snippets PATCH', error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  let q = adminClient().from('crm_email_snippets').delete().eq('id', id);
  q = isAdminRole(ctx.role) ? q.eq('business_unit', unit(ctx)) : q.eq('user_id', ctx.userId);
  const { error } = await q;
  if (error) return dbError('api/crm/email-snippets DELETE', error);
  return NextResponse.json({ ok: true });
}
