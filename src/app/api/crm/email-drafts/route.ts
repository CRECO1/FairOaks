import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/**
 * Email drafts — each agent's own unsent emails (crm_email_drafts), synced between devices.
 *
 *   GET     -> { drafts: Draft[] }                the caller's drafts, newest first
 *   PUT     { draft_key, subject, to, more_to, cc, bcc, body_html, context }   save / overwrite one draft
 *   DELETE  ?key=<draft_key>                      throw one away
 *
 * Strictly personal: every read and write is scoped to the signed-in user's id. If the table has not been
 * created yet (supabase/email-drafts-2026-10.sql not applied) GET answers { setup_needed: true } and the app
 * keeps drafts on this device only until it exists.
 */
const MISSING_TABLE = '42P01';
const missing = (e: { code?: string; message?: string }) => e.code === MISSING_TABLE || /does not exist|schema cache/i.test(e.message || '');
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { data, error } = await adminClient().from('crm_email_drafts')
    .select('draft_key, subject, to_emails, more_to, cc_emails, bcc_emails, body_html, context, updated_at')
    .eq('user_id', ctx.userId).order('updated_at', { ascending: false }).limit(200);
  if (error) {
    if (missing(error)) return NextResponse.json({ drafts: [], setup_needed: true });
    return dbError('api/crm/email-drafts GET', error);
  }
  return NextResponse.json({ drafts: data ?? [] });
}

export async function PUT(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  const key = clip(b?.draft_key, 200);
  if (!key) return NextResponse.json({ error: 'draft_key required' }, { status: 400 });
  const context = b?.context && typeof b.context === 'object' && !Array.isArray(b.context) ? b.context : {};
  const row = {
    user_id: ctx.userId, draft_key: key,
    subject: clip(b?.subject, 500), to_emails: clip(b?.to, 2000), more_to: clip(b?.more_to, 2000),
    cc_emails: clip(b?.cc, 2000), bcc_emails: clip(b?.bcc, 2000), body_html: clip(b?.body_html, 300_000),
    context, updated_at: new Date().toISOString(),
  };
  const { error } = await adminClient().from('crm_email_drafts').upsert(row, { onConflict: 'user_id,draft_key' });
  if (error) {
    if (missing(error)) return NextResponse.json({ ok: false, setup_needed: true });
    return dbError('api/crm/email-drafts PUT', error);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const key = clip(req.nextUrl.searchParams.get('key'), 200);
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  const { error } = await adminClient().from('crm_email_drafts').delete().eq('user_id', ctx.userId).eq('draft_key', key);
  if (error) {
    if (missing(error)) return NextResponse.json({ ok: true });
    return dbError('api/crm/email-drafts DELETE', error);
  }
  return NextResponse.json({ ok: true });
}
