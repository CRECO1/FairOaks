import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCrmContext, unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { assertCanSeeRentRoll } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { buildLease, normalizeLeaseValues, type LeaseValues } from '@/lib/lease-doc';

/**
 * POST /api/crm/lease-draft
 *
 * Turns a sentence — "24 months for Ashley Pugh, 3101, $808 then $840 from Oct 1,
 * no deposit" — into the values the lease generator takes, so an agent fills a form
 * by describing the deal instead of typing twelve fields.
 *
 * It drafts. It does not write. Nothing here creates a document, touches the rent
 * roll or sends anything — the route returns proposed values and the rent-roll row
 * it matched them against, and a human approves them in the UI. That division is
 * deliberate: the slow part of writing a lease is never the typing, it is knowing
 * which suite, whose name, and which of two rents is real, and those are exactly
 * the questions a model answers confidently and sometimes wrongly.
 *
 * Reads tenant data, so it answers to the rent-roll gate rather than plain listing
 * access — an agent who cannot see the roll cannot read it back out through here.
 */

const MODEL = 'claude-opus-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['values', 'matched_suite', 'notes'],
  properties: {
    values: {
      type: 'object',
      additionalProperties: false,
      required: ['tenant_name', 'building', 'suite', 'effective_date', 'term_months',
                 'end_date', 'monthly_rent', 'security_deposit', 'tenant_phone', 'tenant_email',
                 'monthly_rent_year2', 'year2_start', 'internet_fee'],
      properties: {
        tenant_name:        { type: 'string', description: 'Legal name of the tenant as it should appear on the lease.' },
        building:           { type: 'string' },
        suite:              { type: 'string', description: 'Suite number(s). Several rooms on one lease: "3118 & 3205".' },
        effective_date:     { type: 'string', description: 'Start date, written long: "October 1, 2026".' },
        term_months:        { type: 'string' },
        end_date:           { type: 'string', description: 'Last day of the term, written long. Must equal start + term − 1 day.' },
        monthly_rent:       { type: 'string', description: 'Year-one monthly rent, digits only with two decimals: "808.00".' },
        security_deposit:   { type: 'string', description: 'Empty string when no deposit is being taken.' },
        tenant_phone:       { type: 'string' },
        tenant_email:       { type: 'string' },
        monthly_rent_year2: { type: 'string', description: 'Empty string unless the rent steps up mid-term.' },
        year2_start:        { type: 'string', description: 'Empty string unless the rent steps up. Long date.' },
        internet_fee:       { type: 'string', description: 'Monthly internet charge billed on top of rent, digits with two decimals. Empty string unless the request mentions internet.' },
      },
    },
    matched_suite: { type: 'string', description: 'The rent-roll suite this was drawn from, or "" if none matched.' },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything the agent must check: a guess, an ambiguity, a value not in the request or the roll, a conflict with the current lease.',
    },
  },
} as const;

// The model returns dates as ISO and money without cents about half the time, whatever
// the schema says. Both are mechanical, so they are fixed here rather than left to the
// prompt — a deterministic pass removes the whole class of error.
const LONG = (d: string): string => {
  const t = (d || '').trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return t;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};
