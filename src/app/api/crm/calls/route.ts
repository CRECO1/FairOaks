import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, isSuperAdminRole, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { toE164 } from '@/lib/phone';
import { buildHistory, internalNumbers, otherParty, type HistoryCall } from '@/lib/call-history';

// The Calling Log: Talkroute calls + voicemails, calls the voice bot answered, and
// calls agents log by hand — one list, scoped to the caller's workspace.

const COLS = 'id, business_unit, source, kind, external_id, direction, result, from_number, to_number, caller_name, contact_id, deal_id, started_at, duration_sec, recording_url, transcript, summary, intent, callback_number, needs_follow_up, follow_up_due, follow_up_assignee, handled_at, handled_by, notes, ai_meta, created_at, outcome, wrapped_at, wrapped_by, answered_by, answered_by_bot';

function scopedUnit(req: NextRequest, ctx: { role: string | null; businessUnit: string | null }): string {
  if (isAdminRole(ctx.role)) return req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial';
  return ctx.businessUnit ?? 'commercial';
}

const OUTCOMES = ['new_lead', 'client', 'tenant', 'vendor', 'spam', 'personal', 'other'] as const;
const OUTCOME_LABEL: Record<string, string> = { new_lead: 'New lead', client: 'Client', tenant: 'Tenant', vendor: 'Vendor', spam: 'Spam', personal: 'Personal', other: 'Other' };

/** Talkroute/hand-logged calls a person had a conversation on — the ones that need a wrap-up. */
function needsWrapup<Q extends { eq: Function; is: Function; in: Function; or: Function }>(q: Q): Q {
  return q.eq('source', 'talkroute').eq('kind', 'call').is('wrapped_at', null).eq('answered_by_bot', false)
    .or('and(direction.eq.inbound,result.eq.answered),direction.eq.outbound') as Q;
}

