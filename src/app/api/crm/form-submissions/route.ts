import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Completed/in-progress form instances (crm_form_submissions): stores the field
// VALUES (jsonb, so it can be re-opened & edited) and a generated PDF in storage.
// Optionally linked to a deal via deal_id.

export async function GET(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('deal_id');
  const supabase = adminClient();
  let q = supabase
    .from('crm_form_submissions')
    .select('id, form_id, deal_id, title, filled_path, status, created_at, updated_at, crm_forms(name, form_code)')
    .order('updated_at', { ascending: false });
  if (dealId) q = q.eq('deal_id', dealId);
  const { data, error } = await q;
  if (error) { console.error('[api/form-submissions] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  const submissions = await Promise.all((data ?? []).map(async (s) => {
    let url: string | null = null;
    if (s.filled_path) {
      const { data: sg } = await supabase.storage.from('transaction-forms').createSignedUrl(s.filled_path, 3600);
      url = sg?.signedUrl ?? null;
    }
    return { ...s, url };
  }));
  return NextResponse.json({ submissions });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const { form_id, deal_id, title, values, pdfBase64, business_unit, submission_id } = body;
  if (!form_id) return NextResponse.json({ error: 'form_id required' }, { status: 400 });
  const supabase = adminClient();

  let filled_path: string | null = null;
  if (pdfBase64) {
    const bytes = Buffer.from(pdfBase64, 'base64');
    const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const path = `submissions/${form_id}/${stamp}.pdf`;
    const { error: upErr } = await supabase.storage.from('transaction-forms').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) console.error('[api/form-submissions] upload', upErr);
    else filled_path = path;
  }

  const base = {
    form_id,
    deal_id: deal_id || null,
    business_unit: business_unit || 'commercial',
    title: title || null,
    values: values ?? [],
    status: 'saved',
    updated_at: new Date().toISOString(),
    ...(filled_path ? { filled_path } : {}),
  };

  const res = submission_id
    ? await supabase.from('crm_form_submissions').update(base).eq('id', submission_id).select().single()
    : await supabase.from('crm_form_submissions').insert({ ...base, created_by: caller.id }).select().single();

  if (res.error) { console.error('[api/form-submissions] save', res.error); return NextResponse.json({ error: 'Save failed' }, { status: 500 }); }
  return NextResponse.json({ submission: res.data });
}
