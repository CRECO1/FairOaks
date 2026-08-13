import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, getCrmAdmin, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// The reusable fillable-field template for a form (crm_form_fields).
// GET: any signed-in user (agents fill). PUT: admin only (defines the template).

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_form_fields').select('*').eq('form_id', id).order('sort', { ascending: true });
  if (error) { console.error('[api/form-fields] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ fields: data ?? [] });
}

interface IncomingField { page: number; fx: number; fy: number; fw: number; h?: number; type?: string; signer_role?: string | null; label?: string; field_key?: string; default_value?: string | null; }

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCrmAdmin(req);
  if (!admin) return forbidden('Only an admin can edit a form template.');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const fields: IncomingField[] = Array.isArray(body.fields) ? body.fields : [];
  const supabase = adminClient();
  await supabase.from('crm_form_fields').delete().eq('form_id', id);
  if (fields.length) {
    const rows = fields.map((f, i) => ({
      form_id: id, page: f.page ?? 1,
      x: f.fx, y: f.fy, w: f.fw, h: f.h ?? 0.022,
      type: f.type ?? 'text', signer_role: f.signer_role ?? null, label: f.label ?? null, field_key: f.field_key ?? null, sort: i,
      // The template's starting text (e.g. the standard LOI terms). The editor
      // seeds it as the field's value; PUT round-trips it so re-saving a layout
      // doesn't wipe the defaults.
      default_value: f.default_value ?? null,
    }));
    const { error } = await supabase.from('crm_form_fields').insert(rows);
    if (error) { console.error('[api/form-fields] PUT', error); return NextResponse.json({ error: 'Save failed' }, { status: 500 }); }
  }
  return NextResponse.json({ ok: true, count: fields.length });
}