// GET /api/crm/calls?filter=all|follow_up|voicemail|bot|missed|wrapup&q=&days=&limit=
// GET /api/crm/calls?stats=1
// GET /api/crm/calls?turns=<call id>   → the bot conversation for one call
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const supabase = adminClient();
  const unit = scopedUnit(req, ctx);
  const sp = req.nextUrl.searchParams;

  const turnsFor = sp.get('turns');
  if (turnsFor) {
    const { data: call } = await supabase.from('crm_call_log').select('id, business_unit').eq('id', turnsFor).maybeSingle();
    if (!call || (!isAdminRole(ctx.role) && call.business_unit !== ctx.businessUnit)) return notFound('Call not found');
    const { data, error } = await supabase.from('crm_call_turns').select('id, role, text, created_at').eq('call_id', turnsFor).order('created_at');
    if (error) return dbError('api/crm/calls turns', error);
    return NextResponse.json({ turns: data ?? [] });
  }

  if (sp.get('stats')) {
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    // answered_by_bot rows are the Talkroute leg of a call the bot took — counted once, as the bot's.
    const base = () => supabase.from('crm_call_log').select('id', { count: 'exact', head: true }).eq('business_unit', unit).eq('answered_by_bot', false);
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [today, week, bot, missed, voicemail, followUp, overdue, wrapup] = await Promise.all([
      base().gte('started_at', startToday.toISOString()),
      base().gte('started_at', since7),
      base().gte('started_at', since7).eq('source', 'voicebot'),
      base().gte('started_at', since7).eq('result', 'missed'),
      base().gte('started_at', since7).eq('kind', 'voicemail'),
      base().eq('needs_follow_up', true).is('handled_at', null),
      // Overdue = an open call-back whose due time has passed. (Nulls are excluded by lte.)
      base().eq('needs_follow_up', true).is('handled_at', null).lte('follow_up_due', new Date().toISOString()),
      needsWrapup(base().gte('started_at', since30)),
    ]);
    return NextResponse.json({ stats: {
      today: today.count ?? 0, week: week.count ?? 0, bot: bot.count ?? 0, missed: missed.count ?? 0,
      voicemail: voicemail.count ?? 0, follow_up: followUp.count ?? 0, overdue: overdue.count ?? 0, wrapup: wrapup.count ?? 0,
    } });
  }

  const filter = sp.get('filter') ?? 'all';
  const q = (sp.get('q') ?? '').trim();
  const days = Math.min(365, Math.max(1, Number(sp.get('days') ?? 30) || 30));
  const limit = Math.min(500, Math.max(1, Number(sp.get('limit') ?? 200) || 200));
  const contactId = sp.get('contact_id');

  let query = supabase.from('crm_call_log').select(COLS).eq('business_unit', unit).eq('answered_by_bot', false).limit(limit);
  if (contactId) {
    // Linked rows plus any whose number is one of the contact's — covers calls that
    // came in before the card existed.
    const { data: c } = await supabase.from('crm_clients').select('phone, cell_phone').eq('id', contactId).eq('business_unit', unit).maybeSingle();
    if (!c) return notFound('Contact not found');
    const tails = [c.phone, c.cell_phone].map(n => String(n ?? '').replace(/\D/g, '').slice(-10)).filter(t => t.length === 10);
    const parts = [`contact_id.eq.${contactId}`, ...tails.flatMap(t => [`from_number.like.%${t}`, `to_number.like.%${t}`, `callback_number.like.%${t}`])];
    query = query.or(parts.join(','));
  }
  else query = query.gte('started_at', new Date(Date.now() - days * 86_400_000).toISOString());
  if (filter === 'follow_up') query = query.eq('needs_follow_up', true).is('handled_at', null);
  else if (filter === 'voicemail') query = query.eq('kind', 'voicemail');
  else if (filter === 'bot') query = query.eq('source', 'voicebot');
  else if (filter === 'missed') query = query.in('result', ['missed', 'voicemail']);
  else if (filter === 'wrapup') query = needsWrapup(query);
  if (q) {
    const like = `%${q.replace(/[%,()*]/g, ' ')}%`;
    const d = q.replace(/\D/g, '');
    const parts = [`caller_name.ilike.${like}`, `summary.ilike.${like}`, `intent.ilike.${like}`, `transcript.ilike.${like}`, `notes.ilike.${like}`];
    if (d.length >= 3) parts.push(`from_number.ilike.%${d}%`, `callback_number.ilike.%${d}%`);
    query = query.or(parts.join(','));
  }
  // The call-back queue is ordered by when each is due (soonest / overdue first,
  // undated last); every other view stays newest-first.
  if (filter === 'follow_up') query = query.order('follow_up_due', { ascending: true, nullsFirst: false });
  query = query.order('started_at', { ascending: false });
  const { data, error } = await query;
  if (error) return dbError('api/crm/calls GET', error);

  // Calls between us (our lines, team phones, the phones Talkroute forwards to — e.g. the
  // owner's cell calling the office) are hidden unless asked for; a single contact's own
  // history is never filtered.
  const showInternal = sp.get('include_internal') === '1' || !!contactId;
  const internal = await internalNumbers(supabase, unit);
  const allRows = data ?? [];
  const rows = showInternal ? allRows : allRows.filter(r => !internal.has(otherParty(r)));
  const internalHidden = allRows.length - rows.length;

  // Everything this list's callers did before: one query for the workspace's last year.
  const { data: histRows } = await supabase.from('crm_call_log')
    .select('id, direction, result, kind, source, from_number, to_number, started_at, duration_sec, answered_by, answered_by_bot, notes, summary, intent, handled_by')
    .eq('business_unit', unit).gte('started_at', new Date(Date.now() - 365 * 86_400_000).toISOString()).order('started_at').limit(5000);
  const { data: allProfiles } = await supabase.from('crm_profiles').select('id, first_name, last_name');
  const nameOf = new Map((allProfiles ?? []).map(p => [p.id as string, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim().split(' ')[0] || 'Agent']));
  const historyFor = buildHistory((histRows ?? []) as HistoryCall[], nameOf);

  // Resolve contact + handler names in one go, scoped to the workspace.
  const contactIds = Array.from(new Set(rows.map(r => r.contact_id).filter(Boolean))) as string[];
  // One profile lookup covers both who handled a call and who a call-back is assigned to.
  const profileIds = Array.from(new Set(rows.flatMap(r => [r.handled_by, r.follow_up_assignee, r.answered_by, r.wrapped_by]).filter(Boolean))) as string[];
  const [contacts, profiles] = await Promise.all([
    contactIds.length ? supabase.from('crm_clients').select('id, first_name, last_name, business_name, type').in('id', contactIds).eq('business_unit', unit) : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null; business_name: string | null; type: string | null }> }),
    profileIds.length ? supabase.from('crm_profiles').select('id, first_name, last_name').in('id', profileIds) : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null }> }),
  ]);
  const cById = new Map((contacts.data ?? []).map(c => [c.id, { id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || 'Contact', business_name: c.business_name, type: c.type }]));
  const pById = new Map((profiles.data ?? []).map(h => [h.id, `${h.first_name ?? ''} ${h.last_name ?? ''}`.trim() || 'Agent']));
  return NextResponse.json({ calls: rows.map(r => ({
    ...r,
    contact: r.contact_id ? (cById.get(r.contact_id) ?? null) : null,
    handled_by_name: r.handled_by ? (pById.get(r.handled_by) ?? null) : null,
    assignee_name: r.follow_up_assignee ? (pById.get(r.follow_up_assignee) ?? null) : null,
    answered_by_name: r.answered_by ? (pById.get(r.answered_by) ?? null) : null,
    wrapped_by_name: r.wrapped_by ? (pById.get(r.wrapped_by) ?? null) : null,
    history: historyFor(r),
    // Never ship provider-signed links or Twilio SIDs to the browser; the audio route resolves them.
    has_recording: !!r.recording_url, recording_url: undefined,
  })), internal_hidden: internalHidden });
}

