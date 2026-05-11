import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.fairoaksrealtygroup.com';
  const res  = await fetch(`${base}/api/email-leads/sync`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ ok: res.ok, ...data });
}
