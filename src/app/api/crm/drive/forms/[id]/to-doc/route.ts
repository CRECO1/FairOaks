import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { markdownToDriveState } from '@/lib/drive-markdown';
import { logDocEvent } from '@/lib/drive-events';
import { DOC_COLS } from '@/lib/drive-types';
import { specForForm, type LoiPurchaseData } from '@/lib/loi-spec';

// "Edit as a live document" for a Letter of Intent filed in Drive: writes the letter out as a NEW live My Drive document in the same folder
// (same team sharing), so it can be edited together — and linked to a deal or contact card as itself — like any other document.
// The original form goes to the Trash (restorable) so the folder doesn't end up with two look-alike letters, and a form is converted ONCE: asking again opens the document made the first time.
// The letter's terms come across as an editable table; the signature blocks come across as plain lines (e-sign placement is a form feature).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ').trim();
const lines = (s: unknown) => String(s ?? '').split(/\n+/).map(x => x.trim()).filter(Boolean);

function loiToMarkdown(d: LoiPurchaseData, spec: { title: string; boilerplate: string[]; partyHeading: string }): string {
  const out: string[] = [];
  if (d.loiDate) out.push(d.loiDate);
  for (const l of [d.addresseeName, d.addresseeAddr1, d.addresseeAddr2]) if (l?.trim()) out.push(l.trim());
  if (d.reLine?.trim()) out.push(`**Re:** ${d.reLine.trim()}`);
  out.push(`# ${spec.title}`);
  if (d.subtitle?.trim()) out.push(d.subtitle.trim());
  if (d.intro?.trim()) { out.push('Dear Sir or Madam,'); for (const p of lines(d.intro)) out.push(p); }
  const terms = (d.terms ?? []).filter(t => t.label || t.value);
  if (terms.length) out.push(['| Term | Details |', '| --- | --- |', ...terms.map(t => `| **${cell(t.label)}** | ${cell(t.value)} |`)].join('\n'));
  if (d.additionalTerms?.trim()) { out.push('**Other Stipulations:**'); for (const p of lines(d.additionalTerms)) out.push(p); }
  for (const p of spec.boilerplate) out.push(p);
  out.push('Sincerely,');
  for (const l of [d.agentName, d.agentEmail, d.agentPhone]) if (l?.trim()) out.push(l.trim());
  if (spec.partyHeading) out.push(`**${spec.partyHeading}**`);
  const parties = (d.sellers?.length ? d.sellers : [{ entity: '', signatory: '' }]).slice(0, 2);
  for (const s of parties) {
    out.push('**AGREED TO & ACCEPTED BY:**');
    out.push(s.entity?.trim() || '______________________________');
    out.push('Signature: ______________________________');
    out.push(`Name: ${s.signatory?.trim() || '______________________________'}`);
    out.push('Date: ______________________________');
  }
  return out.join('\n\n');
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(_req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: link } = await dc.userDb.from('crm_drive_forms').select('id,submission_id,folder_id,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!link || link.trashed_at) return notFound('That form is not available');
  const { data: ok } = await dc.admin.rpc('crm_form_can', { p_uid: dc.ctx.userId, p_sub: link.submission_id });
  if (ok !== true) return notFound('That form is not available');

  // Already converted? Open that document (if it is still around and the caller can see it).
  const { data: made } = await dc.admin.from('crm_drive_doc_events').select('doc_id').eq('kind', 'created').eq('detail->>from_form_id', id).order('created_at', { ascending: false }).limit(5);
  for (const m of made ?? []) {
    const { data: prev } = await dc.userDb.from('crm_drive_docs').select(DOC_COLS).eq('id', m.doc_id as string).eq('business_unit', dc.bu).is('trashed_at', null).maybeSingle();
    if (prev) return NextResponse.json({ item: prev, existing: true });
  }

  const { data: sub } = await dc.admin.from('crm_form_submissions').select('title,builder_data,crm_forms(name,form_code)').eq('id', link.submission_id).maybeSingle();
  const cf = sub?.crm_forms as unknown as { name?: string; form_code?: string | null } | Array<{ name?: string; form_code?: string | null }> | null;
  const f = Array.isArray(cf) ? cf[0] : cf;
  const spec = specForForm(f?.form_code, f?.name ?? '');
  const data = sub?.builder_data as LoiPurchaseData | null;
  if (!sub || !spec || !data || !Array.isArray(data.terms)) return NextResponse.json({ error: 'Only a Letter of Intent can be turned into a live document' }, { status: 400 });

  let state: { ystate: string; text: string };
  try { state = markdownToDriveState(loiToMarkdown(data, spec), { letterhead: true }); }
  catch (e) { console.error('[drive] form to doc', e); return NextResponse.json({ error: 'Could not turn this letter into a document' }, { status: 422 }); }

  const title = String(sub.title || spec.title).slice(0, 300);
  const { data: doc, error } = await dc.admin.from('crm_drive_docs').insert({
    business_unit: dc.bu, folder_id: link.folder_id, title, created_by: dc.ctx.userId, updated_by: dc.ctx.userId,
    visibility: 'team', shared_with: [], deal_id: null, ystate: state.ystate, content_text: state.text, version: 1,
  }).select(DOC_COLS).single();
  if (error || !doc) return NextResponse.json({ error: 'Could not create the document' }, { status: 500 });
  await logDocEvent(dc.admin, { docId: doc.id as string, bu: dc.bu, actor: dc.ctx.userId, kind: 'created', detail: { via: 'form', from: title, from_form_id: id } });
  await dc.admin.from('crm_drive_forms').update({ trashed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  return NextResponse.json({ item: doc });
}
