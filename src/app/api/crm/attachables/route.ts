import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { listAttachables } from '@/lib/crm-attachments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/crm/attachables?dealId=… | ?clientId=…
// The documents on a deal's Docs tab (or on a contact's deals) that can be attached to an email straight from the CRM.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('dealId') ?? undefined;
  const clientId = req.nextUrl.searchParams.get('clientId') ?? undefined;
  if ((dealId && !UUID_RE.test(dealId)) || (clientId && !UUID_RE.test(clientId))) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!dealId && !clientId) return NextResponse.json({ groups: [] });
  const groups = await listAttachables(ctx, { dealId, clientId });
  if (groups === null) return notFound('Not found');
  return NextResponse.json({ groups });
}
