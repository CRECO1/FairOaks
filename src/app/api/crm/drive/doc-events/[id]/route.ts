import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { EVENT_COLS, type DriveDocEvent } from '@/lib/drive-events';

// The activity log of one document, newest first. The caller must be able to open the document (RLS decides — including through a linked card).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: seen } = await dc.userDb.from('crm_drive_docs').select('id').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!seen) return notFound('That document is not available');
  const { data, error } = await dc.admin.from('crm_drive_doc_events').select(EVENT_COLS).eq('doc_id', id).order('created_at', { ascending: false }).limit(300);
  if (error) return NextResponse.json({ events: [] satisfies DriveDocEvent[] });   // the log table may not exist yet
  return NextResponse.json({ events: (data ?? []) as DriveDocEvent[] });
}
