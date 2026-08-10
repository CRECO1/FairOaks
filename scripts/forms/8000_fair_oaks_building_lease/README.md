# 8000 Fair Oaks Plaza — Building Lease Agreement (generator)

Our own commercial lease for 8000 Fair Oaks Plaza. Unlike the TXR forms, this one
is **generated** (transcribed from the original Word lease) so the blank template
and its fillable-field coordinates come from a single source of truth.

## Files
- `gen_lease.js` — pdf-lib generator. Lays out the lease and, as it draws each
  blank, records the field's page + fractional x/y/w and a `field_key`. Repeated
  values (tenant name ×5, suite ×5, effective date ×2, …) share a key so they fill
  together ("type once, fill everywhere") in the Transaction Doc editor.
- `fields.json` — the generated field map (14 keys / 26 boxes).

The generated PDF itself is not committed (regenerable; lives in Supabase storage).

## Regenerate
```bash
cd scripts/forms/8000_fair_oaks_building_lease
NODE_PATH="../../../node_modules" node gen_lease.js
```
Writes `8000_fair_oaks_building_lease.pdf` and `fields.json` next to the script.

## Publish to the live CRM (Supabase project FORG — no app deploy needed)
- Storage (bucket `transaction-forms`): upsert `commercial/8000_fair_oaks_building_lease.pdf`
- Row `crm_forms`: name "Building Lease Agreement", category "8000 Fair Oaks Plaza"
- Fields `crm_form_fields`: replace rows for that form id from `fields.json`
  (map fx→x, fy→y, fw→w, h=0.02, plus field_key + label)

Editing the lease wording = edit `gen_lease.js`, regenerate, re-upload the PDF and
replace the field rows.
