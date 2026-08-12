# CRECO — Letter of Intent to Lease (generator)

A reusable commercial LOI. Like the 8000 Fair Oaks lease, it is **generated**
(transcribed from the Word original at `Downloads/LOITremplate.docx`) so the
blank template and its fillable-field coordinates come from a single source of
truth.

## Files
- `gen_loi.js` — pdf-lib generator. Lays out the LOI and, as it draws each
  blank, records the field's page + fractional x/y/w and a `field_key`. Repeated
  values (property address ×3, storage-period rent ×2) share a key so they fill
  together ("type once, fill everywhere") in the Transaction Doc editor. The
  "Submitted on behalf of Tenant by" block reuses `agent_name` / `agent_phone` /
  `agent_email` so it auto-fills from the logged-in agent (CRMApp `agentPrefill`).
- `fields.json` — the generated field map (14 keys / 17 boxes).
- `package.json` — marks this folder CommonJS (the repo root is `type: module`).

The generated PDF itself is not committed (regenerable; lives in Supabase storage).

## Regenerate
```bash
cd scripts/forms/8000_fair_oaks_loi
NODE_PATH="../../../node_modules" node gen_loi.js
```
Writes `8000_fair_oaks_loi.pdf` and `fields.json` next to the script.

## Publish to the live CRM (Supabase project FORG — no app deploy needed)
- Storage (bucket `transaction-forms`): upsert `commercial/8000_fair_oaks_loi.pdf`
- Row `crm_forms`: name "Letter of Intent to Lease", category "Letters of Intent",
  business_unit `commercial` (form_id `185d29b9-6fbe-4611-b6c4-9e5e2d54ecf2`)
- Fields `crm_form_fields`: replace rows for that form id from `fields.json`
  (map fx→x, fy→y, fw→w, h=0.02, plus field_key + label)

Editing the LOI wording = edit `gen_loi.js`, regenerate, re-upload the PDF and
replace the field rows.
