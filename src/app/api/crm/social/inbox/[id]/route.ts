import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const { status, assigned_to } = body;

  const supabase = adminClient();

  // Verify ownership
  const { data: existing } = await supabase
    .from('social_inbox')
    .select('id')
    .eq('id', id)
    .eq('agent_id', user.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;
  if (assigned_to !== undefined) updates.assigned_to = assigned_to;

  const { data, error } = await supabase
    .from('social_inbox')
    .update(updates)
    .eq('id', id)
    .eq('agent_id', user.id)
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ item: data });
}