// POST /api/crm/calls — log a call by hand, or from the "How did the call go?" prompt.
//   { number, caller_name?, direction, result, contact_id?, notes?, started_at?, duration_sec?,
//     needs_follow_up?, resolves_call_id?, retry_at? }
// result for outbound calls: answered | left_voicemail | no_answer | wrong_number.
// resolves_call_id = the inbound call-back this call returns: talking to them (or a wrong
// number) closes it; a voicemail / no answer keeps it open and moves its due time to retry_at.
const NOT_REACHED = ['left_voicemail', 'no_answer', 'wrong_number'];
const RESULT_LABEL: Record<string, string> = { answered: 'Talked to them', left_voicemail: 'Left a voicemail', no_answer: 'No answer', wrong_number: 'Wrong number' };
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const unit = isAdminRole(ctx.role) ? (b.business_unit || ctx.businessUnit || 'commercial') : (ctx.businessUnit ?? 'commercial');
  const number = toE164(b.number);
  const outbound = b.direction === 'outbound';
  const result = typeof b.result === 'string' && b.result ? b.result : 'answered';
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (b.contact_id) {
    const { data: c } = await supabase.from('crm_clients').select('id').eq('id', b.contact_id).eq('business_unit', unit).maybeSingle();
    if (!c) return notFound('Contact not found');
  }
  let resolves: { id: string; contact_id: string | null } | null = null;
  if (b.resolves_call_id) {
    const { data: r } = await supabase.from('crm_call_log').select('id, contact_id').eq('id', b.resolves_call_id).eq('business_unit', unit).maybeSingle();
    resolves = r ?? null;
  }
  let retry: string | null = null;
  if (b.retry_at) { const d = new Date(b.retry_at); if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now() - 60_000) retry = d.toISOString(); }

  // A plain "try again" with no call-back to attach it to becomes its own call-back; with one,
  // the reminder moves onto that call-back instead (below).
  const queued = !!b.needs_follow_up || (!!retry && !resolves && (result === 'no_answer' || result === 'left_voicemail'));
  const { data, error } = await supabase.from('crm_call_log').insert({
    business_unit: unit, source: 'manual', kind: 'call', direction: outbound ? 'outbound' : 'inbound',
    result, from_number: outbound ? null : number, to_number: outbound ? number : null,
    caller_name: b.caller_name || null, contact_id: b.contact_id || resolves?.contact_id || null, deal_id: b.deal_id || null,
    started_at: b.started_at || now, duration_sec: b.duration_sec ? Number(b.duration_sec) : null,
    summary: b.summary || null, notes: b.notes || null, needs_follow_up: queued,
    follow_up_due: queued ? retry : null, follow_up_assignee: queued ? ctx.userId : null,
    handled_at: queued ? null : now, handled_by: queued ? null : ctx.userId,
  }).select(COLS).single();
  if (error) return dbError('api/crm/calls POST', error);

  if (resolves) {
    if (result === 'answered' || result === 'wrong_number') {
      await supabase.from('crm_call_log').update({ handled_at: now, handled_by: ctx.userId, needs_follow_up: true, updated_at: now }).eq('id', resolves.id);
    } else if (retry) {
      await supabase.from('crm_call_log').update({ follow_up_due: retry, follow_up_assignee: ctx.userId, needs_follow_up: true, handled_at: null, updated_at: now }).eq('id', resolves.id);
    }
  }
  // On the contact's timeline — which is also what the campaign call list reads as "contacted".
  const contactId = b.contact_id || resolves?.contact_id;
  if (contactId && outbound) {
    await supabase.from('crm_activity').insert({
      client_id: contactId, agent_id: ctx.userId, type: 'call', business_unit: unit,
      notes: `Outbound call · ${RESULT_LABEL[result] ?? result}${b.notes ? ` — ${String(b.notes).slice(0, 400)}` : ''}`,
    });
  }
  return NextResponse.json({ call: data, not_reached: NOT_REACHED.includes(result) });
}

