import type { NextRequest } from 'next/server';
import { handleSend } from '@/lib/gmail-send';

// The send pipeline lives in lib/gmail-send.ts so the scheduled-send cron can run the very same code.
export async function POST(req: NextRequest) {
  return handleSend(req);
}
