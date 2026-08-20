import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SIGN_BUCKET, logEvent, clientIp, signUrl, routingEmail, sendEsignEmail, finalizeEnvelope } from '@/lib/esign';

// PUBLIC, token-gated — intentionally NOT in middleware.ts's matcher, so external
// signers (no login) reach it. Uses the service-role client directly.
export const dynamic = 'force-dynamic';

type Signer = {
  id: string; envelope_id: string; signer_role: string; name: string; email: string;
  signing_order: number; status: string; access_token: string; signature_path: string | null;
  typed_name: string | null; signed_at: string | null; viewed_at: string | null; ip: string | null;
};
type Envelope = { id: string; title: string; business_unit: string; status: string; source_path: string | null; executed_path: string | null; created_by: string | null; submission_id: string | null };

function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function load(token: string) {
  const db = admin();
  const { data: signer } = await db.from('crm_envelope_signers').select('*').eq('access_token', token).maybeSingle();
  if (!signer) return null;
  const { data: env } = await db.from('crm_envelopes').select('*').eq('id', signer.envelope_id).single();
  const { data: signers } = await db.from('crm_envelope_signers').select('*').eq('envelope_id', signer.envelope_id).order('signing_order');
  return { db, signer: signer as Signer, env: env as Envelope, signers: (signers ?? []) as Signer[] };
}

function turnStatus(env: Envelope, signer: Signer, signers: Signer[]): 'voided' | 'completed' | 'done' | 'waiting' | 'ready' {
  if (!env || env.status === 'voided') return 'voided';
  if (env.status === 'completed') return 'completed';
  if (signer.status === 'signed' || signer.signed_at) return 'done';
  if (signers.some(s => s.signing_order < signer.signing_order && s.status !== 'signed')) return 'waiting';
  return 'ready';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await load(token);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { db, signer, env, signers } = ctx;
  if (!env) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const status = turnStatus(env, signer, signers);

  let doc_url: string | null = null;
  const path = status === 'completed' && env.executed_path ? env.executed_path : env.source_path;
  if (path) { const { data: sg } = await db.storage.from(SIGN_BUCKET).createSignedUrl(path, 3600); doc_url = sg?.signedUrl ?? null; }

  if (status === 'ready' && !signer.viewed_at) {
    await db.from('crm_envelope_signers').update({ status: 'viewed', viewed_at: new Date().toISOString() }).eq('id', signer.id);
    await logEvent(db, env.id, signer.id, 'opened', { actor: signer.email, ip: clientIp(req), ua: req.headers.get('user-agent') });
  }

  return NextResponse.json({
    status, doc_url,
    title: env.title ?? 'Document',
    signer: { name: signer.name, role: signer.signer_role, email: signer.email },
    parties: signers.map(s => ({ role: s.signer_role, name: s.name, order: s.signing_order, status: s.signed_at ? 'signed' : s.status })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await load(token);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { db, signer, env, signers } = ctx;
  if (!env) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (turnStatus(env, signer, signers) !== 'ready') {
    return NextResponse.json({ error: 'This document is not available for you to sign right now.' }, { status: 409 });
  }

  const b = await req.json().catch(() => ({}));
  if (!b.consent) return NextResponse.json({ error: 'Please check the box to consent to sign electronically.' }, { status: 400 });
  const typedName = String(b.typed_name || signer.name).slice(0, 120);
  const ip = clientIp(req); const ua = req.headers.get('user-agent'); const nowIso = new Date().toISOString();

  // The signature and the matching initials are both stored as PNGs, so a doc that
  // asks for initials gets the signer's own hand rather than generic block letters.
  const storePng = async (dataUrl: unknown, name: string): Promise<string | null> => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
    const bytes = Buffer.from(dataUrl.split(',')[1] || '', 'base64');
    if (!bytes.length || bytes.length >= 2_000_000) return null;
    const path = `signatures/${env.id}/${signer.id}${name}.png`;
    const { error } = await db.storage.from(SIGN_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
    return error ? null : path;
  };
  const signature_path = await storePng(b.signature_png, '');
  const initials_path = await storePng(b.initials_png, '-initials');
  const signature_style = typeof b.signature_style === 'string' ? b.signature_style.slice(0, 40) : null;

  // Atomic claim: only the request that flips this signer not-signed → signed proceeds.
  // A double-click / concurrent retry matches 0 rows and returns early, so the next
  // signer is never emailed twice and finalize never runs (or completion-emails) twice.
  const { data: claimed } = await db.from('crm_envelope_signers')
    .update({ status: 'signed', signed_at: nowIso, signature_path, initials_path, signature_style, typed_name: typedName, consent_at: nowIso, ip, user_agent: ua })
    .eq('id', signer.id).neq('status', 'signed').select('id');
  if (!claimed || claimed.length === 0) return NextResponse.json({ status: 'signed', already: true });
  await logEvent(db, env.id, signer.id, 'signed', { actor: signer.email, ip, ua });

  const { data: freshData } = await db.from('crm_envelope_signers').select('*').eq('envelope_id', env.id).order('signing_order');
  const all = (freshData ?? []) as Signer[];
  const next = all.find(s => s.status !== 'signed');

  if (next) {
    await db.from('crm_envelope_signers').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', next.id);
    await db.from('crm_envelopes').update({ status: 'in_progress', updated_at: nowIso }).eq('id', env.id);
    await logEvent(db, env.id, next.id, 'sent', { actor: 'system', meta: { to: next.email } });
    const { subject, html } = routingEmail(env.business_unit, { signerName: next.name, docTitle: env.title, url: signUrl(next.access_token) });
    await sendEsignEmail(env.business_unit, next.email, subject, html);
    return NextResponse.json({ status: 'signed', next: true });
  }

  // Everyone has signed → assemble + store the executed PDF and email it to all parties.
  const fin = await finalizeEnvelope(db, env, all);
  if (!fin.ok) {
    console.error('[api/sign] finalize', fin.error);
    // The signature is safely recorded; leave the request in_progress so the broker can
    // retry finalize (PATCH /api/crm/envelopes action:'finalize') without anyone re-signing.
    await db.from('crm_envelopes').update({ status: 'in_progress', updated_at: nowIso }).eq('id', env.id);
    return NextResponse.json({ status: 'signed', finalizeError: true });
  }
  return NextResponse.json({ status: 'completed' });
}
