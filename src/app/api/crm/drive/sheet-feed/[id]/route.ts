import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { FEEDS, isFeed } from '@/lib/drive-sheet-feeds';

// Live CRM data for a spreadsheet's feed tabs. The browser asks for the rows and writes them into the shared sheet itself, so every
// teammate who has it open sees the refresh live and the normal save path stores it. Reads respect the caller's own CRM access.

export const maxDuration = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: doc } = await dc.userDb.from('crm_drive_docs').select('id,kind,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!doc || doc.trashed_at || doc.kind !== 'sheet') return notFound('That spreadsheet is not available');
  const body = await req.json().catch(() => ({})) as { feeds?: unknown };
  const wanted = (Array.isArray(body.feeds) ? body.feeds : []).filter(isFeed);
  if (!wanted.length) return NextResponse.json({ error: 'No feed requested' }, { status: 400 });
  try {
    const feeds = await Promise.all(wanted.map(k => FEEDS[k].build(dc)));
    return NextResponse.json({ feeds, message: `Refreshed ${feeds.map(f => f.title).join(' and ')} from the CRM` });
  } catch (e) {
    console.error('[drive] sheet feed', e);
    return NextResponse.json({ error: 'Could not read the CRM data' }, { status: 500 });
  }
}
