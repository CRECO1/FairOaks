import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound, forbidden, assertOwnsResource } from '@/lib/crm-auth';
import { driveContext, type DriveContext } from '@/lib/drive-server';
import { logDocEvent, mirrorDocToFeeds } from '@/lib/drive-events';

// A Drive document shown on a deal card or a contact card AS ITSELF (live — not a PDF copy).
//   GET    ?deal_id= | ?client_id=  → the live documents on that card (the caller must be able to open the card)
//   GET    ?doc_id=                 → where a document is linked (the caller must be able to open the document)
//   POST   { doc_id, deal_id | client_id }  → link it (the caller must see both the document and the card)
//   DELETE ?id=<link id>            → unlink (whoever linked it, the document's owner, or an admin)
// Anyone who can open the card can then open the document (crm_drive_linked_ok in the database), so linking is a sharing decision.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Can the caller open this deal / contact card? (Same rule as the card itself; a held lead is only for its owner and the super admin.) */
async function canOpenCard(dc: DriveContext, kind: 'deal' | 'client', id: string): Promise<boolean> {
  const row = await assertOwnsResource(kind === 'deal' ? 'crm_deals' : 'crm_clients', id, dc.ctx);
  if (!row) return false;
  if (kind === 'client' && dc.ctx.role !== 'super_admin') {
    const { data: c } = await dc.admin.from('crm_clients').select('lead_hold,agent_id').eq('id', id).maybeSingle();
    if (c?.lead_hold && c.agent_id !== dc.ctx.userId) return false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const dealId = sp.get('deal_id'), clientId = sp.get('client_id'), docId = sp.get('doc_id');

  if (docId) {
    if (!UUID_RE.test(docId)) return notFound();
    const { data: seen } = await dc.userDb.from('crm_drive_docs').select('id').eq('id', docId).eq('business_unit', dc.bu).maybeSingle();
    if (!seen) return notFound('That document is not available');
    const { data: links } = await dc.admin.from('crm_drive_doc_links').select('id,deal_id,client_id,created_by,created_at').eq('doc_id', docId).order('created_at');
    const out: Array<{ id: string; kind: 'deal' | 'client'; target_id: string; label: string; created_by: string | null; created_at: string; can_open: boolean }> = [];
    for (const l of links ?? []) {
      const kind = l.deal_id ? 'deal' : 'client';
      const tid = (l.deal_id ?? l.client_id) as string;
      const can = await canOpenCard(dc, kind, tid);
      let label = kind === 'deal' ? 'A deal' : 'A contact';
      if (can) {
        if (kind === 'deal') { const { data: d } = await dc.admin.from('crm_deals').select('client,property').eq('id', tid).maybeSingle(); label = [d?.client, d?.property].filter(Boolean).join(' · ') || 'Deal'; }
        else { const { data: c } = await dc.admin.from('crm_clients').select('first_name,last_name,business_name').eq('id', tid).maybeSingle(); label = [[c?.first_name, c?.last_name].filter(Boolean).join(' '), c?.business_name].filter(Boolean).join(' · ') || 'Contact'; }
      }
      out.push({ id: l.id as string, kind, target_id: can ? tid : '', label, created_by: l.created_by as string | null, created_at: l.created_at as string, can_open: can });
    }
    return NextResponse.json({ links: out });
  }

  const kind = dealId ? 'deal' : clientId ? 'client' : null;
  const cardId = dealId ?? clientId ?? '';
  if (!kind || !UUID_RE.test(cardId)) return NextResponse.json({ error: 'deal_id, client_id or doc_id required' }, { status: 400 });
  if (!(await canOpenCard(dc, kind, cardId))) return notFound('Not found');
  const { data: links } = await dc.admin.from('crm_drive_doc_links').select('id,doc_id,created_by,created_at').eq(kind === 'deal' ? 'deal_id' : 'client_id', cardId).order('created_at', { ascending: false });
  const ids = (links ?? []).map(l => l.doc_id as string);
  const { data: docs } = ids.length ? await dc.admin.from('crm_drive_docs').select('id,title,updated_at,updated_by,version,kind').in('id', ids).is('trashed_at', null) : { data: [] };
  const byId = new Map((docs ?? []).map(d => [d.id as string, d]));
  return NextResponse.json({
    links: (links ?? []).filter(l => byId.has(l.doc_id as string)).map(l => {
      const d = byId.get(l.doc_id as string)!;
      return { id: l.id, doc_id: l.doc_id, title: d.title, kind: d.kind, updated_at: d.updated_at, updated_by: d.updated_by, linked_by: l.created_by, linked_at: l.created_at };
    }),
  });
}

export async function POST(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const b = await req.json().catch(() => ({})) as { doc_id?: string; deal_id?: string; client_id?: string };
  const kind = b.deal_id ? 'deal' : b.client_id ? 'client' : null;
  const cardId = b.deal_id ?? b.client_id ?? '';
  if (!b.doc_id || !UUID_RE.test(b.doc_id) || !kind || !UUID_RE.test(cardId)) return NextResponse.json({ error: 'doc_id and a deal_id or client_id are required' }, { status: 400 });
  const { data: doc } = await dc.userDb.from('crm_drive_docs').select('id,title,trashed_at,is_template,visibility,created_by').eq('id', b.doc_id).eq('business_unit', dc.bu).maybeSingle();
  if (!doc || doc.trashed_at) return notFound('That document is not available');
  // Linking shows the document to everyone who can open that deal or contact, so a private document can only be linked by its owner or an admin.
  if (doc.visibility === 'private' && !dc.isAdmin && doc.created_by !== dc.ctx.userId) return forbidden('Only the owner or an admin can link a private document');
  if (doc.is_template) return NextResponse.json({ error: 'A template can’t be linked — make a document from it first' }, { status: 400 });
  if (!(await canOpenCard(dc, kind, cardId))) return notFound('That deal or contact is not available');

  const col = kind === 'deal' ? 'deal_id' : 'client_id';
  const { data: have } = await dc.admin.from('crm_drive_doc_links').select('id').eq('doc_id', b.doc_id).eq(col, cardId).maybeSingle();
  if (have) return NextResponse.json({ ok: true, id: have.id, already: true });
  const { data, error } = await dc.admin.from('crm_drive_doc_links').insert({ doc_id: b.doc_id, [col]: cardId, business_unit: dc.bu, created_by: dc.ctx.userId }).select('id').single();
  if (error || !data) return NextResponse.json({ error: 'Could not link it' }, { status: 500 });

  let label = kind === 'deal' ? 'a deal' : 'a contact';
  if (kind === 'deal') { const { data: d } = await dc.admin.from('crm_deals').select('client,property').eq('id', cardId).maybeSingle(); label = [d?.client, d?.property].filter(Boolean).join(' · ') || label; }
  else { const { data: c } = await dc.admin.from('crm_clients').select('first_name,last_name,business_name').eq('id', cardId).maybeSingle(); label = [[c?.first_name, c?.last_name].filter(Boolean).join(' '), c?.business_name].filter(Boolean).join(' · ') || label; }
  await logDocEvent(dc.admin, { docId: b.doc_id, bu: dc.bu, actor: dc.ctx.userId, kind: 'linked', detail: { kind, label } });
  await mirrorDocToFeeds(dc.admin, { docId: b.doc_id, actor: dc.ctx.userId, only: kind === 'deal' ? { dealId: cardId } : { clientId: cardId }, text: (title, who) => `Live document “${title}” linked from My Drive by ${who}` });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { data: l } = await dc.admin.from('crm_drive_doc_links').select('id,doc_id,deal_id,client_id,created_by').eq('id', id).maybeSingle();
  if (!l) return notFound('Not found');
  const { data: doc } = await dc.admin.from('crm_drive_docs').select('created_by').eq('id', l.doc_id).maybeSingle();
  const kind = l.deal_id ? 'deal' : 'client';
  if (!(await canOpenCard(dc, kind, (l.deal_id ?? l.client_id) as string))) return notFound('Not found');
  if (!(dc.isAdmin || l.created_by === dc.ctx.userId || doc?.created_by === dc.ctx.userId)) return forbidden('Only the person who linked it, the document’s owner or an admin can unlink it');
  await mirrorDocToFeeds(dc.admin, { docId: l.doc_id as string, actor: dc.ctx.userId, only: l.deal_id ? { dealId: l.deal_id as string } : { clientId: l.client_id as string }, text: (title, who) => `Live document “${title}” removed from this card by ${who}` });
  await dc.admin.from('crm_drive_doc_links').delete().eq('id', id);
  await logDocEvent(dc.admin, { docId: l.doc_id as string, bu: dc.bu, actor: dc.ctx.userId, kind: 'unlinked', detail: { kind } });
  return NextResponse.json({ ok: true });
}
