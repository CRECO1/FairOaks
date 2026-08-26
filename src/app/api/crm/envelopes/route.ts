import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole, isSuperAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { genToken, signUrl, logEvent, inviteEmail, sendEsignEmail, finalizeEnvelope, SIGN_BUCKET, type FinalizeSigner } from '@/lib/esign';

export const dynamic = 'force-dynamic';

// Signature envelopes on top of a filled crm_form_submissions doc. Authed broker
// routes; the actual signing happens on the public /api/sign/[token] route.

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('deal_id');
  const listingId = req.nextUrl.searchParams.get('listing_id');
  const submissionId = req.nextUrl.searchParams.get('submission_id');
  const supabase = adminClient();
  let q = supabase.from('crm_envelopes')
    .select('id, submission_id, deal_id, listing_id, title, status, message, executed_path, executed_clean_path, created_at, completed_at, archived_at, created_by, business_unit, crm_deals(id, property, client), crm_envelope_signers(id, signer_role, name, email, signing_order, status, sent_at, viewed_at, signed_at)')
    .order('created_at', { ascending: false });
  if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
  if (dealId) q = q.eq('deal_id', dealId);
  if (listingId) q = q.eq('listing_id', listingId);
  if (submissionId) q = q.eq('submission_id', submissionId);
  if (req.nextUrl.searchParams.get('pending')) q = q.in('status', ['sent', 'in_progress']); // global dashboard: out-for-signature only
  // …and the same dashboard asking for everything, so cancelled, completed and
  // archived requests stay reachable (to review, restore, or purge).
  if (req.nextUrl.searchParams.get('scope') === 'all') q = q.limit(200);
  else q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) { console.error('[api/envelopes] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  // Who sent each request. Resolved in one query rather than per row, and returned
  // on every envelope — an admin looking at the whole workspace needs to know which
  // agent a document came from, not just that it exists.
  const senderIds = Array.from(new Set((data ?? []).map(e => e.created_by).filter(Boolean))) as string[];
  const senderById = new Map<string, string>();
  if (senderIds.length) {
    const { data: profs } = await supabase.from('crm_profiles').select('id, first_name, last_name').in('id', senderIds);
    for (const p of profs ?? []) senderById.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Agent');
  }
  const envelopes = await Promise.all((data ?? []).map(async (e) => {
    let executed_url: string | null = null;
    let executed_clean_url: string | null = null;
    if (e.executed_clean_path) {
      const { data: sg } = await supabase.storage.from('transaction-forms').createSignedUrl(e.executed_clean_path, 3600);
      executed_clean_url = sg?.signedUrl ?? null;
    }
    if (e.executed_path) {
      const { data: sg } = await supabase.storage.from('transaction-forms').createSignedUrl(e.executed_path, 3600);
      executed_url = sg?.signedUrl ?? null;
    }
    return { ...e, executed_url, executed_clean_url, sent_by: e.created_by ? senderById.get(e.created_by) ?? 'Agent' : null };
  }));
  return NextResponse.json({ envelopes });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const { submission_id, deal_id, listing_id, title, message, signers } = b;
  if (!submission_id) return NextResponse.json({ error: 'submission_id required' }, { status: 400 });
  if (!Array.isArray(signers) || signers.length === 0) return NextResponse.json({ error: 'Add at least one signer' }, { status: 400 });
  const clean = signers.filter((s: { email?: string; name?: string }) => s && s.email && String(s.email).includes('@') && s.name);
  if (clean.length === 0) return NextResponse.json({ error: 'Each signer needs a name and a valid email' }, { status: 400 });

  const supabase = adminClient();
  if (!(await assertOwnsResource('crm_form_submissions', submission_id, ctx))) return notFound('Document not found');
  const { data: sub } = await supabase.from('crm_form_submissions').select('id, form_id, filled_path, business_unit, title, deal_id, listing_id').eq('id', submission_id).single();
  if (!sub) return notFound('Document not found');
  if (!sub.filled_path) return NextResponse.json({ error: 'This document has no saved PDF yet — open it, fill it, and Save to the deal first.' }, { status: 400 });

  const unit = isAdminRole(ctx.role) ? (sub.business_unit || ctx.businessUnit || 'commercial') : (ctx.businessUnit ?? 'commercial');
  const docTitle = title || sub.title || 'Document';

  const { data: env, error: envErr } = await supabase.from('crm_envelopes').insert([{
    submission_id, form_id: sub.form_id, deal_id: deal_id ?? sub.deal_id ?? null, listing_id: listing_id ?? sub.listing_id ?? null,
    business_unit: unit, title: docTitle, message: message || null, status: 'sent', source_path: sub.filled_path, created_by: ctx.userId,
  }]).select('id').single();
  if (envErr || !env) { console.error('[api/envelopes] insert', envErr); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }

  const ordered = clean
    .map((s: { signer_role?: string; name: string; email: string; signing_order?: number }, i: number) => ({ ...s, signing_order: s.signing_order ?? (i + 1) }))
    .sort((a: { signing_order: number }, z: { signing_order: number }) => a.signing_order - z.signing_order);
  const now = new Date().toISOString();
  const rows = ordered.map((s: { signer_role?: string; name: string; email: string }, i: number) => ({
    envelope_id: env.id, signer_role: s.signer_role || 'client', name: String(s.name).trim(), email: String(s.email).trim().toLowerCase(),
    signing_order: i + 1, access_token: genToken(), status: i === 0 ? 'sent' : 'pending', sent_at: i === 0 ? now : null,
  }));
  const { data: created, error: sErr } = await supabase.from('crm_envelope_signers').insert(rows).select('id, name, email, signer_role, signing_order, access_token');
  if (sErr) { console.error('[api/envelopes] signers', sErr); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }

  await logEvent(supabase, env.id, null, 'created', { actor: ctx.userId, meta: { signers: rows.length } });
  const first = (created ?? []).find(s => s.signing_order === 1) ?? created?.[0];
  if (first) await logEvent(supabase, env.id, first.id, 'sent', { actor: 'system', meta: { to: first.email } });

  let senderName = 'Your broker';
  const { data: prof } = await supabase.from('crm_profiles').select('first_name, last_name').eq('id', ctx.userId).maybeSingle();
  if (prof) senderName = `${prof.first_name ?? ''} ${prof.last_name ?? ''}`.trim() || senderName;

  let sent = false;
  if (first) {
    const { subject, html } = inviteEmail(unit, { signerName: first.name, docTitle, senderName, url: signUrl(first.access_token), message });
    const r = await sendEsignEmail(unit, first.email, subject, html);
    sent = r.ok;
    if (!r.ok) console.error('[api/envelopes] invite send failed:', r.error);
  }
  return NextResponse.json({
    envelope_id: env.id,
    first_signer: first ? { id: first.id, name: first.name, email: first.email, sign_url: signUrl(first.access_token) } : null,
    sent,
  });
}

// Manage a signature request: cancel it, nudge the current signer, fix a pending
// signer's email, or add another signer — without creating a duplicate envelope.
interface SignerRow { id: string; name: string; email: string; signer_role: string; signing_order: number; status: string; access_token: string; signed_at: string | null }

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const action = b.action as string;
  if (!b.envelope_id) return NextResponse.json({ error: 'envelope_id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: env } = await supabase.from('crm_envelopes').select('id, business_unit, status, title, message').eq('id', b.envelope_id).maybeSingle();
  if (!env) return notFound('Signature request not found');
  if (!isAdminRole(ctx.role) && env.business_unit !== ctx.businessUnit) return notFound('Signature request not found');

  // ── Cancel (void) ──
  if (action === 'void') {
    if (env.status === 'completed') return NextResponse.json({ error: 'This document is already fully signed.' }, { status: 400 });
    if (env.status === 'voided') return NextResponse.json({ ok: true });
    const { error } = await supabase.from('crm_envelopes').update({ status: 'voided', updated_at: new Date().toISOString() }).eq('id', env.id);
    if (error) { console.error('[api/envelopes] void', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
    await logEvent(supabase, env.id, null, 'voided', { actor: ctx.userId });
    return NextResponse.json({ ok: true });
  }

  // Fetch a signer's private sign link (read-only) — for the agent to share manually.
  if (action === 'get_link') {
    if (!b.signer_id) return NextResponse.json({ error: 'signer_id required' }, { status: 400 });
    const { data: signer } = await supabase.from('crm_envelope_signers').select('access_token').eq('id', b.signer_id).eq('envelope_id', env.id).maybeSingle();
    if (!signer) return notFound('Signer not found');
    return NextResponse.json({ url: signUrl(signer.access_token) });
  }

  // Recover a stuck request: everyone signed but the executed PDF never assembled
  // (e.g. a transient storage error reverted it to in_progress). Re-runs finalize.
  if (action === 'finalize') {
    if (env.status === 'completed') return NextResponse.json({ ok: true, already: true });
    if (env.status === 'voided') return NextResponse.json({ error: 'This request was cancelled.' }, { status: 400 });
    const { data: rows } = await supabase.from('crm_envelope_signers').select('*').eq('envelope_id', env.id).order('signing_order');
    const all = (rows ?? []) as Array<FinalizeSigner & { status: string; signed_at: string | null }>;
    if (!all.length) return NextResponse.json({ error: 'No signers on this request.' }, { status: 400 });
    if (!all.every(s => s.status === 'signed' || s.signed_at)) return NextResponse.json({ error: 'Not everyone has signed yet.' }, { status: 400 });
    const { data: full } = await supabase.from('crm_envelopes').select('id, title, business_unit, source_path, submission_id, created_by').eq('id', env.id).single();
    if (!full) return notFound('Signature request not found');
    const fin = await finalizeEnvelope(supabase, full, all);
    if (!fin.ok) { console.error('[api/envelopes] finalize', fin.error); return NextResponse.json({ error: fin.error || 'Could not finish signing' }, { status: 500 }); }
    return NextResponse.json({ ok: true });
  }

  if (env.status === 'completed' || env.status === 'voided') {
    return NextResponse.json({ error: `This request is ${env.status} and can no longer be changed.` }, { status: 400 });
  }

  const { data: prof } = await supabase.from('crm_profiles').select('first_name, last_name').eq('id', ctx.userId).maybeSingle();
  const senderName = prof ? `${prof.first_name ?? ''} ${prof.last_name ?? ''}`.trim() || 'Your broker' : 'Your broker';
  const loadSigners = async (): Promise<SignerRow[]> => {
    const { data } = await supabase.from('crm_envelope_signers').select('*').eq('envelope_id', env.id).order('signing_order');
    return (data ?? []) as SignerRow[];
  };
  const invite = (s: { name: string; email: string; access_token: string }) => {
    const { subject, html } = inviteEmail(env.business_unit, { signerName: s.name, docTitle: env.title, senderName, url: signUrl(s.access_token), message: env.message || undefined });
    return sendEsignEmail(env.business_unit, s.email, subject, html);
  };

  // ── Nudge the current pending signer (no new envelope) ──
  if (action === 'nudge') {
    const signers = await loadSigners();
    const current = signers.find(s => s.status !== 'signed' && !s.signed_at);
    if (!current) return NextResponse.json({ error: 'No one is waiting to sign.' }, { status: 400 });
    const r = await invite(current);
    if (current.status === 'pending') await supabase.from('crm_envelope_signers').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', current.id);
    await logEvent(supabase, env.id, current.id, 'sent', { actor: ctx.userId, meta: { nudge: true, to: current.email } });
    return NextResponse.json({ ok: r.ok, to: current.email });
  }

  // ── Change a not-yet-signed signer (swap who signs): name / email / role;
  //    resend if they're the current signer ──
  if (action === 'update_signer') {
    if (!b.signer_id) return NextResponse.json({ error: 'signer_id required' }, { status: 400 });
    const signers = await loadSigners();
    const signer = signers.find(s => s.id === b.signer_id);
    if (!signer) return notFound('Signer not found');
    if (signer.status === 'signed' || signer.signed_at) return NextResponse.json({ error: 'That signer has already signed.' }, { status: 400 });
    const patch: Record<string, string> = {};
    if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
    if (typeof b.email === 'string' && b.email.includes('@')) patch.email = b.email.trim().toLowerCase();
    if (typeof b.role === 'string' && b.role.trim()) patch.signer_role = b.role.trim();
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'Give a name, a valid email, or a role' }, { status: 400 });
    await supabase.from('crm_envelope_signers').update(patch).eq('id', signer.id);
    await logEvent(supabase, env.id, signer.id, 'signer_updated', { actor: ctx.userId, meta: patch });
    const current = signers.find(s => s.status !== 'signed' && !s.signed_at);
    let resent = false;
    if (current && current.id === signer.id) resent = (await invite({ name: patch.name || signer.name, email: patch.email || signer.email, access_token: signer.access_token })).ok;
    return NextResponse.json({ ok: true, resent });
  }

  // ── Add another signer at the end of the order ──
  if (action === 'add_signer') {
    if (!b.name || !b.email || !String(b.email).includes('@')) return NextResponse.json({ error: 'Signer needs a name and a valid email' }, { status: 400 });
    const signers = await loadSigners();
    const nextOrder = signers.reduce((m, s) => Math.max(m, s.signing_order), 0) + 1;
    const { data: created, error } = await supabase.from('crm_envelope_signers').insert({
      envelope_id: env.id, signer_role: b.role || 'client', name: String(b.name).trim(), email: String(b.email).trim().toLowerCase(),
      signing_order: nextOrder, status: 'pending', access_token: genToken(),
    }).select('id, name, email, access_token').single();
    if (error) { console.error('[api/envelopes] add_signer', error); return NextResponse.json({ error: 'Could not add signer' }, { status: 500 }); }
    await logEvent(supabase, env.id, created.id, 'signer_added', { actor: ctx.userId, meta: { to: created.email } });
    // If everyone before them already signed, this new signer is up next — email now.
    if (!signers.some(s => s.status !== 'signed' && !s.signed_at)) {
      await supabase.from('crm_envelope_signers').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', created.id);
      await invite(created);
      await supabase.from('crm_envelopes').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', env.id);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// Remove a signature request from the working lists — or, for a super admin,
// destroy it outright.
//
// ARCHIVE is the default and what everyone up to and including `admin` gets: the
// envelope, its signers, its event log and every file stay exactly where they are,
// the request just stops showing in the active lists. The signing history of a deal
// is a business record, so an agent tidying their queue must not be able to erase it.
//
// PURGE (`?purge=1`) really deletes: the envelope plus its signers and events (both
// cascade) plus every blob it owns — each signature/initials PNG and the executed
// copy. Restricted to `super_admin`, deliberately NOT `isAdminRole` — admin includes
// broker-level agents, and this is the one action that cannot be undone.
export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const purge = req.nextUrl.searchParams.get('purge') === '1';
  if (!(await assertOwnsResource('crm_envelopes', id, ctx))) return notFound('Signature request not found');

  const supabase = adminClient();
  const { data: env } = await supabase.from('crm_envelopes')
    .select('id, title, status, executed_path').eq('id', id).maybeSingle();
  if (!env) return notFound('Signature request not found');

  if (!purge) {
    const { error } = await supabase.from('crm_envelopes')
      .update({ archived_at: new Date().toISOString(), archived_by: ctx.userId, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error('[api/envelopes] archive', error); return NextResponse.json({ error: 'Could not archive the request' }, { status: 500 }); }
    await logEvent(supabase, id, null, 'archived', { actor: ctx.userId });
    return NextResponse.json({ archived: true, title: env.title });
  }

  if (!isSuperAdminRole(ctx.role)) {
    return NextResponse.json({ error: 'Only the account owner can permanently delete a signature request. It has been kept in the archive instead.' }, { status: 403 });
  }

  const { data: signers } = await supabase.from('crm_envelope_signers')
    .select('signature_path, initials_path').eq('envelope_id', id);
  const paths = [
    ...(signers ?? []).flatMap(s => [s.signature_path, s.initials_path]),
    env.executed_path,
  ].filter(Boolean) as string[];
  // Best-effort: a missing blob must not block removing the record.
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from(SIGN_BUCKET).remove(paths);
    if (rmErr) console.error('[api/envelopes] purge blobs', rmErr);
  }

  const { error } = await supabase.from('crm_envelopes').delete().eq('id', id);
  if (error) { console.error('[api/envelopes] purge', error); return NextResponse.json({ error: 'Could not delete the signature request' }, { status: 500 }); }
  return NextResponse.json({ deleted: true, title: env.title });
}

// Put an archived request back into the working lists.
export async function PUT(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_envelopes', id, ctx))) return notFound('Signature request not found');
  const { error } = await adminClient().from('crm_envelopes')
    .update({ archived_at: null, archived_by: null, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.error('[api/envelopes] restore', error); return NextResponse.json({ error: 'Could not restore it' }, { status: 500 }); }
  return NextResponse.json({ restored: true });
}
