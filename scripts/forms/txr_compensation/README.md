# TXR compensation agreements

Broker-fee forms for the **Compensation** folder in Transaction Docs.

| Form | crm_forms id | Storage |
|---|---|---|
| TXR-2402 Compensation Agreement Between Brokers (08-23-24, 1 p) | `eb4ab54d-819f-4621-aba2-cad543647c76` | `commercial/clean/txr2402_compensation_agreement_between_brokers.pdf` |
| TXR-2404 Commercial Registration Agreement Between Brokers (4-1-14, 3 p) | `327ea84e-99bc-4730-905c-ae4c55c872fa` | `commercial/clean/txr2404_commercial_registration_agreement_between_brokers.pdf` |

TXR-2402 was rewritten after the NAR settlement — the current edition is
**"Compensation Agreement Between Brokers" 08-23-24**. The older
"Registration Agreement Between Brokers" (1-2-03) is superseded; don't publish
copies of it found online.

The blank was recovered from an executed dotloop copy of the 510 Prinz Dr deal by
stripping the overlay (`scripts/forms/ingest/clean_pdf.mjs --keep 1`). The bytes
were scanned afterwards for every client, broker and dotloop token — all zero.
PDFs stay out of git (`.gitignore`); they live in Supabase storage.

```bash
python3 scripts/forms/txr_compensation/build_fields.py      # regenerate the map
node --env-file=.env.local scripts/forms/ingest/publish_form.mjs \
  scripts/forms/txr_compensation/txr2402.form.json          # republish
```

29 fields: 26 text + 3 checkbox. No signature/initial spots by design — those are
placed at send-for-signature time. Not placed either: the two
"Broker's Signature / Date" rules, and the underline decoration beneath `Fees`,
`or`, `Earned and Payable` and `Related Parties`.


## TXR-2404

**4-1-14 is the current edition.** TXR revised its sibling TXR-2403 (Commercial
Registration Agreement Between Broker *and Owner*) on 1/5/2026 and left 2404
alone, just as it rewrote 2402 into the Compensation Agreement in Aug 2024
without touching this one. Don't "update" it on the assumption that a 2014 date
means stale.

Zack no longer has zipForm, so the blank came from a public copy that carried
another brokerage's footer ("Texas Ally Real Estate Group … Juston Martinez") on
all three pages. That is a *different* problem from a dotloop/zipForm flattening:
the portal imports the blank as a template XObject (`/TPL1 Do`) and draws its own
footer as ordinary text operators beside it, so there is no overlay stream to
drop — `scripts/forms/ingest/strip_stamp.mjs` removes the individual text objects
instead. Bytes were scanned afterwards for every token: all zero.

```bash
python3 scripts/forms/txr_compensation/build_fields_2404.py
node --env-file=.env.local scripts/forms/ingest/publish_form.mjs \
  scripts/forms/txr_compensation/txr2404.form.json --allow-suspect
```

88 fields: 70 text + 18 checkbox, no signature/initial spots. `--allow-suspect`
is **required and correct** here: the publish guard counts text drawn in the page
content streams, and this form's text is all inside the `/TPL1` XObject, so it
reads 0 chars per page and refuses. Verified by rendering all three pages and by
`pdftotext` (1539 / 2016 / 1080 chars). The same blind spot makes audit_forms.mjs
report TREC 16-7 page 2 as empty when it is not.

Traps that cost a pass, beyond the usual underlined headings (`Sales`, `Leases`,
`Primary Lease`, `Renewals`, `Subsequent Sale to Prospect`, `Entire Agreement`,
`Notices`, `Related Parties`):
- The 4A(1)(a) percentage blank is a **run of underscores in the text**, not a
  drawn rule, so the rect scan misses it entirely.
- Page 2 has two **11pt Wingdings glyphs** sitting beside the real 9.8pt
  "expense reimbursements" boxes. They are not boxes — stamping them drew a bare
  "x" floating in the margin. Only the 9.8pt glyph is a checkbox.
