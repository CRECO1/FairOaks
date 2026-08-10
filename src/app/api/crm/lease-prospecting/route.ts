import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { listLeaseClients, runLeaseProspecting } from '@/lib/lease-prospecting';

// Lease-expiration prospecting: list tenants with lease dates, and create renewal
// call tasks (into the Call Queue) for those in their outreach window.

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const clients = await listLeaseClients(ctx.businessUnit ?? 'commercial');
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const clientIds = Array.isArray(body.client_ids)
    ? (body.client_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;
  const res = await runLeaseProspecting(ctx.businessUnit ?? 'commercial', { clientIds, assignTo: ctx.userId, commit: true });
  return NextResponse.json(res);
}
