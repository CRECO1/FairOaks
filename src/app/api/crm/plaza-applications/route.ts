import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Applications to jobs on fairoaksranchplaza.com/jobs (plaza_job_applications). Private: admin-only, service role. Resumes are signed on the fly.
const STATUSES = ['new', 'contacted', 'interview', 'hired', 'archived'];

export async function GET(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const jobId = req.nextUrl.searchParams.get('job_id');
  const db = adminClient();
  let q = db.from('plaza_job_applications').select('id, job_id, name, email, phone, message, link, resume_path, status, notes, notified_at, created_at').order('created_at', { ascending: false }).limit(500);
  if (jobId) q = q.eq('job_id', jobId);
  const { data, error } = await q;
  if (error) { console.error('[plaza-applications] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  const apps = await Promise.all((data ?? []).map(async a => {
    let resume_url: string | null = null;
    if (a.resume_path) { const { data: s } = await db.storage.from('plaza-resumes').createSignedUrl(a.resume_path, 3600); resume_url = s?.signedUrl ?? null; }
    const { resume_path: _p, ...rest } = a;
    return { ...rest, has_resume: !!a.resume_path, resume_url };
  }));
  return NextResponse.json({ applications: apps });
}

export async function PATCH(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const out: Record<string, unknown> = {};
  if (typeof b.status === 'string' && STATUSES.includes(b.status)) out.status = b.status;
  if (typeof b.notes === 'string') out.notes = b.notes.trim().slice(0, 3000) || null;
  if (!Object.keys(out).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  const { error } = await adminClient().from('plaza_job_applications').update(out).eq('id', id);
  if (error) { console.error('[plaza-applications] PATCH', error); return NextResponse.json({ error: 'Could not update' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}

// Delete an applicant's record and resume on request.
export async function DELETE(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = adminClient();
  const { data: a } = await db.from('plaza_job_applications').select('resume_path').eq('id', id).single();
  if (a?.resume_path) await db.storage.from('plaza-resumes').remove([a.resume_path]);
  const { error } = await db.from('plaza_job_applications').delete().eq('id', id);
  if (error) { console.error('[plaza-applications] DELETE', error); return NextResponse.json({ error: 'Could not delete' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
