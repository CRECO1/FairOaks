import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { writeAuditLog } from '@/lib/audit';

/**
 * Records what the CRM's screen protection saw in the browser
 * (components/crm/CrmShield.tsx): an automated browser that was signed out, or
 * a screenshot / copy shortcut used on CRM data. Each lands in audit_logs with
 * the agent's id, so a leaked screenshot or a scrape attempt has a name on it.
 */
const KINDS = new Set(['automation_blocked', 'screenshot_attempt', 'copy_attempt'] as const);
type Kind = 'automation_blocked' | 'screenshot_attempt' | 'copy_attempt';

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const kind = body.kind as Kind;
  if (!KINDS.has(kind)) return NextResponse.json({ error: 'Unknown event.' }, { status: 400 });

  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 200) : null;
  await writeAuditLog({
    actorId: ctx.userId,
    action: kind,
    targetType: 'crm_screen',
    metadata: {
      detail,
      page: typeof body.page === 'string' ? body.page.slice(0, 60) : null,
      role: ctx.role,
      business_unit: ctx.businessUnit,
      ua: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    },
    req,
  });
  return NextResponse.json({ ok: true });
}
