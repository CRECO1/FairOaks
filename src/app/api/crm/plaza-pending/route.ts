import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// How many community submissions (events, news, jobs) from fairoaksranchplaza.com are waiting for approval. Drives the red badge on the Plaza Site nav item.
export async function GET(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const db = adminClient();
  const [posts, jobs] = await Promise.all([
    db.from('plaza_posts').select('id', { count: 'exact', head: true }).eq('source', 'community').eq('published', false),
    db.from('plaza_jobs').select('id', { count: 'exact', head: true }).eq('source', 'community').eq('published', false),
  ]);
  return NextResponse.json({ posts: posts.count ?? 0, jobs: jobs.count ?? 0, total: (posts.count ?? 0) + (jobs.count ?? 0) });
}
