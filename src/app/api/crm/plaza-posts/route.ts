import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// News, events, notices and promos for fairoaksranchplaza.com. The public site reads
// published rows straight from plaza_posts (RLS: anon SELECT where published = true);
// everything here is admin-only and goes through the service role.

const KINDS = ['news', 'event', 'notice', 'promo'] as const;
const FIELDS = 'id, slug, kind, title, summary, body, starts_at, location, published, published_at, created_at, source, organizer, submitter_name, submitter_email, submitter_phone';
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function slugify(title: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'post';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function clean(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'kind' in b) {
    if (!(KINDS as readonly string[]).includes(b.kind as string)) return { error: 'Invalid type' };
    out.kind = b.kind;
  }
  if (!partial || 'title' in b) {
    const t = str(b.title, 200);
    if (!t) return { error: 'Title is required' };
    out.title = t;
  }
  if (!partial || 'summary' in b) out.summary = str(b.summary, 400);
  if (!partial || 'body' in b) out.body = str(b.body, 20000);
  if (!partial || 'location' in b) out.location = str(b.location, 200) || null;
  if (!partial || 'starts_at' in b) {
    const raw = b.starts_at;
    if (raw) {
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) return { error: 'Invalid date' };
      out.starts_at = d.toISOString();
    } else out.starts_at = null;
  }
  if (!partial || 'published' in b) out.published = b.published === true;
  return { out };
}

export async function GET(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const { data, error } = await adminClient().from('plaza_posts').select(FIELDS).order('published_at', { ascending: false }).limit(300);
  if (error) { console.error('[plaza-posts] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ posts: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const { out, error } = clean(b, false);
  if (error || !out) return NextResponse.json({ error }, { status: 400 });
  if (out.kind === 'event' && !out.starts_at) return NextResponse.json({ error: 'Events need a date and time' }, { status: 400 });
  const { data, error: dbErr } = await adminClient().from('plaza_posts')
    .insert({ ...out, slug: slugify(String(out.title)), published_at: new Date().toISOString() }).select(FIELDS).single();
  if (dbErr) { console.error('[plaza-posts] POST', dbErr); return NextResponse.json({ error: 'Could not save post' }, { status: 500 }); }
  return NextResponse.json({ post: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const { out, error } = clean(b, true);
  if (error || !out) return NextResponse.json({ error }, { status: 400 });
  // Publishing a draft stamps the date it went live, so it sorts as new news.
  if (out.published === true) out.published_at = new Date().toISOString();
  const { data, error: dbErr } = await adminClient().from('plaza_posts').update(out).eq('id', id).select(FIELDS).single();
  if (dbErr) { console.error('[plaza-posts] PATCH', dbErr); return NextResponse.json({ error: 'Could not update post' }, { status: 500 }); }
  return NextResponse.json({ post: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await adminClient().from('plaza_posts').delete().eq('id', id);
  if (error) { console.error('[plaza-posts] DELETE', error); return NextResponse.json({ error: 'Could not delete post' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
