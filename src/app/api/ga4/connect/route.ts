/**
 * GET /api/ga4/connect — start (or restart) the Google Analytics connection.
 *
 * Owner-only, and deliberately so: it mints a live authorization link. The
 * first connection is normally done from a link generated out-of-band and
 * tapped on a phone, because requiring a CRM login on mobile is exactly the
 * friction this is trying to remove. This route exists for reconnecting later
 * from inside the CRM, and for checking the current state.
 *
 *   ?json=1   returns the link instead of redirecting, for copying/sending.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isSuperAdminRole, unauthorized, forbidden } from '@/lib/crm-auth';
import { mintConsentUrl } from '@/lib/ga4-oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return forbidden('Owner only');

  try {
    const { url, expiresAt } = await mintConsentUrl();
    if (req.nextUrl.searchParams.get('json') === '1') {
      return NextResponse.json({ url, expiresAt });
    }
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not build consent URL' }, { status: 500 });
  }
}
