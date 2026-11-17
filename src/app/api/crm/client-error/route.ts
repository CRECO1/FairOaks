import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { writeAuditLog } from '@/lib/audit';
import { userRateLimit } from '@/lib/user-ratelimit';

// The CRM's crash screen (src/app/crm/error.tsx) posts here so a "client-side exception" leaves a trail:
// who, which page, what the error said, which browser. Stored in audit_logs as action `client_error`.
// Signed-in users only, 10 per hour each, every field length-capped.
const cap = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!(await userRateLimit('client-error', ctx.userId, 10, '1 h')).success) return NextResponse.json({ ok: true });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  await writeAuditLog({
    actorId: ctx.userId,
    action: 'client_error',
    targetType: 'crm-page',
    metadata: {
      message: cap(b.message, 500), stack: cap(b.stack, 2500), digest: cap(b.digest, 60),
      url: cap(b.url, 300), ua: cap(b.ua, 300), role: ctx.role, business_unit: ctx.businessUnit,
    },
    req,
  });
  return NextResponse.json({ ok: true });
}
