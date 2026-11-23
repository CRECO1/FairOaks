import { NextRequest, NextResponse } from 'next/server';
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

  const signers = (Array.isArray(body.signers) ? body.signers : [])
    .map((s: Record<string, unknown>) => ({ key: String(s?.key ?? ''), role: String(s?.role ?? '').toLowerCase() }))
    .filter((s: { key: string; role: string }) => s.key && ROLES.includes(s.role))
    .slice(0, 12) as { key: string; role: string }[];
  if (!signers.length) return NextResponse.json({ error: 'Add at least one signer first.' }, { status: 400 });

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

  const roles = signers.map(s => s.role);
  let det;
  try {
    det = await detectSigningSpots(new Uint8Array(await blob.arrayBuffer()), roles, {
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
  return NextResponse.json({ fields, warnings: det.warnings, pages: det.pages });
}
