import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const ALLOWED = ['name','address','city','state','zip','type','status','asking_price','sq_ft','lot_size','year_built','description','notes','listing_agent_id','assigned_agent_ids','is_restricted'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const { id } = await params;
  const body = await req.json();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ALLOWED) if (k in body) update[k] = body[k] !== '' ? body[k] : null;
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_listings').update(update).eq('id', id).select().single();
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  return NextResponse.json({ listing: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  // Remove all storage files for this listing first
  const { data: files } = await supabase.from('crm_listing_files').select('storage_path').eq('listing_id', id);
  if (files?.length) await supabase.storage.from('listing-files').remove(files.map(f => f.storage_path));
  const { error } = await supabase.from('crm_listings').delete().eq('id', id);
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  return NextResponse.json({ deleted: true });
}
