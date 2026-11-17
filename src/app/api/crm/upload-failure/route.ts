import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { writeAuditLog } from '@/lib/audit';
import { userRateLimit } from '@/lib/user-ratelimit';
import { adminClient } from '@/lib/supabase-admin';

// Every upload that fails in the browser (wrong type, too big, HEIC it couldn't convert, storage/network error, save error)
// reports here → audit_logs action `upload_failed`, so a failing upload is seen before someone has to call.
// POST: any signed-in user, 60/hour each, fields capped. GET: admins only, last 14 days, newest first.
const cap = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const STAGES = new Set(['precheck', 'convert', 'start', 'send', 'save']);

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!(await userRateLimit('upload-failure', ctx.userId, 60, '1 h')).success) return NextResponse.json({ ok: true });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  await writeAuditLog({
    actorId: ctx.userId,
    action: 'upload_failed',
    targetType: cap(b.target, 40) || 'unknown',
    metadata: {
      name: cap(b.name, 200), size: Number(b.size) || 0, stage: STAGES.has(String(b.stage)) ? b.stage : 'send',
      message: cap(b.message, 400), ua: cap(b.ua, 250), online: b.online !== false, role: ctx.role, business_unit: ctx.businessUnit,
    },
    req,
  });
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  let q = db.from('audit_logs').select('id, actor_id, target_type, metadata, created_at').eq('action', 'upload_failed').gte('created_at', since).order('created_at', { ascending: false }).limit(300);
  const { data: rows, error } = await q;
  if (error) { console.error('[upload-failure] list', error); return NextResponse.json({ error: 'Could not load' }, { status: 500 }); }
  const mine = (rows ?? []).filter(r => !ctx.businessUnit || !(r.metadata as { business_unit?: string })?.business_unit || (r.metadata as { business_unit?: string }).business_unit === ctx.businessUnit);
  const ids = [...new Set(mine.map(r => r.actor_id).filter(Boolean))] as string[];
  const { data: profs } = ids.length ? await db.from('crm_profiles').select('id, first_name, last_name').in('id', ids) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const nameOf = new Map((profs ?? []).map(p => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
  return NextResponse.json({
    failures: mine.map(r => ({ id: r.id, at: r.created_at, who: nameOf.get(r.actor_id as string) ?? 'Unknown', target: r.target_type, ...(r.metadata as object) })),
  });
}
