import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Import not yet implemented' }, { status: 501 });
}
