import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { docxToDocJson, textToDocJson } from '@/lib/docx-to-doc';
import { jsonToDriveState } from '@/lib/drive-markdown';
import { logDocEvent, mirrorDocToFeeds } from '@/lib/drive-events';
import { DOC_COLS } from '@/lib/drive-types';
import { parseCsv, sheetStateFromTabs, MAX_COLS, MAX_ROWS, type ImportTab } from '@/lib/drive-sheet';
import { xlsxToTabs } from '@/lib/xlsx-import';

// "Edit as a live document" for a Word (.docx) / text (.txt) file — or an Excel (.xlsx / .xls) / CSV file, which becomes a live SHEET (columns can be
// dragged into a new order there) — that sits on a DEAL's Docs tab or a CONTACT's Files:
//   POST { source: 'deal' | 'client', id }   (id = the crm_deal_docs / crm_client_docs row)
// Makes a live My Drive document from it and LINKS it to the same deal / contact, so it shows on the card as a live document that
// everyone who can open the card can edit. The uploaded file stays as it is, and a file is converted once (asking again returns the
// same document). The new document starts PRIVATE for an agent (the card link is what gives the card's people access).

export const maxDuration = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const b = await req.json().catch(() => ({})) as { source?: string; id?: string };
  if ((b.source !== 'deal' && b.source !== 'client') || !b.id || !UUID_RE.test(b.id)) return NextResponse.json({ error: 'source (deal or client) and id are required' }, { status: 400 });

  const table = b.source === 'deal' ? 'crm_deal_docs' : 'crm_client_docs';
  const { data: row } = await dc.admin.from(table).select('*').eq('id', b.id).maybeSingle();
  if (!row) return notFound('That file is not available');
  const cardKey = b.source === 'deal' ? 'deal_id' : 'client_id';
  const cardId = row[cardKey] as string;
  // The same rule as opening the card (deal: on the deal; contact: workspace, held lead only for its owner / the super admin).
  if (!(await assertOwnsResource(b.source === 'deal' ? 'crm_deals' : 'crm_clients', cardId, dc.ctx))) return notFound('That file is not available');
  if (b.source === 'client' && dc.ctx.role !== 'super_admin') {
    const { data: c } = await dc.admin.from('crm_clients').select('lead_hold,agent_id').eq('id', cardId).maybeSingle();
    if (c?.lead_hold && c.agent_id !== dc.ctx.userId) return notFound('That file is not available');
  }

  const name = String(row.name ?? '');
  const isDocx = /\.docx$/i.test(name), isTxt = /\.txt$/i.test(name);
  const isCsv = /\.csv$/i.test(name), isXlsx = /\.(xlsx|xlsm)$/i.test(name), isXls = /\.xls$/i.test(name);
  const isSheet = isCsv || isXlsx || isXls;
  if (!isDocx && !isTxt && !isSheet) return NextResponse.json({ error: /\.(doc|rtf)$/i.test(name) ? 'Older Word (.doc) files can’t be edited here — open it in Word, choose Save As → Word Document (.docx), and upload that' : 'Only Word (.docx), text (.txt), Excel (.xlsx / .xls) and CSV files can be turned into an editable document' }, { status: 400 });
  if (Number(row.file_size) > MAX_BYTES) return NextResponse.json({ error: 'That file is too large to convert (10 MB max)' }, { status: 413 });

  const key = `${b.source}:${b.id}`;
  const link = async (docId: string) => {
    const col = b.source === 'deal' ? 'deal_id' : 'client_id';
    const { data: have } = await dc.admin.from('crm_drive_doc_links').select('id').eq('doc_id', docId).eq(col, cardId).maybeSingle();
    if (have) return;
    await dc.admin.from('crm_drive_doc_links').insert({ doc_id: docId, [col]: cardId, business_unit: dc.bu, created_by: dc.ctx.userId });
    await logDocEvent(dc.admin, { docId, bu: dc.bu, actor: dc.ctx.userId, kind: 'linked', detail: { kind: b.source === 'deal' ? 'deal' : 'client', label: 'this card' } });
    await mirrorDocToFeeds(dc.admin, { docId, actor: dc.ctx.userId, only: b.source === 'deal' ? { dealId: cardId } : { clientId: cardId }, text: (title, who) => `Live document “${title}” made from the uploaded file by ${who}` });
  };

  // Already converted? Reuse it (and make sure it is linked here).
  const { data: made } = await dc.admin.from('crm_drive_doc_events').select('doc_id').eq('kind', 'created').eq('detail->>from_card_doc_id', key).order('created_at', { ascending: false }).limit(5);
  for (const m of made ?? []) {
    const { data: prev } = await dc.admin.from('crm_drive_docs').select(DOC_COLS).eq('id', m.doc_id as string).is('trashed_at', null).maybeSingle();
    if (prev) { await link(prev.id as string); return NextResponse.json({ item: prev, existing: true }); }
  }

  const { data: blob } = await dc.admin.storage.from('deal-docs').download(row.storage_path as string);
  if (!blob) return NextResponse.json({ error: 'Could not read that file' }, { status: 500 });
  let state: { ystate: string; text: string };
  try {
    const buf = Buffer.from(await blob.arrayBuffer());
    if (isSheet) {
      if (isCsv) state = sheetStateFromTabs([{ name: 'Sheet1', grid: parseCsv(buf.toString('utf8')), frozen: 1 }]);
      else if (isXls) state = sheetStateFromTabs(await xlsToTabs(buf));   // old binary Excel: values only (no colours / borders)
      else state = sheetStateFromTabs(await xlsxToTabs(buf));             // keeps how it looks: fills, fonts, borders, widths, merges
    } else {
      const json = isDocx ? (await docxToDocJson(buf)).json : textToDocJson(buf.toString('utf8'));
      state = jsonToDriveState(json, { letterhead: true });
    }
  } catch (e) {
    console.error('[drive] card doc convert', e);
    return NextResponse.json({ error: 'Could not read that file — it may be damaged or password protected' }, { status: 422 });
  }
  if (!state.text.trim()) return NextResponse.json({ error: 'That file has no readable text to edit' }, { status: 422 });

  const { data: doc, error } = await dc.admin.from('crm_drive_docs').insert({
    business_unit: dc.bu, folder_id: null, title: name.replace(/\.(docx|txt|xlsx|xlsm|xls|csv)$/i, '').slice(0, 300), created_by: dc.ctx.userId, updated_by: dc.ctx.userId,
    visibility: dc.ctx.role === 'agent' ? 'private' : 'team', shared_with: [], deal_id: null, ystate: state.ystate, content_text: state.text, version: 1, ...(isSheet ? { kind: 'sheet' } : {}),
  }).select(DOC_COLS).single();
  if (error || !doc) return NextResponse.json({ error: 'Could not create the document' }, { status: 500 });
  await logDocEvent(dc.admin, { docId: doc.id as string, bu: dc.bu, actor: dc.ctx.userId, kind: 'created', detail: { via: isSheet ? 'sheet' : isDocx ? 'word' : 'text', from: name, from_card_doc_id: key } });
  await link(doc.id as string);
  return NextResponse.json({ item: doc });
}

// The old binary Excel format (.xls) read with SheetJS: every sheet's values as the cells show them (formatting isn't carried over).
async function xlsToTabs(buf: Buffer): Promise<ImportTab[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  return wb.SheetNames.slice(0, 20).map(n => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: true }) as unknown[][];
    const grid = rows.slice(0, MAX_ROWS).map(r => r.slice(0, MAX_COLS).map(c => (c == null ? '' : String(c))));
    return { name: n, grid: grid.length ? grid : [['']], frozen: 1 };
  });
}
