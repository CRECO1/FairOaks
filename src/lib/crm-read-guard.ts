/**
 * Anti-scrape guard for authenticated CRM data-read endpoints.
 *
 * The threat is not an anonymous crawler — it is a logged-in agent pointing an AI
 * browser agent or a script at the CRM and pulling the book out through the same
 * endpoints the UI uses, which walks straight around the export-approval workflow.
 *
 * Four things here, in the order they matter:
 *   1. VOLUME BUDGETS. A person reads a few hundred records an hour; a scraper reads
 *      thousands. Requests AND rows are both budgeted per user, in Upstash Redis, so
 *      the count survives across serverless invocations instead of resetting per
 *      lambda. Per-IP budgets sit on top for the shared-office case.
 *   2. PAGE CAPS. capLimit() refuses an oversized ?limit=, so the book cannot be
 *      pulled in one call and a scrape has to make enough requests to trip (1).
 *   3. AUDIT. Every guarded read is counted, and anything above the alert threshold
 *      is written to audit_logs and emailed to the owner once per hour per user.
 *   4. SAME-ORIGIN. Browser-issued requests carry Origin/Referer; a bare curl or a
 *      headless script usually does not. Enforced only for cookie-authenticated
 *      requests — see sameOriginOk() for why.
 *
 * Deliberately fails OPEN if Redis is unreachable: this guards an internal tool
 * people work in all day, and locking the brokerage out of its own CRM is a worse
 * outcome than a gap in scrape protection. The gap is logged at error level and the
 * audit trail keeps recording regardless.
 *
 * NOTE: this protects the Next.js API routes. The CRM browser client also talks to
 * Supabase PostgREST directly with the user's own JWT, which never passes through
 * here — that path is governed by RLS, and supabase/rls-agent-ownership.sql is what
 * closes it. Both are required; neither alone is sufficient.
 *
 * SERVER-ONLY.
 */
import 'server-only';

import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';
import type { CrmContext } from '@/lib/crm-auth';

/* ── budgets ──────────────────────────────────────────────────────────────── */
// Tuned well above human patterns. A busy agent clicking through contacts, deals and
// timelines for an hour lands in the low hundreds of requests and maybe a thousand
// rows; the numbers below leave that untouched and still stop an enumeration run.

export const BUDGETS = {
  /** Requests per user, short burst. A page load can fan out to a dozen calls. */
  userBurst:    { limit: 150,  windowSec: 60 },
  /** Requests per user, sustained. */
  userHour:     { limit: 1200, windowSec: 3600 },
  /**
   * Rows returned per user per hour — the number that actually tracks a scrape.
   * Sized around the Property DB, which legitimately returns ~2,400 rows per load:
   * this absorbs a dozen of those plus a heavy contacts session, and still stops a
   * run that walks the whole book repeatedly.
   */
  userRowsHour: { limit: 30000, windowSec: 3600 },
  /** Requests per IP, short burst. Higher than per-user: one office IP, several agents. */
  ipBurst:      { limit: 400,  windowSec: 60 },
} as const;

/** Row volume in an hour that gets the owner emailed, well before the hard cap. */
const ROW_ALERT_THRESHOLD = 12000;

/** A single response at or above this many rows is written to audit_logs. */
const BULK_READ_AUDIT_ROWS = 250;

/** Hard ceiling on any ?limit=/?take= a client may ask for. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/* ── redis ────────────────────────────────────────────────────────────────── */

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error('[crm-read-guard] KV not configured — read budgets are NOT being enforced.');
    redis = null;
  } else {
    redis = new Redis({ url, token });
  }
  return redis;
}

/**
 * Increment a fixed-window counter and report the running total.
 * Fixed windows (not sliding) keep this to one round trip per bucket; the budgets
 * are coarse enough that the window edge does not matter.
 */
async function bump(key: string, windowSec: number, by = 1): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const k = `crmread:${key}:${bucket}`;
    const total = await r.incrby(k, by);
    if (total === by) await r.expire(k, windowSec * 2);
    return total;
  } catch (err) {
    console.error('[crm-read-guard] redis error — failing open', err);
    return null;
  }
}

