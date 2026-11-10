import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound, forbidden } from '@/lib/crm-auth';
import { driveContext, type DriveContext } from '@/lib/drive-server';
import { logDocEvent } from '@/lib/drive-events';
import { pushBellNotification, senderName } from '@/lib/notify';
import type { DriveComment } from '@/lib/drive-types';

// Comments on a live document: list, add (with @mentions + replies), resolve / reopen, delete.
// Access follows the document: every call first re-reads the doc as the signed-in user (RLS), so anyone who can open it can read
// and write comments and nobody else can. A top-level comment's id is also the id of its highlight mark inside the document.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'id,doc_id,parent_id,author_id,body,mentions,anchor_text,resolved_at,resolved_by,created_at';

async function openDoc(dc: DriveContext, docId: string) {
  if (!UUID_RE.test(docId)) return null;
  const { data } = await dc.userDb.from('crm_drive_docs').select('id,title,business_unit,visibility,shared_with,created_by,deal_id,trashed_at').eq('id', docId).eq('business_unit', dc.bu).maybeSingle();
  return data && !data.trashed_at ? data : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { docId } = await params;
  if (!(await openDoc(dc, docId))) return notFound('That document is not available');
  const { data, error } = await dc.userDb.from('crm_drive_comments').select(COLS).eq('doc_id', docId).order('created_at');
  if (error) return NextResponse.json({ error: 'Could not load comments' }, { status: 500 });
  return NextResponse.json({ comments: (data ?? []) as DriveComment[] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { docId } = await params;
  const doc = await openDoc(dc, docId);
  if (!doc) return notFound('That document is not available');
  const b = await req.json().catch(() => ({})) as { id?: string; body?: string; parent_id?: string | null; anchor_text?: string | null; mentions?: string[] };
  const body = (b.body ?? '').trim().slice(0, 4000);
  if (!body) return NextResponse.json({ error: 'Write a comment first' }, { status: 400 });
  if (b.id && !UUID_RE.test(b.id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let parent: { id: string; author_id: string | null } | null = null;
  if (b.parent_id) {
    if (!UUID_RE.test(b.parent_id)) return NextResponse.json({ error: 'invalid parent' }, { status: 400 });
    const { data: p } = await dc.admin.from('crm_drive_comments').select('id,author_id,parent_id').eq('id', b.parent_id).eq('doc_id', docId).maybeSingle();
    if (!p || p.parent_id) return notFound('That comment is not available'); // replies attach to a top-level comment only
    parent = p;
  }

  // Only people who can actually open this document may be mentioned (otherwise the alert would point at nothing they can see).
  const wanted = Array.from(new Set((b.mentions ?? []).filter(id => UUID_RE.test(id) && id !== dc.ctx.userId))).slice(0, 20);
  const mentions: string[] = [];
  for (const id of wanted) {
    const { data: ok } = await dc.admin.rpc('crm_drive_can', { p_uid: id, p_bu: doc.business_unit, p_vis: doc.visibility, p_shared: doc.shared_with, p_owner: doc.created_by, p_deal: doc.deal_id });
    if (ok === true) mentions.push(id);
  }

  const { data, error } = await dc.admin.from('crm_drive_comments').insert({
    ...(b.id ? { id: b.id } : {}), doc_id: docId, parent_id: parent?.id ?? null, author_id: dc.ctx.userId, body, mentions,
    anchor_text: parent ? null : (b.anchor_text ?? '').trim().slice(0, 500) || null,
  }).select(COLS).single();
  if (error || !data) return NextResponse.json({ error: 'Could not post the comment' }, { status: 500 });

  // Bell + phone alert: the people @mentioned, and the author of the thread being replied to (once each, never yourself).
  const who = await senderName(dc.admin, dc.ctx.userId);
  const title = String(doc.title ?? 'a document');
  const snippet = body.length > 90 ? `${body.slice(0, 90)}…` : body;
  const targets = new Map<string, string>();
  for (const id of mentions) targets.set(id, `@${who} mentioned you in “${title}”: ${snippet}`);
  if (parent?.author_id && parent.author_id !== dc.ctx.userId && !targets.has(parent.author_id)) targets.set(parent.author_id, `${who} replied to your comment in “${title}”: ${snippet}`);
  if (targets.size) {
    const rows = [...targets].map(([recipient_id, message]) => ({ recipient_id, sender_id: dc.ctx.userId, type: 'mention', message, entity_type: 'drive_doc', entity_id: docId }));
    await dc.admin.from('crm_notifications').insert(rows);
    await Promise.all(rows.map(r => pushBellNotification(dc.admin, { recipientId: r.recipient_id, type: 'mention', message: r.message, entityType: 'drive_doc', entityId: docId, tag: `drive-comment-${docId}` })));
  }
  await logDocEvent(dc.admin, { docId, bu: dc.bu, actor: dc.ctx.userId, kind: 'commented', detail: { reply: !!parent, snippet } });
  return NextResponse.json({ comment: data as DriveComment });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { docId } = await params;
  if (!(await openDoc(dc, docId))) return notFound('That document is not available');
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const b = await req.json().catch(() => ({})) as { resolved?: boolean };
  if (typeof b.resolved !== 'boolean') return NextResponse.json({ error: 'resolved required' }, { status: 400 });
  const { data, error } = await dc.admin.from('crm_drive_comments')
    .update(b.resolved ? { resolved_at: new Date().toISOString(), resolved_by: dc.ctx.userId } : { resolved_at: null, resolved_by: null })
    .eq('id', id).eq('doc_id', docId).is('parent_id', null).select(COLS).maybeSingle();
  if (error || !data) return notFound('That comment is not available');
  await logDocEvent(dc.admin, { docId, bu: dc.bu, actor: dc.ctx.userId, kind: 'commented', detail: { resolved: b.resolved } });
  return NextResponse.json({ comment: data as DriveComment });
}

/** A row / column was inserted or deleted in a sheet: move that tab's cell-comment anchors with their cells (a comment whose row / column was deleted is resolved). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { docId } = await params;
  if (!(await openDoc(dc, docId))) return notFound('That document is not available');
  const b = await req.json().catch(() => ({})) as { tabId?: string; axis?: string; at?: number; delta?: number; swap?: [number, number] };
  // Two neighbouring rows / columns traded places (Alt+arrows, drag): their comments trade places too.
  if (b.swap && b.tabId && (b.axis === 'row' || b.axis === 'col') && b.swap.length === 2 && b.swap.every(n => Number.isInteger(n) && n >= 0)) {
    const [x, y] = b.swap;
    const { data: cs } = await dc.admin.from('crm_drive_comments').select('id,anchor_text').eq('doc_id', docId).is('parent_id', null).like('anchor_text', 'cell|%');
    for (const c of cs ?? []) {
      const [, tab, r, col, ...rest] = String(c.anchor_text).split('|');
      if (tab !== b.tabId) continue;
      const idx = Number(b.axis === 'row' ? r : col);
      const n = idx === x ? y : idx === y ? x : null; if (n === null) continue;
      await dc.admin.from('crm_drive_comments').update({ anchor_text: ['cell', tab, b.axis === 'row' ? n : r, b.axis === 'col' ? n : col, ...rest].join('|') }).eq('id', c.id);
    }
    return NextResponse.json({ ok: true });
  }
  const at = Number(b.at), delta = Number(b.delta);
  if (!b.tabId || (b.axis !== 'row' && b.axis !== 'col') || !Number.isInteger(at) || at < 0 || (delta !== 1 && delta !== -1)) return NextResponse.json({ error: 'invalid shift' }, { status: 400 });
  const { data } = await dc.admin.from('crm_drive_comments').select('id,anchor_text,resolved_at').eq('doc_id', docId).is('parent_id', null).like('anchor_text', 'cell|%');
  let moved = 0;
  for (const c of data ?? []) {
    const [, tab, r, col, ...rest] = String(c.anchor_text).split('|');
    if (tab !== b.tabId) continue;
    const idx = Number(b.axis === 'row' ? r : col);
    if (!Number.isFinite(idx) || idx < at) continue;
    if (delta === -1 && idx === at) { await dc.admin.from('crm_drive_comments').update({ resolved_at: c.resolved_at ?? new Date().toISOString(), resolved_by: dc.ctx.userId }).eq('id', c.id); moved++; continue; }
    const n = idx + delta;
    await dc.admin.from('crm_drive_comments').update({ anchor_text: ['cell', tab, b.axis === 'row' ? n : r, b.axis === 'col' ? n : col, ...rest].join('|') }).eq('id', c.id); moved++;
  }
  return NextResponse.json({ moved });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { docId } = await params;
  if (!(await openDoc(dc, docId))) return notFound('That document is not available');
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const { data: c } = await dc.admin.from('crm_drive_comments').select('id,author_id').eq('id', id).eq('doc_id', docId).maybeSingle();
  if (!c) return notFound('That comment is not available');
  if (c.author_id !== dc.ctx.userId && !dc.isAdmin) return forbidden('You can only delete your own comments');
  const { error } = await dc.admin.from('crm_drive_comments').delete().eq('id', id); // replies go with it
  if (error) return NextResponse.json({ error: 'Could not delete the comment' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
