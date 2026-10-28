import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/;

// POST /api/crm/quick-contact { email, name? } — "Add contact" from a message you are reading. Returns the existing
// contact when one already has that address (in the caller's workspace), otherwise creates one owned by the caller.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { email: rawEmail, name: rawName } = await req.json().catch(() => ({})) as { email?: string; name?: string };
  const email = String(rawEmail ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) return NextResponse.json({ error: 'That is not a valid email address' }, { status: 400 });
  const db = adminClient();

  const { data: found } = await db.from('crm_clients').select('id, business_unit').ilike('email', email.replace(/[%_\\]/g, m => '\\' + m)).limit(5);
  const visible = (found ?? []).find(r => ctx.role === 'admin' || ctx.role === 'super_admin' || !ctx.businessUnit || r.business_unit === ctx.businessUnit);
  if (visible) return NextResponse.json({ ok: true, existing: true, id: visible.id });

  const display = (String(rawName ?? '').replace(/["<>]/g, '').trim().slice(0, 120)) || email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const parts = display.split(/\s+/);
  const { data: made, error } = await db.from('crm_clients').insert([{
    first_name: parts[0] ?? display, last_name: parts.slice(1).join(' '), email, phone: '',
    type: 'Other', notes: '', agent_id: ctx.userId, assigned_agent_ids: [], lead_source: 'Added from Gmail',
    prospect_status: 'new', business_unit: ctx.businessUnit ?? 'commercial', tags: [], unsubscribe_token: crypto.randomUUID(),
  }]).select('id').single();
  if (error || !made) { console.error('[crm/quick-contact]', error?.message); return NextResponse.json({ error: 'Could not add this contact.' }, { status: 500 }); }
  return NextResponse.json({ ok: true, existing: false, id: made.id });
}