/* ── page caps ────────────────────────────────────────────────────────────── */

/**
 * Clamp a client-supplied page size. `strict` rejects an oversized value outright
 * rather than silently clamping, so a caller asking for 10,000 rows is told no
 * instead of quietly receiving 200 and paginating around it.
 */
export function capLimit(raw: string | null, opts: { max?: number; def?: number } = {}): { limit: number; tooLarge: boolean } {
  const max = opts.max ?? MAX_PAGE_SIZE;
  const def = opts.def ?? DEFAULT_PAGE_SIZE;
  if (raw == null || raw === '') return { limit: def, tooLarge: false };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { limit: def, tooLarge: false };
  if (n > max) return { limit: max, tooLarge: true };
  return { limit: Math.floor(n), tooLarge: false };
}

/* ── same-origin ──────────────────────────────────────────────────────────── */

/**
 * True when the request looks like it came from our own app.
 *
 * Only meaningful for cookie-authenticated requests: a Bearer token is not sent
 * automatically by a browser, so a cross-site page cannot mint one, and the CRM's
 * own client legitimately calls these routes with an Authorization header. Blocking
 * on a missing Origin for Bearer requests would break nothing an attacker does and
 * everything a legitimate integration does, so we don't.
 */
export function sameOriginOk(req: NextRequest): boolean {
  if (req.headers.get('authorization')?.startsWith('Bearer ')) return true;
  const self = req.nextUrl.origin;
  const origin = req.headers.get('origin');
  if (origin) return origin === self;
  const referer = req.headers.get('referer');
  if (referer) { try { return new URL(referer).origin === self; } catch { return false; } }
  // No Origin and no Referer on a cookie-authenticated data read is a scripted hit.
  return false;
}

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? '0.0.0.0';
}

/* ── alerting ─────────────────────────────────────────────────────────────── */

const ALERT_EMAIL = process.env.EXPORT_APPROVER_EMAIL ?? 'zack@crecotx.com';
const SITE = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.fairoaksrealtygroup.com').replace(/\/$/, '');

/**
 * Email the owner that someone is reading at machine volume, and record it.
 * Rate-limited to one alert per user per hour so a sustained scrape doesn't turn
 * into a hundred emails.
 */
async function alertOwner(ctx: CrmContext, resource: string, rows: number, reason: string, req: NextRequest): Promise<void> {
  const firstThisHour = await bump(`alert:${ctx.userId}`, 3600);
  if (firstThisHour !== null && firstThisHour > 1) return;

  const db = adminClient();
  let who = ctx.userId;
  try {
    const { data } = await db.from('crm_profiles').select('first_name, last_name, email').eq('id', ctx.userId).maybeSingle();
    if (data) who = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() + (data.email ? ` <${data.email}>` : '');
  } catch { /* fall back to the id */ }

  try {
    await db.from('audit_logs').insert({
      actor_id: ctx.userId,
      action: 'bulk_read_detected',
      target_type: resource,
      target_id: null,
      metadata: { reason, rows_this_hour: rows, resource, role: ctx.role, business_unit: ctx.businessUnit },
      ip_address: getIp(req),
    });
  } catch (err) { console.error('[crm-read-guard] audit insert failed', err); }

  if (!process.env.RESEND_API_KEY) return;
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
      to: ALERT_EMAIL,
      subject: `CRM: unusual read volume — ${who}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
        <h2 style="color:#A68B4B;margin:0 0 12px">Unusual CRM read volume</h2>
        <p style="margin:0 0 10px"><strong>${escapeHtml(who)}</strong> has read about <strong>${rows.toLocaleString()}</strong> records in the last hour.</p>
        <p style="margin:0 0 10px">Trigger: ${escapeHtml(reason)}<br>Most recent area: ${escapeHtml(resource)}<br>IP: ${escapeHtml(getIp(req))}</p>
        <p style="margin:0 0 10px;color:#555">This is what bulk extraction looks like — an AI browser agent or a script reading through the CRM rather than a person clicking. Normal use does not reach this.</p>
        <p style="margin:0"><a href="${SITE}/crm" style="color:#A68B4B;font-weight:600;text-decoration:none">Open the CRM</a> · the full trail is in audit_logs.</p>
      </div>`,
    });
  } catch (err) { console.error('[crm-read-guard] alert email failed', err); }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/* ── the guard ────────────────────────────────────────────────────────────── */

