import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { roomAllowed, chatPrefix, CHAT_BUCKET } from '@/lib/team-chat-server';

export const dynamic = 'force-dynamic';

// GET ?room=…&path=…[&download=1] → a fresh one-hour link, minted at click time. Only for a file in a conversation the caller can open.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx || !ctx.businessUnit) return unauthorized();
  const room = req.nextUrl.searchParams.get('room') ?? '';
  const path = req.nextUrl.searchParams.get('path') ?? '';
  if (!(await roomAllowed(ctx, room)).ok || !path.startsWith(chatPrefix(ctx.businessUnit, room)) || path.includes('..')) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const name = (path.split('/').pop() ?? 'file').replace(/^[0-9a-f-]{36}-/, '');
  const download = req.nextUrl.searchParams.get('download') === '1';
  const { data, error } = await adminClient().storage.from(CHAT_BUCKET).createSignedUrl(path, 3600, download ? { download: name } : undefined);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Could not generate a link' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
