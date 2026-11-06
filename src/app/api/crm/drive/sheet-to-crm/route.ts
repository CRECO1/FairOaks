import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { userRateLimit } from '@/lib/user-ratelimit';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/;
const MAX_ROWS = 200;
type Person = { name?: string; email?: string; phone?: string; company?: string; notes?: string };

const digits = (s: string) => s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

// POST /api/crm/drive/sheet-to-crm { people: Person[], task: { due: 'YYYY-MM-DD' } | null }
// "Send rows to the CRM" from a Drive sheet: each row becomes a contact owned by the caller (skipped when the same email or phone is
// already in the caller's workspace) and, if asked, an open call task due on the given day.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!(await userRateLimit('sheet-to-crm', ctx.userId, 20, '1 h')).success) return NextResponse.json({ error: 'Too many sends. Try again later.' }, { status: 429 });
  const body = await req.json().catch(() => null) as { people?: Person[]; task?: { due?: string } | null } | null;
  const people = (Array.isArray(body?.people) ? body!.people! : []).slice(0, MAX_ROWS + 1);
  if (!people.length) return NextResponse.json({ error: 'Nothing to send' }, { status: 400 });
  if (people.length > MAX_ROWS) return NextResponse.json({ error: `Send ${MAX_ROWS} rows at a time or fewer` }, { status: 400 });
  const due = body?.task ? (/^\d{4}-\d{2}-\d{2}$/.test(String(body.task.due)) ? String(body.task.due) : new Date(Date.now() + 86400000).toISOString().slice(0, 10)) : null;
  const unit = ctx.businessUnit ?? 'commercial';
  const db = adminClient();

  // Existing contacts in the caller's workspace, to avoid duplicates. New leads on hold (visible only to the broker) are never matched,
  // so a sheet can neither reveal that an email/phone is a held lead nor attach a task to one.
  const byEmail = new Map<string, string>(), byPhone = new Map<string, string>(), heldEmail = new Set<string>(), heldPhone = new Set<string>();
  for (let from = 0; from < 50000; from += 1000) {
    const { data: have } = await db.from('crm_clients').select('id,email,phone,lead_hold').eq('business_unit', unit).order('id').range(from, from + 999);
    for (const c of have ?? []) {
      const em = c.email ? String(c.email).trim().toLowerCase() : '', d = digits(String(c.phone ?? ''));
      if (c.lead_hold && ctx.role !== 'super_admin') { if (em) heldEmail.add(em); if (d.length >= 10) heldPhone.add(d); continue; }
      if (em) byEmail.set(em, c.id as string);
      if (d.length >= 10) byPhone.set(d, c.id as string);
    }
    if (!have || have.length < 1000) break;
  }

  let created = 0, existing = 0, tasks = 0;
  for (const p of people) {
    const clean = (s?: string, n = 200) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
    const name = clean(p.name, 120), company = clean(p.company), notes = clean(p.notes, 1000);
    const email = clean(p.email).toLowerCase(), phone = clean(p.phone, 40);
    if (!name && !company && !email && !phone) continue;
    const goodEmail = EMAIL_RE.test(email) ? email : '';
    if ((goodEmail && heldEmail.has(goodEmail)) || (digits(phone).length >= 10 && heldPhone.has(digits(phone)))) { existing++; continue; }
    let id = (goodEmail && byEmail.get(goodEmail)) || (digits(phone).length >= 10 ? byPhone.get(digits(phone)) : undefined) || '';
    if (id) existing++;
    else {
      const parts = (name || company || goodEmail || phone).split(/\s+/);
      const { data: made, error } = await db.from('crm_clients').insert([{
        first_name: parts[0] ?? '', last_name: name ? parts.slice(1).join(' ') : '', business_name: company || null, email: goodEmail, phone,
        type: 'Other', notes, agent_id: ctx.userId, assigned_agent_ids: [], lead_source: 'Added from Drive sheet',
        prospect_status: 'new', business_unit: unit, tags: [], unsubscribe_token: crypto.randomUUID(),
      }]).select('id').single();
      if (error || !made) { console.error('[drive/sheet-to-crm]', error?.message); continue; }
      id = made.id as string; created++;
      if (goodEmail) byEmail.set(goodEmail, id);
      if (digits(phone).length >= 10) byPhone.set(digits(phone), id);
    }
    if (due) {
      const { error } = await db.from('crm_tasks').insert({
        title: `Call ${name || company || phone || goodEmail}`, description: notes || null, due_date: due, assigned_to: null,
        agent_id: ctx.userId, client_id: id, deal_id: null, type: 'call', priority: 'normal', status: 'open',
        business_unit: unit, created_by: ctx.userId,
      });
      if (!error) tasks++; else console.error('[drive/sheet-to-crm task]', error.message);
    }
  }
  return NextResponse.json({ ok: true, created, existing, tasks });
}