const MONEY = (v: string): string => {
  const t = (v || '').trim();
  if (!t) return '';
  const n = Number(t.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t;
};

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!process.env.ANTHROPIC_API_KEY) {
    // Loud, not silent — the broker-ingest crawl already taught us what a quiet
    // Anthropic failure costs in confusion.
    return NextResponse.json({ error: 'Lease drafting is unavailable: no Anthropic API key is configured.' }, { status: 503 });
  }

  const { listing_id, prompt } = await req.json().catch(() => ({}));
  if (!listing_id || !String(prompt || '').trim()) {
    return NextResponse.json({ error: 'listing_id and prompt required' }, { status: 400 });
  }
  if (!(await assertCanSeeRentRoll(listing_id, ctx))) return notFound('Property not found');

  const db = adminClient();
  const { data: roll } = await db.from('crm_property_tenants')
    .select('suite, tenant_name, contact_name, email, phone, building, size_sf, monthly_rent, lease_start, lease_expiration')
    .eq('listing_id', listing_id).order('suite');

  const tenants = (roll ?? []).filter(t => t.suite && !/^vacant$/i.test(t.tenant_name ?? ''));
  const today = new Date().toISOString().slice(0, 10);

  const system = [
    'You prepare lease values for a commercial brokerage. You do not write the lease;',
    'an agent reviews everything you return and presses the button.',
    '',
    'Rules:',
    '- Draw the tenant name, suite, building, phone and email from the rent roll below.',
    '  Match on any name the roll carries — the business name OR the contact name; agents',
    '  often refer to a tenant by the person rather than the company.',
    '- Never invent a phone number, an email or a square footage. If the roll has none,',
    '  return an empty string and say so in notes.',
    '- end_date must be exactly start + term − 1 day. Compute it; do not guess.',
    '- Leave security_deposit empty when the request says there is no deposit. Do not',
    '  default it to one month.',
    '- Only fill monthly_rent_year2 / year2_start when the request describes a step-up.',
    '- An internet charge goes in internet_fee, never folded into monthly_rent.',
    '- Put every assumption, ambiguity and conflict in notes. If the request contradicts',
    '  the rent roll — a different rent, an overlapping lease — say so rather than',
    '  silently preferring one.',
    `- Today is ${today}.`,
    '',
    'Rent roll for this property:',
    JSON.stringify(tenants),
  ].join('\n');

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: String(prompt) }],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'The request was declined. Rephrase it and try again.' }, { status: 422 });
    }
    const text = response.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No draft came back. Try again.' }, { status: 502 });
    }
    const draft = JSON.parse(text.text);
    const v = draft.values ?? {};
    for (const k of ['effective_date', 'end_date', 'year2_start']) v[k] = LONG(v[k]);
    for (const k of ['monthly_rent', 'monthly_rent_year2', 'security_deposit', 'internet_fee']) v[k] = MONEY(v[k]);
    const matched = tenants.find(t => String(t.suite) === String(draft.matched_suite)) ?? null;
    return NextResponse.json({ ...draft, values: v, matched, model: MODEL });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Anthropic is rate limiting right now — try again in a moment.' }, { status: 429 });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'The Anthropic API key was rejected — check it is current and in credit.' }, { status: 502 });
    }
    console.error('[lease-draft]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not draft the lease' }, { status: 500 });
  }
}

/**
 * PUT /api/crm/lease-draft — generate the lease from approved values.
 *
 * Separate verb on purpose: POST proposes, PUT commits, and only after a person has
 * looked at the numbers. Produces exactly the record the manual flow produces — same
 * generator, same submission shape — and files it against the property and, when the
 * suite has one, the tenant's contact.
 */
const LEASE_FORM_ID = 'de642507-388e-4ab4-b19e-b2b385841ddc';
// Human names for the edit history when a generated lease is regenerated.
const LEASE_LABELS: Record<string, string> = {
  tenant_name: 'Tenant name', building: 'Building', suite: 'Suite', effective_date: 'Start date',
  term_months: 'Term', end_date: 'End date', monthly_rent: 'Monthly rent', monthly_rent_year2: 'Year 2 rent',
  year2_start: 'Year 2 start', internet_fee: 'Internet', security_deposit: 'Security deposit',
  tenant_phone: 'Tenant phone', tenant_email: 'Tenant email', tenant_signer: 'Signing for tenant',
};