// PATCH /api/crm/calls?id=  { handled?: boolean; notes?; contact_id?; deal_id?; needs_follow_up?; caller_name?; callback_number? }
export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: existing } = await supabase.from('crm_call_log').select('id, business_unit, contact_id, direction, needs_follow_up, handled_at, summary').eq('id', id).maybeSingle();
  if (!existing || (!isAdminRole(ctx.role) && existing.business_unit !== ctx.businessUnit)) return notFound('Call not found');
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.handled === true) { patch.handled_at = new Date().toISOString(); patch.handled_by = ctx.userId; }
  if (b.handled === false) { patch.handled_at = null; patch.handled_by = null; }
  if (b.needs_follow_up !== undefined) patch.needs_follow_up = !!b.needs_follow_up;
  if (b.notes !== undefined) patch.notes = b.notes || null;
  // The wrap-up: what the call was. Spam also closes any open call-back.
  if (b.outcome !== undefined) {
    if (b.outcome !== null && !(OUTCOMES as readonly string[]).includes(b.outcome)) return NextResponse.json({ error: 'Unknown outcome' }, { status: 400 });
    patch.outcome = b.outcome;
    patch.wrapped_at = b.outcome ? new Date().toISOString() : null;
    patch.wrapped_by = b.outcome ? ctx.userId : null;
    if (b.outcome === 'spam' && existing.needs_follow_up && !existing.handled_at) { patch.handled_at = new Date().toISOString(); patch.handled_by = ctx.userId; }
  }
  if (b.caller_name !== undefined) patch.caller_name = b.caller_name || null;
  if (b.callback_number !== undefined) patch.callback_number = toE164(b.callback_number);
  if (b.contact_id !== undefined) {
    if (b.contact_id) {
      const { data: c } = await supabase.from('crm_clients').select('id').eq('id', b.contact_id).eq('business_unit', existing.business_unit).maybeSingle();
      if (!c) return notFound('Contact not found');
    }
    patch.contact_id = b.contact_id || null;
  }
  if (b.deal_id !== undefined) {
    if (b.deal_id) {
      const { data: d } = await supabase.from('crm_deals').select('id').eq('id', b.deal_id).eq('business_unit', existing.business_unit).maybeSingle();
      if (!d) return notFound('Deal not found');
    }
    patch.deal_id = b.deal_id || null;
  }
  if (b.follow_up_due !== undefined) {
    if (b.follow_up_due === null || b.follow_up_due === '') patch.follow_up_due = null;
    else { const dt = new Date(b.follow_up_due); patch.follow_up_due = Number.isNaN(dt.getTime()) ? null : dt.toISOString(); }
  }
  if (b.follow_up_assignee !== undefined) {
    if (b.follow_up_assignee) {
      const { data: p } = await supabase.from('crm_profiles').select('id').eq('id', b.follow_up_assignee).maybeSingle();
      if (!p) return notFound('Agent not found');
      patch.follow_up_assignee = b.follow_up_assignee;
    } else patch.follow_up_assignee = null;
  }
  // Giving a call a due time or an owner makes it a call-back — keep it in the queue
  // unless the caller is explicitly clearing the flag in the same request.
  if ((patch.follow_up_due || patch.follow_up_assignee) && b.needs_follow_up !== false && b.handled !== true) patch.needs_follow_up = true;
  const { data, error } = await supabase.from('crm_call_log').update(patch).eq('id', id).select(COLS).single();
  if (error) return dbError('api/crm/calls PATCH', error);

  // A wrap-up on a real conversation goes on the contact's timeline too.
  const contactId = data.contact_id || existing.contact_id;
  if (b.outcome && !['spam', 'personal'].includes(b.outcome) && contactId && b.handled !== true) {
    const dir = existing.direction === 'outbound' ? 'Outbound call' : 'Inbound call';
    await supabase.from('crm_activity').insert({
      client_id: contactId, agent_id: ctx.userId, type: 'call', business_unit: existing.business_unit,
      notes: `${dir} · ${OUTCOME_LABEL[b.outcome]}${data.notes ? ` — ${String(data.notes).slice(0, 500)}` : ''}`,
    });
  }

  // Marking a call handled is a touch on the contact — record it on their timeline.
  if (b.handled === true && (data.contact_id || existing.contact_id)) {
    await supabase.from('crm_activity').insert({
      client_id: data.contact_id || existing.contact_id, agent_id: ctx.userId, type: 'call', business_unit: existing.business_unit,
      notes: `Returned call${data.summary ? `: ${String(data.summary).slice(0, 300)}` : ''}${b.notes ? ` — ${String(b.notes).slice(0, 300)}` : ''}`,
    });
  }
  return NextResponse.json({ call: { ...data, has_recording: !!data.recording_url, recording_url: undefined } });
}

// DELETE /api/crm/calls?id=  — owner only; the log is a business record.
export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return NextResponse.json({ error: 'Only the account owner can delete call records' }, { status: 403 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await adminClient().from('crm_call_log').delete().eq('id', id);
  if (error) return dbError('api/crm/calls DELETE', error);
  return NextResponse.json({ ok: true });
}
