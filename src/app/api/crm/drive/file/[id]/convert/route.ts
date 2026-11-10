import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { docxToDocJson, textToDocJson } from '@/lib/docx-to-doc';
import { jsonToDriveState } from '@/lib/drive-markdown';
import { logDocEvent } from '@/lib/drive-events';
import { DOC_COLS } from '@/lib/drive-types';
import { parseCsv, sheetStateFromTabs } from '@/lib/drive-sheet';
import { xlsxToTabs, xlsToTabs, withHeaderRow } from '@/lib/xlsx-import';

// "Edit as a live document": turns an uploaded Word (.docx) or plain-text (.txt) file into a NEW live My Drive document (same folder, same sharing), so it
// can be edited together like any other document. The uploaded file is left exactly as it is, and a file is converted ONCE: asking again
// opens the document made the first time (so nobody ends up with copies). Text, headings, lists, tables and basic
// formatting come across; pictures and Word's own page headers / footers don't (the CRECO letterhead is a switch on the document).

export const maxDuration = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: f } = await dc.userDb.from('crm_drive_files').select('id,name,mime,size,storage_path,folder_id,visibility,shared_with,deal_id,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!f || f.trashed_at) return notFound('That file is not available');
  const isDocx = /\.docx$/i.test(String(f.name)), isTxt = /\.txt$/i.test(String(f.name));
  const isCsv = /\.csv$/i.test(String(f.name)), isXlsx = /\.(xlsx|xlsm)$/i.test(String(f.name)), isXls = /\.xls$/i.test(String(f.name));
  const isSheet = isCsv || isXlsx || isXls;
  if (!isDocx && !isTxt && !isSheet) return NextResponse.json({ error: /\.(doc|rtf)$/i.test(String(f.name)) ? 'Older Word (.doc) files can’t be edited here — open it in Word, choose Save As → Word Document (.docx), and upload that' : 'Only Word (.docx), text (.txt), CSV and Excel (.xlsx / .xls) files can be turned into an editable document' }, { status: 400 });
  if (Number(f.size) > MAX_BYTES) return NextResponse.json({ error: 'That file is too large to convert (10 MB max)' }, { status: 413 });

  // Already converted? Open that document (if it is still around and the caller can see it).
  const { data: made } = await dc.admin.from('crm_drive_doc_events').select('doc_id').eq('kind', 'created').eq('detail->>from_file_id', id).order('created_at', { ascending: false }).limit(5);
  for (const m of made ?? []) {
    const { data: prev } = await dc.userDb.from('crm_drive_docs').select(DOC_COLS).eq('id', m.doc_id as string).eq('business_unit', dc.bu).is('trashed_at', null).maybeSingle();
    if (prev) return NextResponse.json({ item: prev, existing: true });
  }

  const { data: blob } = await dc.admin.storage.from('drive-files').download(f.storage_path as string);
  if (!blob) return NextResponse.json({ error: 'Could not read that file' }, { status: 500 });
  let state: { ystate: string; text: string };
  try {
    const buf = Buffer.from(await blob.arrayBuffer());
    if (isSheet) {
      if (isCsv) state = sheetStateFromTabs([{ name: 'Sheet1', grid: parseCsv(buf.toString('utf8')), frozen: 1 }]);
      else if (isXls) state = sheetStateFromTabs(withHeaderRow(await xlsToTabs(buf)));   // old binary Excel: values only
      else state = sheetStateFromTabs(withHeaderRow(await xlsxToTabs(buf)));
    } else {
      const json = isDocx ? (await docxToDocJson(buf)).json : textToDocJson(buf.toString('utf8'));
      state = jsonToDriveState(json, { letterhead: true });   // CRECO letterhead on (the switch is in the editor)
    }
  } catch (e) {
    console.error('[drive] convert', e);
    return NextResponse.json({ error: 'Could not read that file — it may be damaged or password protected' }, { status: 422 });
  }
  if (!state.text.trim()) return NextResponse.json({ error: 'That file has nothing readable to edit' }, { status: 422 });

  const title = String(f.name).replace(/\.(docx|csv|xlsx|xlsm|xls)$/i, '').slice(0, 300);
  const { data: doc, error } = await dc.admin.from('crm_drive_docs').insert({
    business_unit: dc.bu, folder_id: f.folder_id, title, created_by: dc.ctx.userId, updated_by: dc.ctx.userId,
    visibility: f.visibility, shared_with: f.shared_with ?? [], deal_id: f.deal_id, ystate: state.ystate, content_text: state.text, version: 1, ...(isSheet ? { kind: 'sheet' } : {}),
  }).select(DOC_COLS).single();
  if (error || !doc) return NextResponse.json({ error: 'Could not create the document' }, { status: 500 });
  await logDocEvent(dc.admin, { docId: doc.id as string, bu: dc.bu, actor: dc.ctx.userId, kind: 'created', detail: { via: isSheet ? 'sheet' : isDocx ? 'word' : 'text', from: f.name, from_file_id: id } });
  return NextResponse.json({ item: doc });
}
