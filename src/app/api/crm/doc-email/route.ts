import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { escapeLike } from '@/lib/like-escape';
import { gmailSignatureBlock } from '@/lib/agent-signature';
import { POST as gmailSend } from '@/app/api/gmail/send/route';

// "Email as attachment" for any document the CRM files in crm_form_submissions (LOI, lease,
// any Transaction Docs form). GET builds the prefill (To / subject / body / signature);
// POST attaches the filled PDF server-side and sends it through the normal Gmail send route,
// which logs it on the deal's emails. The contact's activity feed gets a line from here.

const MAX_PDF_BYTES = 20 * 1024 * 1024;

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plainFromHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

type Ctx = NonNullable<Awaited<ReturnType<typeof getCrmContext>>>;

interface Loaded {
  unit: string | null; // the document's workspace
  sub: { id: string; title: string | null; filled_path: string | null; deal_id: string | null; client_id: string | null; listing_id: string | null; builder_data: unknown; crm_forms: { name?: string } | null };
  deal: { id: string; client_id: string | null; client: string | null; client_email: string | null; property: string | null } | null;
  clientRow: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null;
}

async function load(id: string, ctx: Ctx): Promise<Loaded | null> {
  const owned = await assertOwnsResource('crm_form_submissions', id, ctx);
  if (!owned) return null;
  const db = adminClient();
  const { data: sub } = await db.from('crm_form_submissions')
    .select('id, title, filled_path, deal_id, client_id, listing_id, builder_data, crm_forms(name)').eq('id', id).maybeSingle();
  if (!sub) return null;
  let deal: Loaded['deal'] = null;
  if (sub.deal_id) {
    // assertOwnsResource also enforces private (restricted) deals: owner, assigned agents, super_admin.
    if (!(await assertOwnsResource('crm_deals', sub.deal_id as string, ctx))) return null;
    const { data } = await db.from('crm_deals').select('id, client_id, client, client_email, property').eq('id', sub.deal_id).maybeSingle();
    deal = (data as Loaded['deal']) ?? null;
  }
  const clientId = (sub.client_id as string | null) ?? deal?.client_id ?? null;
  let clientRow: Loaded['clientRow'] = null;
  if (clientId) {
    const { data } = await db.from('crm_clients').select('id, first_name, last_name, email').eq('id', clientId).maybeSingle();
    clientRow = (data as Loaded['clientRow']) ?? null;
  }
  return { unit: (owned.business_unit as string | null) ?? null, sub: sub as unknown as Loaded['sub'], deal, clientRow };
}

