# CRECO — letter-style Letter of Intent to Lease (generator)

The two-column **label : value** LOI layout (the Office/Industrial format the user
prefers), rebranded from the original Caisson LOI into the CRECO gold format.
One generator drives **both** the Office and Industrial templates — the source
documents were identical, so they share this layout and differ only by name.

## Files
- `gen_letter_loi.js` — pdf-lib generator. `flowCol()` wraps text/fields inside a
  column and draws each run as a single string (native spacing); `row(label,value)`
  lays a bold label against a wrapped value and never splits a row across a page.
  Records each blank's page + fractional x/y/w + field_key. The sign-off block
  reuses `agent_name`/`agent_phone`/`agent_email` so it auto-fills from the logged-in
  agent (CRMApp `agentPrefill`).
- `loi_letter.fields.json` — the generated field map (19 keys / 19 boxes).
- `package.json` — marks this folder CommonJS (the repo root is `type: module`).

The generated PDF isn't committed (regenerable; lives in Supabase storage).

## Regenerate
```bash
cd scripts/forms/loi_letter
NODE_PATH="../../../node_modules" node gen_letter_loi.js
```
Writes `loi_letter.pdf` and `loi_letter.fields.json`.

## Published to the live CRM (Supabase FORG — no app deploy needed)
Same blank PDF is published as TWO `crm_forms` rows (category `Letters of Intent`,
business_unit `commercial`), each with its own storage path + a copy of the fields:
- **Office — Letter of Intent to Lease** — `commercial/office_loi.pdf` (form_id `5079ae91-2261-4606-9bd6-d19f6a9e674e`)
- **Industrial — Letter of Intent to Lease** — `commercial/industrial_loi.pdf` (form_id `0962a496-0faf-48e1-a05d-bcfff590e24c`)

To differentiate the two later (e.g. add clear-height / dock-door / power lines to
the Industrial variant), split this into per-variant clause blocks, regenerate, and
re-upload the changed PDF + replace that form's `crm_form_fields`.
