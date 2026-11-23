import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, hiddenDealIds } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { canAccessLinked } from '@/lib/crm-linked-access';
import { detectSigningSpots } from '@/lib/esign-prep';

export const runtime = 'nodejs';
export const maxDuration = 60;

// "Auto-place" in the E-Sign field editor: read the document's printed blanks (the page-footer "Initialed for
// Identification by Buyer ___ and Seller ___" line, the "By (signature):" / "Printed Name:" / "Title:" lines of each
// signature block, a "Date:" blank) and hand back one field per blank, addressed to the signers the agent listed.
// Nothing is saved here — the editor drops the fields on the page, where the agent can still move or delete them.
//
//   POST { submission_id, signers: [{ key, role }], initials?, signatures?, dates?, names? }
//     → { fields: [{ page, fx, fy, fw, type, size, signerKey, signerRole, label?, optional? }], warnings, pages }

const ROLES = ['client', 'landlord', 'agent', 'seller', 'buyer', 'witness', 'other'];

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const id = String(body.submission_id ?? '');
  if (!id) return NextResponse.json({ error: 'Missing document' }, { status: 400 });
  if (!(await assertOwnsResource('crm_form_submissions', id, ctx))) return notFound();

  const guides = body.guides === true;
  const signers: { key: string; role: string }[] = guides
    // Guides: every printed blank for any party (two of each), so a hand-placed spot can snap to the nearest one. Nothing is assigned.
    ? ['seller', 'seller', 'buyer', 'buyer', 'landlord', 'landlord', 'client', 'client', 'agent'].map((role, i) => ({ key: `g${i}`, role }))
    : ((Array.isArray(body.signers) ? body.signers : []) as Record<string, unknown>[])
      .map((s) => ({ key: String(s?.key ?? ''), role: String(s?.role ?? '').toLowerCase() }))
    .filter((s: { key: string; role: string }) => s.key && ROLES.includes(s.role))
    .slice(0, 12);
  const saving = body.save_layout === true;
  if (!signers.length && !saving) return NextResponse.json({ error: 'Add at least one signer first.' }, { status: 400 });

  const db = adminClient();
  const { data: sub } = await db.from('crm_form_submissions')
    .select('id, business_unit, deal_id, listing_id, source_path, filled_path, status, crm_forms(storage_path)').eq('id', id).maybeSingle();
  if (!sub) return notFound();
  if (sub.deal_id && (await hiddenDealIds(ctx)).includes(sub.deal_id as string)) return notFound();
  if (!(await canAccessLinked(ctx, sub as { business_unit?: string | null; deal_id?: string | null; listing_id?: string | null }))) return notFound();
  if (sub.status === 'executed' || sub.status === 'completed') return NextResponse.json({ error: 'That document is already signed.' }, { status: 409 });

  // The blank form (not the filled copy) — the printed lines are where they are in both, and the blank is always there.
  const formRel = sub.crm_forms as unknown as { storage_path?: string } | { storage_path?: string }[] | null;
  const formPath = Array.isArray(formRel) ? formRel[0]?.storage_path : formRel?.storage_path;
  const path = (formPath || sub.source_path || sub.filled_path) as string | null;
  if (!path) return NextResponse.json({ error: 'This document has no PDF to read yet.' }, { status: 404 });
  const { data: blob, error: dlErr } = await db.storage.from('transaction-forms').download(path);
  if (dlErr || !blob) return NextResponse.json({ error: 'Could not read the document.' }, { status: 500 });

  const bytes = new Uint8Array(await blob.arrayBuffer());

  // A layout the agent chose to remember for this exact PDF (same bytes → same form, however many times it is imported). Opt-in only — it is
  // kept apart from the form templates, which never carry signature or initials spots.
  const layoutPath = `esign-layouts/${sub.business_unit || 'commercial'}/${createHash('sha256').update(bytes).digest('hex')}.json`;
  if (saving) {
    const FT = ['signature', 'initial', 'date', 'text'];
    const keep = (Array.isArray(body.fields) ? body.fields : []).slice(0, 400).flatMap((f: Record<string, unknown>) => {
      const fx = Number(f.fx), fy = Number(f.fy), fw = Number(f.fw), page = Math.round(Number(f.page));
      const type = String(f.type), role = String(f.signerRole ?? '').toLowerCase();
      if (!FT.includes(type) || !ROLES.includes(role) || !(page >= 1) || ![fx, fy, fw].every(Number.isFinite)) return [];
      return [{ page, fx, fy, fw, type, size: Number(f.size) || 11, signerRole: role, slot: Math.max(0, Math.min(11, Math.round(Number(f.slot) || 0))),
        label: f.label ? String(f.label).slice(0, 60) : undefined, optional: f.optional ? true : undefined }];
    });
    if (!keep.length) return NextResponse.json({ error: 'Place some spots first.' }, { status: 400 });
    const { error: upErr } = await db.storage.from('transaction-forms').upload(layoutPath, JSON.stringify({ v: 1, saved_by: ctx.userId, saved_at: new Date().toISOString(), fields: keep }), { contentType: 'application/json', upsert: true });
    if (upErr) { console.error('[esign-autoplace] save layout', upErr); return NextResponse.json({ error: 'Could not save the layout.' }, { status: 500 }); }
    return NextResponse.json({ ok: true, count: keep.length });
  }
  if (!guides) {
    const { data: lb } = await db.storage.from('transaction-forms').download(layoutPath);
    if (lb) {
      try {
        const saved = JSON.parse(await lb.text()) as { fields?: { page: number; fx: number; fy: number; fw: number; type: string; size: number; signerRole: string; slot: number; label?: string; optional?: boolean }[] };
        const byR = new Map<string, string[]>();
        for (const s2 of signers) byR.set(s2.role, [...(byR.get(s2.role) ?? []), s2.key]);
        const out = (saved.fields ?? []).flatMap(f => { const key = byR.get(f.signerRole)?.[f.slot ?? 0]; return key ? [{ page: f.page, fx: f.fx, fy: f.fy, fw: f.fw, type: f.type, size: f.size, signerKey: key, signerRole: f.signerRole, label: f.label, optional: f.optional }] : []; });
        if (out.length) return NextResponse.json({ fields: out, warnings: ['Used the layout you saved for this form.'], pages: 0, unreadable: false, source: 'saved' });
      } catch { /* a bad file falls through to reading the form */ }
    }
  }

  const roles = signers.map(s => s.role);
  let det;
  try {
    det = await detectSigningSpots(bytes, roles, {
      initials: body.initials !== false, signatures: body.signatures !== false, dates: body.dates !== false, names: body.names !== false,
    });
  } catch (e) {
    console.error('[esign-autoplace]', e);
    return NextResponse.json({ error: 'Could not read where the blanks are on this document. Place the fields by hand.' }, { status: 422 });
  }

  // The k-th signer of a role takes the k-th printed blank of that role (two buyers → the first and second "Buyer ___, ___").
  const byRole = new Map<string, string[]>();
  for (const s of signers) byRole.set(s.role, [...(byRole.get(s.role) ?? []), s.key]);
  const fields = det.fields.flatMap(f => {
    const key = byRole.get(f.signerRole)?.[f.slot ?? 0];
    if (!key) return [];
    return [{ page: f.page, fx: f.fx, fy: f.fy, fw: f.fw, type: f.type, size: f.size, signerKey: key, signerRole: f.signerRole, label: f.label, optional: f.optional }];
  });
  if (guides) return NextResponse.json({ guides: det.fields.filter(f => !f.guess).map(f => ({ page: f.page, fx: f.fx, fy: f.fy, fw: f.fw, type: f.type })) });
  return NextResponse.json({ fields, warnings: det.warnings, pages: det.pages, unreadable: !!det.unreadable });
}
