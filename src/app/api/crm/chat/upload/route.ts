import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { userRateLimit } from '@/lib/user-ratelimit';
import { DRIVE_FILE_TYPES, DRIVE_FILE_MAX } from '@/lib/drive-types';
import { roomAllowed, chatPrefix, CHAT_BUCKET } from '@/lib/team-chat-server';

export const dynamic = 'force-dynamic';

// POST { room, filename, size } → a signed upload URL: the browser PUTs the bytes straight to storage (a posted body is capped at
// ~4.5 MB on Vercel). The file lands in this conversation's own folder, so only people in the room can ever fetch it.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !ctx.businessUnit) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { room?: string; filename?: string; size?: number };
  const room = typeof b.room === 'string' ? b.room : '';
  if (!(await roomAllowed(ctx, room)).ok) return NextResponse.json({ error: 'No such conversation' }, { status: 404 });
  const filename = (b.filename ?? '').trim().slice(0, 255);
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const contentType = DRIVE_FILE_TYPES[ext];
  if (!filename || !contentType) return NextResponse.json({ error: `That file type can't be shared here. Allowed: PDF, Word, Excel, PowerPoint, CSV, TXT and pictures (JPG, PNG, WebP, GIF).` }, { status: 400 });
  if (typeof b.size !== 'number' || !(b.size > 0) || b.size > DRIVE_FILE_MAX) return NextResponse.json({ error: 'Files must be 25 MB or smaller' }, { status: 400 });
  if (!(await userRateLimit('chat-upload', ctx.userId, 120, '1 h')).success) return NextResponse.json({ error: 'Too many uploads this hour. Try again later.' }, { status: 429 });
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${chatPrefix(ctx.businessUnit, room)}${randomUUID()}-${safe}`;
  const { data, error } = await adminClient().storage.from(CHAT_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 });
  return NextResponse.json({ uploadUrl: data.signedUrl, storagePath, contentType });
}
