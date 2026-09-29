import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, isSuperAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/*
 * Saved lists are OWNER-SCOPED, and only the super-admin (Zack) may destroy them.
 *
 *   read    — your own lists; the super-admin reads every list
 *   create  — anyone in the CRM, always owned by the caller (created_by = caller)
 *   delete  — super-admin only
 *
 * This route uses the service-role key, which bypasses RLS, so every rule is enforced
 * here. The same rules are mirrored in RLS (supabase/smart-lists-owner-scoped.sql) for
 * any session that reaches the table directly.
 */

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
  // Everyone below super-admin sees only their own lists — Zack's segments never reach
  // an agent, and agents never see each other's.
  if (!isSuperAdminRole(ctx.role)) query = query.eq('created_by', ctx.userId);

  const { data, error } = await query;
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ smart_lists: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
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
      created_by: ctx.userId,   // always the caller — a list can't be created for someone else
      is_shared: is_shared ?? false,
      business_unit: isAdminRole(ctx.role) ? (business_unit ?? ctx.businessUnit ?? 'residential') : (ctx.businessUnit ?? 'residential'),
    }])
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ smart_list: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  // Deleting a saved list is super-admin only — agents and admins can create lists but
  // not remove them, including their own.
  if (!isSuperAdminRole(ctx.role)) {
    return NextResponse.json({ error: 'Only the broker can delete saved lists.' }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data: list } = await supabase.from('crm_smart_lists').select('id').eq('id', id).maybeSingle();
  if (!list) return NextResponse.json({ error: 'Smart list not found' }, { status: 404 });

  const { error } = await supabase.from('crm_smart_lists').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
