import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return new Response('<h2>Invalid link</h2>', { headers: { 'Content-Type': 'text/html' }, status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: client } = await supabase
    .from('crm_clients')
    .select('id')
    .eq('unsubscribe_token', token)
    .single();

  if (!client) {
    return new Response(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Link not found</h2><p>This unsubscribe link is invalid or has already been used.</p></body></html>`, { headers: { 'Content-Type': 'text/html' }, status: 404 });
  }

  await supabase.from('crm_clients').update({ unsubscribed_at: new Date().toISOString() }).eq('id', client.id);
  await supabase.from('crm_campaign_enrollments').update({ active: false }).eq('client_id', client.id);

  return new Response(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;color:#333"><h2 style="color:#1a1a2e">You've been unsubscribed</h2><p>You will no longer receive campaign messages from <strong>Fair Oaks Realty Group</strong>.</p><p style="color:#999;font-size:13px;margin-top:24px">To re-subscribe, contact your agent directly.</p></body></html>`, { headers: { 'Content-Type': 'text/html' } });
}
