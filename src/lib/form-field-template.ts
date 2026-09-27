/**
 * Seed a blank submission's overlay fields from its form's template, server-side.
 *
 * This existed only in the browser: TransactionDocEditor loaded crm_form_fields and
 * turned each row into an editor field. Anything that created a submission outside
 * the editor — the copilot's start_form, and now form auto-fill — produced a document
 * with `values: []`, which looks fine until you try to fill it and discover there is
 * nothing there to fill.
 *
 * Kept deliberately identical to the editor's rowToField so a document seeded here and
 * one seeded in the browser are the same document.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TemplateRow {
  page: number | null; x: number; y: number; w: number; h: number | null;
  type: string | null; signer_role: string | null; label: string | null;
  field_key: string | null; default_value: string | null; required?: boolean | null;
}

export interface OverlayField {
  id: string; page: number; fx: number; fy: number; fw: number; size: number;
  type: 'text' | 'check' | 'signature' | 'initial' | 'date';
  value: string; signerRole?: string; fieldKey?: string; label?: string;
  defaultValue?: string; required?: boolean;
}

function normalizeType(t: string | null): OverlayField['type'] {
  const v = String(t || 'text');
  if (v === 'check') return 'check';
  if (v === 'signature') return 'signature';
  if (v === 'initial') return 'initial';
  if (v === 'date' || v === 'date_signed') return 'date';
  return 'text';
}

/**
 * @param prefill field_key → value. The agent's own details and anything auto-fill
 *                resolved; wins over the template's default_value, exactly as the
 *                editor does it.
 */
export function rowsToFields(rows: TemplateRow[], prefill: Record<string, string> = {}): OverlayField[] {
  return rows.map((r, i) => ({
    id: `f${i + 1}`,
    page: r.page ?? 1,
    fx: r.x, fy: r.y, fw: r.w,
    size: 11,
    type: normalizeType(r.type),
    value: (r.field_key && prefill[r.field_key]) || r.default_value || '',
    ...(r.signer_role ? { signerRole: r.signer_role } : {}),
    ...(r.field_key ? { fieldKey: r.field_key } : {}),
    ...(r.label ? { label: r.label } : {}),
    ...(r.default_value ? { defaultValue: r.default_value } : {}),
    ...(r.required ? { required: true } : {}),
  }));
}

/** Load a form's template and seed it. Returns [] for a form with no template. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedFieldsForForm(db: SupabaseClient<any, any, any>, formId: string, prefill: Record<string, string> = {}): Promise<OverlayField[]> {
  const { data } = await db.from('crm_form_fields')
    .select('page, x, y, w, h, type, signer_role, label, field_key, default_value, required')
    .eq('form_id', formId).order('sort', { ascending: true });
  return rowsToFields((data ?? []) as TemplateRow[], prefill);
}