async function agentProfile(userId: string) {
  const { data } = await adminClient().from('crm_profiles').select('first_name, last_name, email_signature').eq('id', userId).maybeSingle();
  return {
    name: `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim(),
    signature: (data?.email_signature as string | null) ?? '',
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('submission_id');
  if (!id) return NextResponse.json({ error: 'submission_id required' }, { status: 400 });
  const l = await load(id, ctx);
  if (!l) return notFound('Document not found');
  if (!l.sub.filled_path) return NextResponse.json({ error: 'This document has no saved PDF yet — open it, fill it, and save first.' }, { status: 400 });

  const db = adminClient();
  const { data: file } = await db.storage.from('transaction-forms').list(l.sub.filled_path.split('/').slice(0, -1).join('/'), { search: l.sub.filled_path.split('/').pop() });
  const sizeBytes = (file?.find(f => f.name === l.sub.filled_path!.split('/').pop())?.metadata as { size?: number } | undefined)?.size ?? null;

  const docTitle = (l.sub.title || l.sub.crm_forms?.name || 'Document').trim();
  const property = (l.deal?.property || '').trim();
  const to = (l.clientRow?.email || l.deal?.client_email || '').trim();
  const first = (l.clientRow?.first_name || (l.deal?.client || '').split(/\s+/)[0] || '').trim();
  const me = await agentProfile(ctx.userId);

  const bd = l.sub.builder_data as { terms?: { label?: string; value?: string }[]; reLine?: string } | null;
  const terms = (bd?.terms ?? []).filter(t => t && (t.label || '').trim() && (t.value || '').trim());
  let body = `<p>${first ? `Hi ${esc(first)},` : 'Hello,'}</p>`;
  if (terms.length) {
    body += `<p>Attached is the ${esc(docTitle)}${property ? ` for ${esc(property)}` : ''}${/[.!?]$/.test(property) ? '' : '.'} The key terms:</p><ul>`
      + terms.map(t => `<li><strong>${esc((t.label || '').replace(/:\s*$/, ''))}:</strong> ${esc((t.value || '').replace(/\s*\n+\s*/g, '; '))}</li>`).join('')
      + '</ul><p>Let me know if you have any questions or would like to discuss.</p>';
  } else {
    body += `<p>Please find the ${esc(docTitle)}${property ? ` for ${esc(property)}` : ''} attached. Let me know if you have any questions.</p>`;
  }
  body += me.signature ? gmailSignatureBlock(me.signature) : (me.name ? `<p>Thank you,<br/>${esc(me.name)}</p>` : '');

  return NextResponse.json({
    to,
    toName: [l.clientRow?.first_name, l.clientRow?.last_name].filter(Boolean).join(' ') || l.deal?.client || '',
    subject: property ? `${docTitle} – ${property}` : docTitle,
    body,
    fileName: `${docTitle.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`,
    sizeBytes,
    hasContact: !!(l.sub.deal_id || l.clientRow),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { submission_id, to, subject, body } = await req.json().catch(() => ({}));
  if (!submission_id || !to || !subject || !body) return NextResponse.json({ error: 'submission_id, to, subject and body are required' }, { status: 400 });
  // One or more addresses, separated by commas or semicolons.
  const addrs = String(to).split(/[,;]+/).map(a => a.trim()).filter(Boolean);
  if (!addrs.length || addrs.length > 10 || !addrs.every(a => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(a))) return NextResponse.json({ error: 'Enter valid email addresses, separated by commas' }, { status: 400 });
  const toClean = addrs.join(', ');
  const l = await load(submission_id, ctx);
  if (!l) return notFound('Document not found');
  if (!l.sub.filled_path) return NextResponse.json({ error: 'This document has no saved PDF yet.' }, { status: 400 });

  const db = adminClient();
  // Gmail logging needs a deal or a contact. A property-only document goes to a contact if the address matches one.
  let clientId = l.clientRow?.id ?? null;
  if (!l.sub.deal_id && !clientId) {
    let cq = db.from('crm_clients').select('id').ilike('email', escapeLike(addrs[0]));
    if (l.unit) cq = cq.eq('business_unit', l.unit);
    const { data } = await cq.limit(1).maybeSingle();
    clientId = (data?.id as string | undefined) ?? null;
    if (!clientId) return NextResponse.json({ error: 'This document is not linked to a deal or contact, and that address is not a saved contact — add the recipient as a contact first so the email can be logged.' }, { status: 400 });
  }

  const { data: blob, error: dlErr } = await db.storage.from('transaction-forms').download(l.sub.filled_path);
  if (dlErr || !blob) return NextResponse.json({ error: 'Could not read the PDF from storage' }, { status: 500 });
  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) return NextResponse.json({ error: `The PDF is ${(buf.length / 1048576).toFixed(1)} MB — too large to email (limit 20 MB). Use e-signature or share a link instead.` }, { status: 413 });

  const docTitle = (l.sub.title || l.sub.crm_forms?.name || 'Document').trim();
  const me = await agentProfile(ctx.userId);

  // Call the Gmail send handler in-process (no HTTP hop): it does auth, the duplicate-send guard,
  // the MIME build, the Gmail call and the crm_deal_emails log.
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const h of ['authorization', 'cookie']) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  const inner = new NextRequest(new URL('/api/gmail/send', req.nextUrl.origin), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      userId: ctx.userId,
      ...(l.sub.deal_id ? { dealId: l.sub.deal_id } : {}),
      ...(clientId ? { clientId } : {}),
      to: toClean,
      subject: String(subject),
      body: String(body),
      agentName: me.name || undefined,
      ccAgentIds: [],
      attachments: [{ name: `${docTitle.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`, mimeType: 'application/pdf', data: buf.toString('base64') }],
    }),
  });
  const res = await gmailSend(inner);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: out.error || `Send failed (${res.status})` }, { status: res.status });

  // Contact activity lines (the deal side is logged by the send route): the deal's contact plus
  // every recipient who is a saved contact.
  const ids = new Set<string>();
  if (clientId ?? l.deal?.client_id) ids.add((clientId ?? l.deal?.client_id) as string);
  for (const a of addrs) {
    let aq = db.from('crm_clients').select('id').ilike('email', escapeLike(a));
    if (l.unit) aq = aq.eq('business_unit', l.unit);
    const { data } = await aq.limit(1).maybeSingle();
    if (data?.id) ids.add(data.id as string);
  }
  if (ids.size) {
    const now = new Date().toISOString();
    const note = `Sent email: ${plainFromHtml(String(subject))} (PDF attached)`;
    await db.from('crm_client_activities').insert([...ids].map(cid => ({ client_id: cid, agent_id: ctx.userId, type: 'email', note, tagged_contact_ids: [] })));
    await db.from('crm_clients').update({ last_touched_at: now }).in('id', [...ids]);
  }
  return NextResponse.json({ success: true, emailId: out.emailId ?? null });
}
