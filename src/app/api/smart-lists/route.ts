import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const supabase = adminClient();
  const unit = new URL(req.url).searchParams.get('unit');

  let query = supabase.from('crm_smart_lists').select('*').order('created_at', { ascending: false });
  if (unit) query = query.eq('business_unit', unit);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ smart_lists: data ?? [] });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const body = await req.json();
  const { name, filters, created_by, is_shared, business_unit } = body;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!filters) {
    return NextResponse.json({ error: 'filters is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_smart_lists')
    .insert([{
      name,
      filters,
      created_by: created_by ?? null,
      is_shared: is_shared ?? false,
      business_unit: business_unit ?? 'residential',
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ smart_list: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { error } = await supabase.from('crm_smart_lists').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
