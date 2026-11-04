import { NextRequest, NextResponse } from 'next/server';
import * as Y from 'yjs';
import { unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { driveContext, mergeYState, stripCommentMarks } from '@/lib/drive-server';
import { fillMergeFields } from '@/lib/drive-edit';
import { jsonToDriveState } from '@/lib/drive-markdown';
import { logDocEvent, mirrorDocToFeeds } from '@/lib/drive-events';
import { DOC_COLS } from '@/lib/drive-types';

// "＋ New document" on a deal's Docs tab or a contact card: a new LIVE document, already linked to that card, blank or from a template.
//   POST { source: 'deal' | 'client', id, template_id? }
// A template's {{client}} {{property}} {{deal_type}} {{stage}} {{contact_name}} {{company}} {{email}} {{phone}} {{agent}} {{agent_email}}
// {{office_phone}} {{date}} placeholders are filled from the card (anything unknown for this card becomes a blank ____). The document starts
// PRIVATE for an agent (the card link is what gives the card's people access) and with the CRECO letterhead.

export const maxDuration = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const b = await req.json().catch(() => ({})) as { source?: string; id?: string; template_id?: string };
  if ((b.source !== 'deal' && b.source !== 'client') || !b.id || !UUID_RE.test(b.id)) return NextResponse.json({ error: 'source (deal or client) and id are required' }, { status: 400 });
  if (b.template_id && !UUID_RE.test(b.template_id)) return NextResponse.json({ error: 'invalid template' }, { status: 400 });

  // Same rule as opening the card (deal: on the deal; contact: workspace, held lead only for its owner / the super admin).
  if (!(await assertOwnsResource(b.source === 'deal' ? 'crm_deals' : 'crm_clients', b.id, dc.ctx))) return notFound('That card is not available');
  if (b.source === 'client' && dc.ctx.role !== 'super_admin') {
    const { data: c } = await dc.admin.from('crm_clients').select('lead_hold,agent_id').eq('id', b.id).maybeSingle();
    if (c?.lead_hold && c.agent_id !== dc.ctx.userId) return notFound('That card is not available');
  }

  // What the placeholders say, and how the card is named.
  const { data: me } = await dc.admin.from('crm_profiles').select('first_name,last_name,email').eq('id', dc.ctx.userId).maybeSingle();
  const values: Record<string, string> = {
    agent: [me?.first_name, me?.last_name].filter(Boolean).join(' '), agent_email: String(me?.email ?? ''), office_phone: '(210) 817-3443',
    date: new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric' }),
    client: '', property: '', deal_type: '', stage: '', contact_name: '', company: '', email: '', phone: '',
  };
  let label = 'this card';
  if (b.source === 'deal') {
    const { data: d } = await dc.admin.from('crm_deals').select('client,client_email,client_phone,property,type,stage').eq('id', b.id).maybeSingle();
    Object.assign(values, { client: d?.client ?? '', contact_name: d?.client ?? '', email: d?.client_email ?? '', phone: d?.client_phone ?? '', property: d?.property ?? '', deal_type: d?.type ?? '', stage: d?.stage ?? '' });
    label = [d?.client, d?.property].filter(Boolean).join(' · ') || 'this deal';
  } else {
    const { data: c } = await dc.admin.from('crm_clients').select('first_name,last_name,business_name,email,phone').eq('id', b.id).maybeSingle();
    const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ');
    Object.assign(values, { client: name || c?.business_name || '', contact_name: name, company: c?.business_name ?? '', email: c?.email ?? '', phone: c?.phone ?? '' });
    label = [name, c?.business_name].filter(Boolean).join(' · ') || 'this contact';
  }

  // The document: a filled template, or a blank page.
  let title = `${b.source === 'deal' ? 'Deal notes' : 'Notes'} — ${label}`;
  let state: { ystate: string; text: string };
  let from = 'blank';
  if (b.template_id) {
    const { data: tpl } = await dc.userDb.from('crm_drive_docs').select('id,title,ystate,is_template,trashed_at').eq('id', b.template_id).eq('business_unit', dc.bu).maybeSingle();
    if (!tpl || !tpl.is_template || tpl.trashed_at) return notFound('That template is not available');
    const ydoc = new Y.Doc();
    try {
      if (tpl.ystate) Y.applyUpdate(ydoc, new Uint8Array(Buffer.from(stripCommentMarks(tpl.ystate as string), 'base64')));
      fillMergeFields(ydoc, values);
      const merged = mergeYState(null, Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64'));
      state = { ystate: merged.state, text: merged.text };
    } finally { ydoc.destroy(); }
    title = `${tpl.title} — ${label}`;
    from = String(tpl.title);
  } else {
    state = jsonToDriveState({ type: 'doc', content: [{ type: 'paragraph' }] }, { letterhead: true });
  }

  const { data: doc, error } = await dc.admin.from('crm_drive_docs').insert({
    business_unit: dc.bu, folder_id: null, title: title.slice(0, 300), created_by: dc.ctx.userId, updated_by: dc.ctx.userId,
    visibility: dc.ctx.role === 'agent' ? 'private' : 'team', shared_with: [], deal_id: null, ystate: state.ystate, content_text: state.text, version: 1,
  }).select(DOC_COLS).single();
  if (error || !doc) return NextResponse.json({ error: 'Could not create the document' }, { status: 500 });

  const col = b.source === 'deal' ? 'deal_id' : 'client_id';
  await dc.admin.from('crm_drive_doc_links').insert({ doc_id: doc.id, [col]: b.id, business_unit: dc.bu, created_by: dc.ctx.userId });
  await logDocEvent(dc.admin, { docId: doc.id as string, bu: dc.bu, actor: dc.ctx.userId, kind: 'created', detail: { via: 'card', from, label } });
  await logDocEvent(dc.admin, { docId: doc.id as string, bu: dc.bu, actor: dc.ctx.userId, kind: 'linked', detail: { kind: b.source === 'deal' ? 'deal' : 'client', label } });
  await mirrorDocToFeeds(dc.admin, { docId: doc.id as string, actor: dc.ctx.userId, only: b.source === 'deal' ? { dealId: b.id } : { clientId: b.id }, text: (t, who) => `Live document “${t}” created from this card by ${who}` });
  return NextResponse.json({ item: doc });
}
