import { NextRequest, NextResponse } from 'next/server';
import { rateLimitFailOpen } from '@/lib/ratelimit';

// Browsers POST here when a page does something its Content-Security-Policy forbids (or, in report-only mode, would forbid).
// Public by nature (the browser sends it, with no login), so it is small, rate-limited, writes nothing but a log line, and always answers 204.
export const dynamic = 'force-dynamic';

const clip = (v: unknown, n = 160) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
const noQuery = (u: unknown) => clip(u).split(/[?#]/)[0];   // never log a query string: it can carry tokens or email addresses

export async function POST(req: NextRequest) {
  const rl = await rateLimitFailOpen(req, 'trackEvent');
  if (!rl.success) return new NextResponse(null, { status: 204 });
  try {
    const raw = (await req.text()).slice(0, 8_000);
    const r = ((JSON.parse(raw) as { 'csp-report'?: Record<string, unknown> })['csp-report'] ?? {}) as Record<string, unknown>;
    console.warn('[csp-report]', JSON.stringify({
      directive: clip(r['violated-directive'] ?? r['effective-directive'], 60),
      blocked: noQuery(r['blocked-uri']),
      page: noQuery(r['document-uri']),
      source: noQuery(r['source-file']),
      line: r['line-number'] ?? null,
      sample: clip(r['script-sample'], 80),
      disposition: clip(r['disposition'], 12),
    }));
  } catch { /* malformed report: ignore */ }
  return new NextResponse(null, { status: 204 });
}
