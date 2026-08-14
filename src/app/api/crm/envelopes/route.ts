import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { genToken, signUrl, logEvent, inviteEmail, sendEsignEmail } from '@/lib/esign';

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
    .select('id, submission_id, deal_id, listing_id, title, status, executed_path, created_at, completed_at, crm_envelope_signers(id, signer_role, name, email, signing_order, status, viewed_at, signed_at)')
    .order('created_at', { ascending: false });
  if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
  if (dealId) q = q.eq('deal_id', dealId);
  if (listingId) q = q.eq('listing_id', listingId);
  if (submissionId) q = q.eq('submission_id', submissionId);
  const { data, error } = await q;
  if (error) { console.error('[api/envelopes] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  const envelopes = await Promise.all((data ?? []).map(async (e) => {
    let executed_url: string | null = null;
    if (e.executed_path) {
      const { data: sg } = await supabase.storage.from('transaction-forms').createSignedUrl(e.executed_path, 3600);
      executed_url = sg?.signedUrl ?? null;
    }
    return { ...e, executed_url };
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

// Cancel (void) a pending signature request — signers can no longer sign, but the
// document stays put so it can be edited and re-sent.
export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  if (!b.envelope_id || b.action !== 'void') return NextResponse.json({ error: 'envelope_id and action:"void" required' }, { status: 400 });
  const supabase = adminClient();
  const { data: env } = await supabase.from('crm_envelopes').select('id, business_unit, status').eq('id', b.envelope_id).maybeSingle();
  if (!env) return notFound('Signature request not found');
  if (!isAdminRole(ctx.role) && env.business_unit !== ctx.businessUnit) return notFound('Signature request not found');
  if (env.status === 'completed') return NextResponse.json({ error: 'This document is already fully signed.' }, { status: 400 });
  if (env.status === 'voided') return NextResponse.json({ ok: true });
  const { error } = await supabase.from('crm_envelopes').update({ status: 'voided', updated_at: new Date().toISOString() }).eq('id', b.envelope_id);
  if (error) { console.error('[api/envelopes] void', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  await logEvent(supabase, b.envelope_id, null, 'voided', { actor: ctx.userId });
  return NextResponse.json({ ok: true });
}
