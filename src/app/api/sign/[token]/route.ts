import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SIGN_BUCKET, logEvent, clientIp, signUrl, routingEmail, completedEmail, sendEsignEmail, buildExecutedPdf, type ExecutedSigner, type PlacedField } from '@/lib/esign';

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
  if (turnStatus(env, signer, signers) !== 'ready') {
    return NextResponse.json({ error: 'This document is not available for you to sign right now.' }, { status: 409 });
  }

  const b = await req.json().catch(() => ({}));
  if (!b.consent) return NextResponse.json({ error: 'Please check the box to consent to sign electronically.' }, { status: 400 });
  const typedName = String(b.typed_name || signer.name).slice(0, 120);
  const ip = clientIp(req); const ua = req.headers.get('user-agent'); const nowIso = new Date().toISOString();

  let signature_path: string | null = null;
  if (typeof b.signature_png === 'string' && b.signature_png.startsWith('data:image')) {
    const bytes = Buffer.from(b.signature_png.split(',')[1] || '', 'base64');
    if (bytes.length > 0 && bytes.length < 2_000_000) {
      const p = `signatures/${env.id}/${signer.id}.png`;
      const { error } = await db.storage.from(SIGN_BUCKET).upload(p, bytes, { contentType: 'image/png', upsert: true });
      if (!error) signature_path = p;
    }
  }

  await db.from('crm_envelope_signers').update({ status: 'signed', signed_at: nowIso, signature_path, typed_name: typedName, consent_at: nowIso, ip, user_agent: ua }).eq('id', signer.id);
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

  // Everyone has signed → assemble the executed PDF.
  try {
    const { data: srcBlob } = await db.storage.from(SIGN_BUCKET).download(env.source_path!);
    const srcBytes = new Uint8Array(await srcBlob!.arrayBuffer());
    const execSigners: ExecutedSigner[] = [];
    for (const s of all) {
      let png: Uint8Array | null = null;
      if (s.signature_path) { const { data: pb } = await db.storage.from(SIGN_BUCKET).download(s.signature_path); if (pb) png = new Uint8Array(await pb.arrayBuffer()); }
      execSigners.push({ name: s.name, email: s.email, role: s.signer_role, signedAt: s.signed_at, ip: s.ip, signaturePng: png, typedName: s.typed_name || undefined });
    }
    let sigFields: PlacedField[] = [];
    if (env.submission_id) {
      const { data: sub } = await db.from('crm_form_submissions').select('values').eq('id', env.submission_id).maybeSingle();
      const vals: Array<{ page?: number; fx: number; fy: number; fw: number; type?: string; signerRole?: string }> = Array.isArray(sub?.values) ? sub!.values : [];
      sigFields = vals
        .filter(f => ['signature', 'initial', 'date', 'date_signed'].includes(String(f.type)))
        .map(f => ({ page: f.page ?? 1, fx: f.fx, fy: f.fy, fw: f.fw, type: String(f.type), signerRole: f.signerRole ?? 'client' }));
    }
    const executed = await buildExecutedPdf(srcBytes, { docTitle: env.title, envelopeId: env.id, signers: execSigners, sigFields });
    const execPath = `executed/${env.id}.pdf`;
    await db.storage.from(SIGN_BUCKET).upload(execPath, Buffer.from(executed), { contentType: 'application/pdf', upsert: true });
    await db.from('crm_envelopes').update({ status: 'completed', executed_path: execPath, completed_at: nowIso, updated_at: nowIso }).eq('id', env.id);
    await logEvent(db, env.id, null, 'completed', { actor: 'system' });

    // email the executed copy to every signer + the broker
    const b64 = Buffer.from(executed).toString('base64');
    const attach = [{ filename: `${(env.title || 'document').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-signed.pdf`, content: b64 }];
    const recipients = new Map<string, string>();
    for (const s of all) recipients.set(s.email.toLowerCase(), s.name);
    if (env.created_by) {
      const { data: prof } = await db.from('crm_profiles').select('email, first_name, last_name').eq('id', env.created_by).maybeSingle();
      if (prof?.email) recipients.set(String(prof.email).toLowerCase(), `${prof.first_name ?? ''} ${prof.last_name ?? ''}`.trim() || 'Broker');
    }
    for (const [email, name] of recipients) {
      const { subject, html } = completedEmail(env.business_unit, { recipientName: name, docTitle: env.title });
      await sendEsignEmail(env.business_unit, email, subject, html, attach);
    }
  } catch (e) {
    console.error('[api/sign] finalize', e);
    // signer's signature is recorded; envelope stays in_progress for a retry/manual fix
    await db.from('crm_envelopes').update({ status: 'in_progress', updated_at: nowIso }).eq('id', env.id);
    return NextResponse.json({ status: 'signed', finalizeError: true });
  }
  return NextResponse.json({ status: 'completed' });
}
