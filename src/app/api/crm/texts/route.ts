import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { refreshTextFollowUps, sendText, talkrouteConfigured, TalkrouteError } from '@/lib/talkroute';
import { toE164 } from '@/lib/phone';

// Text threads on the Talkroute numbers, for the Calling Log's Texts view and the
// contact card. Replies go out through Talkroute's messaging API from the same
// number the thread lives on.

const COLS = 'id, business_unit, conversation_id, direction, from_number, to_number, body, attachments, contact_id, sent_by, sent_at, read, needs_follow_up, handled_at, handled_by, created_at';

function scopedUnit(req: NextRequest, ctx: { role: string | null; businessUnit: string | null }): string {
  if (isAdminRole(ctx.role)) return req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial';
  return ctx.businessUnit ?? 'commercial';
}

// GET /api/crm/texts?days=&filter=all|needs_reply&q=&contact_id=   → threads (newest first)
// GET /api/crm/texts?conversation=<id>                              → messages in one thread
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const supabase = adminClient();
  const unit = scopedUnit(req, ctx);
  const sp = req.nextUrl.searchParams;

  const conversation = sp.get('conversation');
  if (conversation) {
    const { data, error } = await supabase.from('crm_text_messages').select(COLS).eq('business_unit', unit).eq('conversation_id', conversation).order('sent_at').limit(500);
    if (error) return dbError('api/crm/texts thread', error);
    return NextResponse.json({ messages: data ?? [] });
  }

  const days = Math.min(365, Math.max(1, Number(sp.get('days') ?? 30) || 30));
  const filter = sp.get('filter') ?? 'all';
  const q = (sp.get('q') ?? '').trim();
  const contactId = sp.get('contact_id');
  let query = supabase.from('crm_text_messages').select(COLS).eq('business_unit', unit).order('sent_at', { ascending: false }).limit(2000);
  if (contactId) {
    const { data: c } = await supabase.from('crm_clients').select('phone, cell_phone').eq('id', contactId).eq('business_unit', unit).maybeSingle();
    if (!c) return notFound('Contact not found');
    const tails = [c.phone, c.cell_phone].map(n => String(n ?? '').replace(/\D/g, '').slice(-10)).filter(t => t.length === 10);
    query = query.or([`contact_id.eq.${contactId}`, ...tails.flatMap(t => [`from_number.like.%${t}`, `to_number.like.%${t}`])].join(','));
  }
  else query = query.gte('sent_at', new Date(Date.now() - days * 86_400_000).toISOString());
  if (q) {
    const like = `%${q.replace(/[%,()*]/g, ' ')}%`;
    const d = q.replace(/\D/g, '');
    const parts = [`body.ilike.${like}`];
    if (d.length >= 3) parts.push(`from_number.ilike.%${d}%`, `to_number.ilike.%${d}%`);
    query = query.or(parts.join(','));
  }
  const { data, error } = await query;
  if (error) return dbError('api/crm/texts GET', error);

  // Fold messages into threads: newest message first per conversation.
  const threads = new Map<string, { conversation_id: string; number: string | null; our_number: string | null; contact_id: string | null; last: Record<string, unknown>; count: number; unanswered: boolean; inbound_count: number }>();
  for (const m of data ?? []) {
    const theirs = m.direction === 'inbound' ? m.from_number : m.to_number;
    const ours = m.direction === 'inbound' ? m.to_number : m.from_number;
    const t = threads.get(m.conversation_id);
    if (!t) threads.set(m.conversation_id, { conversation_id: m.conversation_id, number: theirs, our_number: ours, contact_id: m.contact_id, last: m, count: 1, unanswered: !!m.needs_follow_up && !m.handled_at, inbound_count: m.direction === 'inbound' ? 1 : 0 });
    else { t.count++; if (m.direction === 'inbound') t.inbound_count++; if (!t.contact_id && m.contact_id) t.contact_id = m.contact_id; }
  }
  let list = Array.from(threads.values());
  if (filter === 'needs_reply') list = list.filter(t => t.unanswered);

  const contactIds = Array.from(new Set(list.map(t => t.contact_id).filter(Boolean))) as string[];
  const cById = new Map<string, { id: string; name: string; type: string | null }>();
  if (contactIds.length) {
    const { data: cs } = await supabase.from('crm_clients').select('id, first_name, last_name, business_name, type').in('id', contactIds).eq('business_unit', unit);
    for (const c of cs ?? []) cById.set(c.id, { id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || 'Contact', type: c.type });
  }
  return NextResponse.json({ threads: list.map(t => ({ ...t, contact: t.contact_id ? (cById.get(t.contact_id) ?? null) : null })) });
}