export interface GuardResult {
  /** Non-null means: stop and return this response. */
  blocked: NextResponse | null;
  /** Call once the rows are known, so row volume is budgeted and audited. */
  recordRows: (n: number) => Promise<void>;
}

/**
 * Run before a data read. Enforces the request budgets and same-origin, and hands
 * back recordRows() to charge the row budget once the query has run.
 */
export async function guardRead(req: NextRequest, ctx: CrmContext, resource: string): Promise<GuardResult> {
  if (!sameOriginOk(req)) {
    return {
      blocked: NextResponse.json(
        { error: 'This endpoint is only available from the CRM app.' },
        { status: 403 },
      ),
      recordRows: async () => {},
    };
  }

  const ip = getIp(req);
  const [burst, hour, ipBurst] = await Promise.all([
    bump(`u:${ctx.userId}:burst`, BUDGETS.userBurst.windowSec),
    bump(`u:${ctx.userId}:hour`, BUDGETS.userHour.windowSec),
    bump(`ip:${ip}:burst`, BUDGETS.ipBurst.windowSec),
  ]);

  const over =
    (burst   !== null && burst   > BUDGETS.userBurst.limit) ? { reason: 'request burst per user', retry: BUDGETS.userBurst.windowSec } :
    (hour    !== null && hour    > BUDGETS.userHour.limit)  ? { reason: 'sustained requests per user', retry: BUDGETS.userHour.windowSec } :
    (ipBurst !== null && ipBurst > BUDGETS.ipBurst.limit)   ? { reason: 'request burst per IP', retry: BUDGETS.ipBurst.windowSec } :
    null;

  if (over) {
    await alertOwner(ctx, resource, hour ?? 0, over.reason, req);
    return {
      blocked: NextResponse.json(
        { error: 'Too many requests. Slow down and try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(over.retry) } },
      ),
      recordRows: async () => {},
    };
  }

  return {
    blocked: null,
    recordRows: async (n: number) => {
      if (!n || n < 1) return;

      // A durable line for any read big enough to be worth reconstructing later.
      // Per-click reads aren't logged — that would be a row per page view and would
      // bury the signal — but anything that pulls a meaningful slice of the book is,
      // so a scrape leaves a trail in audit_logs even if it never trips a budget.
      if (n >= BULK_READ_AUDIT_ROWS) {
        try {
          await adminClient().from('audit_logs').insert({
            actor_id: ctx.userId, action: 'bulk_read_detected', target_type: resource, target_id: null,
            metadata: { rows: n, resource, role: ctx.role, business_unit: ctx.businessUnit, kind: 'single_response' },
            ip_address: getIp(req),
          });
        } catch (err) { console.error('[crm-read-guard] bulk read audit failed', err); }
      }

      const rows = await bump(`u:${ctx.userId}:rows`, BUDGETS.userRowsHour.windowSec, n);
      if (rows === null) return;
      if (rows > BUDGETS.userRowsHour.limit || rows >= ROW_ALERT_THRESHOLD) {
        await alertOwner(ctx, resource, rows, rows > BUDGETS.userRowsHour.limit ? 'row budget exceeded' : 'high row volume', req);
      }
    },
  };
}

/** True once the user is over the hourly row budget — checked before serving more rows. */
export async function rowBudgetExhausted(ctx: CrmContext): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const bucket = Math.floor(Date.now() / 1000 / BUDGETS.userRowsHour.windowSec);
    const v = await r.get<number>(`crmread:u:${ctx.userId}:rows:${bucket}`);
    return typeof v === 'number' && v > BUDGETS.userRowsHour.limit;
  } catch { return false; }
}
