import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';

// Called by fairoaksranchplaza.com right after a job application is saved. Emails the employer (reply-to = the applicant) and sends the
// applicant a confirmation. The application itself is already stored and visible in Plaza Site > Hiring, so a failure here loses nothing.
// Auth: Bearer CRM_LEAD_WEBHOOK_SECRET (same secret the site's contact forms use).
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FROM = 'Fair Oaks Ranch Plaza Jobs <jobs@crecotx.com>';
const FALLBACK_TO = 'zack@crecotx.com';

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null;
  const expected = process.env.CRM_LEAD_WEBHOOK_SECRET;
  const ok = !!expected && !!apiKey && apiKey.length === expected.length && require('crypto').timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { application_id } = await req.json().catch(() => ({}));
  if (typeof application_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(application_id)) return NextResponse.json({ error: 'application_id required' }, { status: 400 });

  const db = adminClient();
  const { data: app } = await db.from('plaza_job_applications').select('*').eq('id', application_id).single();
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (app.notified_at) return NextResponse.json({ ok: true, already: true });
  const { data: job } = await db.from('plaza_jobs').select('title, company, apply_email, notify_email').eq('id', app.job_id).single();
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const to = (job.notify_email || job.apply_email || FALLBACK_TO).trim();
  let resumeUrl = '';
  if (app.resume_path) {
    const { data: signed } = await db.storage.from('plaza-resumes').createSignedUrl(app.resume_path, 7 * 86400);
    resumeUrl = signed?.signedUrl ?? '';
  }

  const resend = new Resend((process.env.RESEND_API_KEY_COMMERCIAL ?? '').replace(/[\r\n\s]+$/, ''));
  const row = (k: string, v: string) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top">${k}</td><td style="padding:4px 0">${v}</td></tr>`;
  const employerHtml = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:560px">
    <p style="margin:0 0 12px"><b>New applicant for ${esc(job.title)}</b> (${esc(job.company)})</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 14px">${row('Name', esc(app.name))}${row('Email', `<a href="mailto:${esc(app.email)}">${esc(app.email)}</a>`)}${app.phone ? row('Phone', esc(app.phone)) : ''}${app.link ? row('Link', `<a href="${esc(app.link)}">${esc(app.link)}</a>`) : ''}${resumeUrl ? row('Resume', `<a href="${esc(resumeUrl)}">Download (link works for 7 days)</a>`) : ''}</table>
    ${app.message ? `<p style="margin:0 0 6px;color:#6b7280">Note from the applicant</p><p style="margin:0 0 14px;white-space:pre-line">${esc(app.message)}</p>` : ''}
    <p style="margin:0;color:#6b7280;font-size:13px">Just reply to this email to reach ${esc(app.name)}. Sent through the Fair Oaks Ranch Plaza Hire Local board (fairoaksranchplaza.com/jobs).</p></div>`;
  const applicantHtml = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:560px">
    <p style="margin:0 0 12px">Hi ${esc(app.name.split(' ')[0])},</p>
    <p style="margin:0 0 12px">Thanks for applying for <b>${esc(job.title)}</b> at <b>${esc(job.company)}</b>. We sent your application to them, and they will contact you directly if it is a fit. You can reply to this email to reach them.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">Fair Oaks Ranch Plaza Hire Local board &middot; fairoaksranchplaza.com/jobs</p></div>`;

  try {
    const r1 = await resend.emails.send({ from: FROM, to: [to], replyTo: app.email, subject: `New applicant for ${job.title}: ${app.name}`, html: employerHtml });
    if (r1.error) throw new Error(`employer email: ${r1.error.message}`);
    const r2 = await resend.emails.send({ from: FROM, to: [app.email], replyTo: to, subject: `We sent your application for ${job.title}`, html: applicantHtml });
    if (r2.error) console.error('[plaza-application] applicant confirmation failed', r2.error);
    await db.from('plaza_job_applications').update({ notified_at: new Date().toISOString() }).eq('id', application_id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[plaza-application] notify failed', e);
    return NextResponse.json({ error: 'Could not send' }, { status: 502 });
  }
}
