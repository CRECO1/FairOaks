import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET() {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const supabase = adminClient();

  const { data, error } = await supabase
    .from('social_saved_replies')
    .select('*')
    .eq('agent_id', user.id)
    .order('use_count', { ascending: false });

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ replies: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { title, content, category } = body;

  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });

  const supabase = adminClient();

  const { data, error } = await supabase
    .from('social_saved_replies')
    .insert({
      agent_id: user.id,
      title,
      content,
      category: category || null,
      use_count: 0,
    })
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ reply: data });
}

export async function DELETE(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const supabase = adminClient();

  const { error } = await supabase
    .from('social_saved_replies')
    .delete()
    .eq('id', id)
    .eq('agent_id', user.id);

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  return NextResponse.json({ success: true });
}
