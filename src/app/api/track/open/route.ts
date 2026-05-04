import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';

// 1×1 transparent GIF
const TRANSPARENT_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export async function GET(req: NextRequest) {
  const trackingId = req.nextUrl.searchParams.get('id');

  if (trackingId) {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    try {
      // Look up the email by tracking_id
      const lookupRes = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_deal_emails?tracking_id=eq.${trackingId}&select=id,opened_at,open_count`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` } }
      );
      const rows = await lookupRes.json();

      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0];
        const patch: Record<string, unknown> = {
          open_count: (row.open_count ?? 0) + 1,
        };
        if (!row.opened_at) {
          patch.opened_at = new Date().toISOString();
        }

        await fetch(
          `${SUPABASE_URL}/rest/v1/crm_deal_emails?id=eq.${row.id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: anonKey,
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(patch),
          }
        );
      }
    } catch {
      // Non-fatal — always return the pixel
    }
  }

  const gif = Buffer.from(TRANSPARENT_GIF, 'base64');
  return new NextResponse(gif, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store',
    },
  });
}