// POST /api/crm/texts  { conversation_id, body }  → send a reply through Talkroute
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!talkrouteConfigured()) return NextResponse.json({ error: 'Talkroute is not connected' }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const cid = String(b.conversation_id || '');
  const body = String(b.body || '').trim();
  if (!/^\d{11}-\d{5,11}$/.test(cid)) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
  if (!body) return NextResponse.json({ error: 'Message is empty' }, { status: 400 });
  if (body.length > 1600) return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
  const supabase = adminClient();
  // The thread must exist in the caller's workspace — no texting arbitrary numbers from here.
  const { data: existing } = await supabase.from('crm_text_messages').select('business_unit, contact_id').eq('conversation_id', cid).order('sent_at', { ascending: false }).limit(1).maybeSingle();
  if (!existing || (!isAdminRole(ctx.role) && existing.business_unit !== ctx.businessUnit)) return notFound('Conversation not found');
  try {
    const sent = await sendText(cid, body);
    const [ours, theirs] = cid.split('-');
    const { data: row, error } = await supabase.from('crm_text_messages').insert({
      business_unit: existing.business_unit, source: 'talkroute', external_id: sent?.id ? `msg:${sent.id}` : `sent:${cid}:${Date.now()}`,
      conversation_id: cid, direction: 'outbound', from_number: toE164(ours), to_number: toE164(theirs), body,
      contact_id: existing.contact_id, sent_by: null, sent_at: sent?.created_at || sent?.createdAt || new Date().toISOString(), read: true,
      handled_at: new Date().toISOString(), handled_by: ctx.userId, raw: sent ?? null,
    }).select(COLS).single();
    if (error) return dbError('api/crm/texts POST insert', error);
    await refreshTextFollowUps(supabase, [cid]);
    if (existing.contact_id) await supabase.from('crm_activity').insert({ client_id: existing.contact_id, agent_id: ctx.userId, type: 'sms', business_unit: existing.business_unit, notes: `Texted: ${body.slice(0, 300)}` });
    return NextResponse.json({ message: row });
  } catch (e) {
    console.error('[api/crm/texts POST]', e);
    const msg = e instanceof TalkrouteError ? (e.status === 402 || e.status === 403 ? 'Talkroute would not send it — texting may not be enabled for this number.' : e.message) : 'Could not send';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// PATCH /api/crm/texts?conversation=<id>  { handled: true|false }
export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const cid = req.nextUrl.searchParams.get('conversation');
  if (!cid) return NextResponse.json({ error: 'conversation required' }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const supabase = adminClient();
  const { data: last } = await supabase.from('crm_text_messages').select('id, business_unit, contact_id').eq('conversation_id', cid).order('sent_at', { ascending: false }).limit(1).maybeSingle();
  if (!last || (!isAdminRole(ctx.role) && last.business_unit !== ctx.businessUnit)) return notFound('Conversation not found');
  const handled = b.handled !== false;
  const { error } = await supabase.from('crm_text_messages').update({ handled_at: handled ? new Date().toISOString() : null, handled_by: handled ? ctx.userId : null, needs_follow_up: !handled }).eq('id', last.id);
  if (error) return dbError('api/crm/texts PATCH', error);
  return NextResponse.json({ ok: true });
}
