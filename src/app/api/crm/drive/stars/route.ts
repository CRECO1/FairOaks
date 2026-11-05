import { NextRequest, NextResponse } from 'next/server';
import { unauthorized } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';

export const dynamic = 'force-dynamic';

const KEY_RE = /^(folder|doc|file|form):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter(k => KEY_RE.test(k)).map(k => k.toLowerCase()).slice(0, 500);

// GET → the caller's starred items as 'kind:id' keys.   POST { add?: string[], remove?: string[] } → change them.
export async function GET(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { data } = await dc.admin.from('crm_drive_stars').select('key').eq('user_id', dc.ctx.userId).limit(2000);
  return NextResponse.json({ keys: (data ?? []).map(r => r.key as string) });
}

export async function POST(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const body = await req.json().catch(() => ({})) as { add?: unknown; remove?: unknown };
  const add = clean(body.add), remove = clean(body.remove);
  if (add.length) await dc.admin.from('crm_drive_stars').upsert(add.map(key => ({ user_id: dc.ctx.userId, key })), { onConflict: 'user_id,key', ignoreDuplicates: true });
  if (remove.length) await dc.admin.from('crm_drive_stars').delete().eq('user_id', dc.ctx.userId).in('key', remove);
  return NextResponse.json({ ok: true });
}
