/**
 * POST /api/attom
 * Body: { address: string }
 *
 * Server-side proxy so the ATTOM_API_KEY never reaches the browser.
 * Secured — only authenticated CRM users can call this.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser } from '@/lib/crm-auth';
import { getPropertyIntel } from '@/lib/attom';
import { rateLimit } from '@/lib/ratelimit';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, 'attom');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const user = await getCrmUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.ATTOM_API_KEY) {
    return NextResponse.json({ error: 'ATTOM_API_KEY not configured — add it to your environment variables.' }, { status: 503 });
  }

  const { address } = await req.json().catch(() => ({}));
  if (!address?.trim()) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  const intel = await getPropertyIntel(address);
  return NextResponse.json(intel);
}
