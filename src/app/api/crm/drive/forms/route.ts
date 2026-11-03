import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext, hydrateDriveForms } from '@/lib/drive-server';
import { FORM_LINK_COLS } from '@/lib/drive-types';

// File a new copy of a form from the library (any of them — commercial, TREC residential, leases, LOIs …) into a My Drive folder.
// It creates an ordinary saved form (blank, ready to fill, opens in the live form editor) and the link that puts it in the folder.
// Forms may only go in TEAM folders: who can open a saved form follows the forms rules (workspace-wide when no deal / property is
// attached), and a Private folder would promise more than that.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { userDb, admin, bu, ctx } = dc;
  const body = await req.json().catch(() => ({})) as { form_id?: string; parent_id?: string | null };
  if (!body.form_id || !UUID_RE.test(body.form_id)) return NextResponse.json({ error: 'Pick a form' }, { status: 400 });
  const parentId = body.parent_id || null;
  if (parentId) {
    if (!UUID_RE.test(parentId)) return NextResponse.json({ error: 'invalid folder' }, { status: 400 });
    const { data: parent } = await userDb.from('crm_drive_folders').select('id,visibility,deal_id,trashed_at').eq('id', parentId).eq('business_unit', bu).maybeSingle();
    if (!parent || parent.trashed_at) return notFound('That folder is not available');
    if (parent.visibility !== 'team' || parent.deal_id) return NextResponse.json({ error: 'Forms can only be added to team folders (not private ones)' }, { status: 400 });
  }
  const { data: form } = await admin.from('crm_forms').select('id,name').eq('id', body.form_id).eq('business_unit', bu).maybeSingle();
  if (!form) return notFound('That form is not in the library');

  const { data: sub, error: e1 } = await admin.from('crm_form_submissions')
    .insert({ form_id: form.id, business_unit: bu, title: form.name, values: [], status: 'saved', created_by: ctx.userId }).select('id').single();
  if (e1 || !sub) { console.error('[drive/forms] submission', e1); return NextResponse.json({ error: 'Could not create the form' }, { status: 500 }); }
  const { data: link, error: e2 } = await admin.from('crm_drive_forms')
    .insert({ business_unit: bu, folder_id: parentId, submission_id: sub.id, created_by: ctx.userId }).select(FORM_LINK_COLS).single();
  if (e2 || !link) {
    console.error('[drive/forms] link', e2);
    await admin.from('crm_form_submissions').delete().eq('id', sub.id);   // nothing was filled in yet — don't leave an orphan
    return NextResponse.json({ error: 'Could not add the form to the folder' }, { status: 500 });
  }
  const [item] = await hydrateDriveForms(dc, [link as unknown as Record<string, unknown>]);
  return NextResponse.json({ item });
}
