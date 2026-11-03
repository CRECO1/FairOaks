import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';

// A fresh one-hour link to an uploaded file, minted at click time (list-time links would expire). The file row is read as the
// signed-in user first, so a file the caller can't see is a 404 and never gets a link.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: f } = await dc.userDb.from('crm_drive_files').select('id,name,mime,storage_path,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!f || f.trashed_at) return notFound('That file is not available');
  const download = req.nextUrl.searchParams.get('download') === '1';
  const { data, error } = await dc.admin.storage.from('drive-files').createSignedUrl(f.storage_path as string, 3600, download ? { download: f.name as string } : undefined);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Could not generate a link' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, name: f.name, type: f.mime });
}
