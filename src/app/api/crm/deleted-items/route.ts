import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isSuperAdminRole, unauthorized, forbidden, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';

/**
 * Recently deleted deals and contacts — account owner (super_admin) only.
 *
 * Every deal / contact delete is logged by a database trigger (crm_log_delete, see
 * supabase/delete-audit-trail-2026-10.sql) with the whole deleted row in metadata.row. This lists
 * those entries (last 90 days, newest first) and can put one back.
 *
 * WHAT A RESTORE BRINGS BACK: the deal / contact row itself, exactly as it was (same id, owner,
 * stage, notes, tags, privacy). It does NOT bring back what cascaded with a deal — its emails,
 * documents, forms and meetings — the log only keeps their counts. The list shows those counts so
 * the owner knows what is not coming back.
 *
 * A row that already exists again (restored, or re-created) is hidden from the list and cannot be
 * restored twice. A link to a contact / listing that has since been deleted is dropped rather than
 * failing the restore.
 */
const KINDS = { deal_deleted: 'deal', contact_deleted: 'contact' } as const;
const DAYS = 90;

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return forbidden('Only the account owner can see deleted items');

  const db = adminClient();
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const { data, error } = await db.from('audit_logs')
    .select('id, action, target_id, metadata, created_at')
    .in('action', Object.keys(KINDS))
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(150);
  if (error) return dbError('api/crm/deleted-items', error);

  const mine = (data || []).filter(a => {
    const bu = str(((a.metadata as Row | null)?.row as Row | undefined)?.business_unit);
    return !ctx.businessUnit || !bu || bu === ctx.businessUnit;
  });
  const dealIds = mine.filter(a => a.action === 'deal_deleted').map(a => String(a.target_id));
  const contactIds = mine.filter(a => a.action === 'contact_deleted').map(a => String(a.target_id));
  const [liveDeals, liveContacts] = await Promise.all([
    dealIds.length ? db.from('crm_deals').select('id').in('id', dealIds) : Promise.resolve({ data: [] as { id: string }[] }),
    contactIds.length ? db.from('crm_clients').select('id').in('id', contactIds) : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const live = new Set([...(liveDeals.data || []), ...(liveContacts.data || [])].map(r => r.id));

  const items = mine.filter(a => !live.has(String(a.target_id))).map(a => {
    const m = (a.metadata || {}) as Row;
    const row = (m.row || {}) as Row;
    const kind = KINDS[a.action as keyof typeof KINDS];
    const title = kind === 'deal'
      ? [str(row.client), str(row.property)].filter(Boolean).join(' — ') || 'Untitled deal'
      : [str(row.first_name), str(row.last_name)].filter(Boolean).join(' ') || str(row.business_name) || str(row.email) || 'Unnamed contact';
    const detail = kind === 'deal'
      ? [str(row.type), str(row.stage)].filter(Boolean).join(' · ')
      : [str(row.business_name), str(row.email)].filter(Boolean).join(' · ');
    return {
      audit_id: a.id as string,
      kind,
      title,
      detail,
      deleted_at: (m.deleted_at as string) || (a.created_at as string),
      deleted_by: str(m.actor_email) || null,
      children: kind === 'deal' ? (m.children as Record<string, number> | undefined) ?? null : null,
    };
  });
  return NextResponse.json({ items });
}

/** POST { audit_id } — put a deleted deal / contact back. */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return forbidden('Only the account owner can restore deleted items');
  const body = await req.json().catch(() => null) as { audit_id?: string } | null;
  const auditId = String(body?.audit_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(auditId)) return NextResponse.json({ error: 'audit_id required' }, { status: 400 });

  const db = adminClient();
  const { data: a } = await db.from('audit_logs').select('id, action, target_id, metadata').eq('id', auditId).maybeSingle();
  if (!a || !(a.action in KINDS)) return notFound();
  const kind = KINDS[a.action as keyof typeof KINDS];
  const row = { ...(((a.metadata as Row | null)?.row as Row | undefined) ?? {}) };
  if (!row.id || String(row.id) !== String(a.target_id)) return NextResponse.json({ error: 'This entry has no saved copy to restore.' }, { status: 422 });
  if (ctx.businessUnit && row.business_unit && row.business_unit !== ctx.businessUnit) return notFound();

  const table = kind === 'deal' ? 'crm_deals' : 'crm_clients';
  const { data: existing } = await db.from(table).select('id').eq('id', row.id as string).maybeSingle();
  if (existing) return NextResponse.json({ error: 'That one is already back.' }, { status: 409 });

  // Drop links to things that no longer exist, so the restore doesn't fail on a foreign key.
  if (kind === 'deal') {
    if (row.client_id) {
      const { data: c } = await db.from('crm_clients').select('id').eq('id', row.client_id as string).maybeSingle();
      if (!c) row.client_id = null;
    }
    if (row.listing_id) {
      const { data: l } = await db.from('crm_listings').select('id').eq('id', row.listing_id as string).maybeSingle();
      if (!l) row.listing_id = null;
    }
  }

  const { error } = await db.from(table).insert(row);
  if (error) return dbError('api/crm/deleted-items/restore', error);

  await writeAuditLog({
    actorId: ctx.userId,
    action: kind === 'deal' ? 'deal_restored' : 'contact_restored',
    targetType: kind,
    targetId: String(row.id),
    metadata: { from_audit_id: auditId },
    req,
  });
  return NextResponse.json({ ok: true, kind, id: row.id });
}
