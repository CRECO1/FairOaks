# CRECO — Letter of Intent to Purchase (generator)

The purchase-side counterpart to the Lease LOIs, in the same gold letterhead
(`../lib/branding`). Transcribed from the 8000 Fair Oaks Plaza LOI so the blank
template and its fillable-field coordinates come from one source of truth.

## What's different from the Lease LOIs

In the Lease LOIs the term language is static PDF text and only short blanks are
fillable. Here **every value is a field** — including the term paragraphs — and each
field ships a **default**: this deal's standard language, which the agent edits.

Defaults live in `crm_form_fields.default_value`; the Transaction Doc editor seeds
each field's starting text from it (an agent prefill still wins, so
`agent_name`/`agent_email`/`agent_phone` fill with the logged-in sender).

Long values are recorded as **one field per wrapped line** (`option_fee_l1`,
`option_fee_l2`, …). The editor renders every field as a single-line `<input>` and
the filled-PDF builder draws it as one unwrapped line, so per-line fields keep what
the agent sees pinned to what actually prints.

## Files
- `gen_loi_purchase.js` — pdf-lib generator. `termRow()` lays a bold label against a
  wrapped value and never splits a row across a page; `fieldBlock()` handles the
  date / addressee / sign-off; `blankField()` draws the underlined signature blanks.
  Each blank records page + fractional x/y/w + `field_key` + `default`.
- `fields.json` — the generated field map (43 boxes: 35 with defaults, 8 blank).
- `publish.js` — idempotent publisher: uploads the PDF, upserts the `crm_forms` row,
  replaces `crm_form_fields`.
- `preview_filled.js` — dev check. Stamps every default onto the blank template using
  the *same* math as `TransactionDocEditor.build()`, so you can see exactly what an
  agent downloads if they change nothing, and it warns on any line that overflows
  its column.

The generated PDFs aren't committed (regenerable; they live in Supabase storage).

## Regenerate
```bash
cd scripts/forms/loi_purchase
NODE_PATH="../../../node_modules" node gen_loi_purchase.js   # -> loi_purchase.pdf + fields.json
NODE_PATH="../../../node_modules" node preview_filled.js     # -> loi_purchase.preview.pdf (optional)
NODE_PATH="../../../node_modules" node --env-file=../../../.env.local publish.js
```

## Published to the live CRM (Supabase FORG)
- Storage (bucket `transaction-forms`): `commercial/loi_purchase.pdf`
- Row `crm_forms`: name "Letter of Intent to Purchase", form_code `LOI-PURCHASE`,
  category "Letters of Intent", business_unit `commercial`, page_count 2
  (form_id `b58b11d1-c5fb-4861-97c5-97b0ab1026fb`)
- Fields `crm_form_fields`: 43 rows from `fields.json`

### One-time schema change this form depends on
```sql
alter table crm_form_fields add column if not exists default_value text;
```
Applied to FORG on 2026-08-12. Nullable and additive — existing forms are unaffected
(they simply have no defaults). The editor + `PUT /api/crm/forms/[id]/fields` changes
that read and round-trip the column ship with this commit, so **the defaults only
appear in the editor once the app is deployed**. Until then the form lists and opens
with all 43 fields present but empty.

Editing the LOI wording = edit `gen_loi_purchase.js`, regenerate, re-run `publish.js`.
