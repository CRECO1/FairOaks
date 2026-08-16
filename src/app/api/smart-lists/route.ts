import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, getCrmAdmin, getCrmContext, isAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const supabase = adminClient();
  let query = supabase.from('crm_smart_lists').select('*').order('created_at', { ascending: false });
  if (isAdminRole(ctx.role)) {
    const unit = new URL(req.url).searchParams.get('unit');
    if (unit) query = query.eq('business_unit', unit);
  } else {
    query = query.eq('business_unit', ctx.businessUnit);
  }

  const { data, error } = await query;
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ smart_lists: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { name, filters, is_shared, business_unit } = body;

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
      created_by: ctx.userId,
      is_shared: is_shared ?? false,
      business_unit: isAdminRole(ctx.role) ? (business_unit ?? ctx.businessUnit ?? 'residential') : (ctx.businessUnit ?? 'residential'),
    }])
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ smart_list: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  // Scoped to admin or the list's creator — fetch first to check ownership
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  const supabase = adminClient();

  // Ownership check — allow if caller created it, otherwise require admin
  const { data: list } = await supabase.from('crm_smart_lists').select('created_by').eq('id', id).single();
  if (!list) return NextResponse.json({ error: 'Smart list not found' }, { status: 404 });

  if (list.created_by !== caller.id) {
    const admin = await getCrmAdmin();
    if (!admin) return NextResponse.json({ error: 'Forbidden — you can only delete your own smart lists' }, { status: 403 });
  }

  const { error } = await supabase.from('crm_smart_lists').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