export async function PUT(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { listing_id, values, submission_id } = await req.json().catch(() => ({}));
  if (!values) return NextResponse.json({ error: 'values required' }, { status: 400 });
  // Two uses: create a lease on a property (listing_id), or regenerate an existing
  // generated lease after its values were edited (submission_id). A generated lease
  // can't be re-edited as overlay fields — its clauses reflow with the values, so its
  // saved field positions don't line up with the blank master template.
  let listingRow: Record<string, unknown> | null = null;
  let prior: { listing_id: string | null; builder_data: Record<string, unknown> | null } | null = null;
  if (submission_id) {
    if (!(await assertOwnsResource('crm_form_submissions', submission_id, ctx))) return notFound('Document not found');
    const { data } = await adminClient().from('crm_form_submissions').select('listing_id, builder_data, form_id').eq('id', submission_id).maybeSingle();
    if (!data || data.form_id !== LEASE_FORM_ID) return notFound('Document not found');
    prior = { listing_id: data.listing_id ?? null, builder_data: (data.builder_data as Record<string, unknown>) ?? null };
  } else {
    if (!listing_id) return NextResponse.json({ error: 'listing_id and values required' }, { status: 400 });
    listingRow = await assertCanSeeRentRoll(listing_id, ctx);
    if (!listingRow) return notFound('Property not found');
  }

  // Derived values (the rent + internet total) are filled here, so the stored field
  // values, builder_data and the printed PDF all carry the same figure.
  const v = normalizeLeaseValues(values as LeaseValues & { suite?: string });
  if (!String(v.tenant_name || '').trim() || !String(v.suite || '').trim()) {
    return NextResponse.json({ error: 'A tenant name and a suite are required.' }, { status: 400 });
  }

  const db = adminClient();
  // Link the document to the tenant's contact where the roll knows one, so it lands on
  // their card as well as the property.
  const { data: row } = listing_id
    ? await db.from('crm_property_tenants').select('contact_id').eq('listing_id', listing_id).eq('suite', String(v.suite)).maybeSingle()
    : { data: null };

  try {
    const { pdf, blanks } = await buildLease(v);
    const fields = blanks.map((b, i) => ({
      id: `f${i}`, page: b.page, fx: b.fx, fy: b.fy, fw: b.fw, size: 11, type: b.type,
      value: b.field_key ? ((v as Record<string, string | undefined>)[b.field_key] ?? '') : '',
      ...(b.signer_role ? { signerRole: b.signer_role } : {}),
      ...(b.field_key ? { fieldKey: b.field_key } : {}), label: b.label,
    }));

    const path = `submissions/${LEASE_FORM_ID}/${Date.now()}_${Math.round(Math.random() * 1e6)}.pdf`;
    const { error: upErr } = await db.storage.from('transaction-forms')
      .upload(path, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
    if (upErr) { console.error('[lease-draft] upload', upErr); return NextResponse.json({ error: 'Could not save the lease PDF' }, { status: 500 }); }

    if (submission_id && prior) {
      // Regenerate in place: new PDF + values, same document (links and title kept).
      const { data, error } = await db.from('crm_form_submissions')
        .update({ values: fields, builder_data: v, filled_path: path, status: 'saved', updated_at: new Date().toISOString() })
        .eq('id', submission_id).select('id, title, client_id').single();
      if (error) { console.error('[lease-draft] update', error); return NextResponse.json({ error: 'Could not save the lease' }, { status: 500 }); }
      // Audit trail, in the same table the document editor's History panel reads.
      const before = prior.builder_data ?? {};
      const changed = Object.keys(LEASE_LABELS).filter(k => String((before as Record<string, unknown>)[k] ?? '') !== String((v as Record<string, unknown>)[k] ?? ''));
      if (changed.length) {
        const names = changed.map(k => LEASE_LABELS[k]);
        const summary = `Edited ${names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} +${names.length - 4} more`}`;
        try {
          await db.from('crm_form_submission_edits').insert({ submission_id, editor_id: ctx.userId, business_unit: ctx.businessUnit ?? 'commercial', summary, changes: { edited: names, fields: changed } });
        } catch (e) { console.error('[lease-draft] edit-log', e); }
      }
      return NextResponse.json({ submission: data });
    }

    const term = String(v.term_months || '').trim();
    const { data, error } = await db.from('crm_form_submissions').insert({
      form_id: LEASE_FORM_ID, listing_id, client_id: row?.contact_id ?? null,
      // The property's workspace, not the caller's: an admin working from another
      // workspace must not file this lease where the property's agents can't see it.
      business_unit: (listingRow?.business_unit as string | undefined) ?? ctx.businessUnit ?? 'commercial',
      title: `${v.tenant_name} — Lease Agreement (Suite ${v.suite}${term ? `, ${term} mo` : ''})`,
      values: fields, status: 'saved', filled_path: path, builder_data: v, created_by: ctx.userId,
    }).select('id, title, client_id').single();
    if (error) { console.error('[lease-draft] insert', error); return NextResponse.json({ error: 'Could not save the lease' }, { status: 500 }); }

    return NextResponse.json({ submission: data, linked_to_contact: !!row?.contact_id });
  } catch (e) {
    console.error('[lease-draft] build', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not build the lease' }, { status: 500 });
  }
}
