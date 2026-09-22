# Importing a TXR / TREC form into the Transaction Docs library

Two steps: **clean the PDF to a true blank**, then **publish it with a field map**.

Every earlier import did this from throwaway scratchpad scripts, so the work was
lost each time. It lives here now.

## 1. Clean

zipForm, dotloop and DocuSign all "flatten" a filled form by **appending** a
content stream to the page: for each value they paint a white rectangle over the
blank, draw the text, then redraw the underline. The original blank survives
untouched as an earlier stream in the page's `/Contents` array — so the whole
job is dropping the appended stream.

```bash
# see what each content stream contains
node scripts/forms/ingest/clean_pdf.mjs in.pdf out.pdf --inspect
# keep only the original form (index from --inspect)
node scripts/forms/ingest/clean_pdf.mjs in.pdf out.pdf --keep 1
```

It also drops `/Annots`, `/AcroForm`, XMP metadata and any `/XObject` the
surviving streams never draw, then rewrites through **qpdf** to garbage-collect.

> **The struct tree is the trap.** In a tagged PDF the signature widget, its
> PKCS7 blob and the verification `/URI` actions stay *reachable* through
> `/StructTreeRoot`, so they survive both the save and a plain qpdf pass. The
> script deletes it; without that, the signer's trail is still in the bytes.

**Always verify the bytes, not the render** — a value can be invisible and still
present:

```bash
qpdf --qdf --decode-level=all out.pdf check.pdf
grep -aoic "dotloop\|<a client name>\|Signature1" check.pdf   # want 0
pdftoppm -png -r 110 out.pdf page && open page-1.png
```

If the form came from zipForm with RC4 permission encryption, normalise it
*first* — `qpdf --decrypt --object-streams=disable` — or pdf-lib mangles the save
and the editor's download comes out corrupt.

## 2. Field map

Coordinates are fractions of the page box, and `fy` is **the printed rule**
measured from the top: `TransactionDocEditor` pins each box's bottom to `fy` via
`translateY(-100%)` and stamps the value 2pt above it.

```
fx = x0 / W      fy = rule_top / H      fw = width / W
```

Finding the blanks depends on where the PDF came from:

| Source | blanks | checkboxes |
|---|---|---|
| Word export (dotloop) | filled rects, height ~0.72pt | Wingdings `❑` glyph |
| zipForm TXR export | lines, ~0.43pt | squares from ~0.29pt line pairs |
| Official TREC PDF | the AcroForm widget rects | `Btn` widgets |

Rules that keep biting:

- **~0.79pt lines in zipForm files are underlined HEADINGS, not blanks.** Same in
  Word exports: the rect under `Fees`, `or`, `Earned and Payable`, `Related
  Parties` is decoration. Reject any rule with words sitting on it.
- **No signature, initials or date-signed fields on a template** — text and
  checkbox only. Those are placed at send-for-signature time.
- Keep `Printed Name` / `License No.`; one rule often carries both, so split it
  at the x of the caption's "License" word.
- Label from the text touching the blank, and let a continuation line inherit the
  label above it.
- Reuse a `field_key` across spots that hold the *same* value — they fill
  together. Don't reuse `agent_*` keys on a form with two broker blocks, or
  `agentPrefill` drops the logged-in agent into both sides.

Verify by stamping **every** field with the editor's own math and rasterising the
result before you publish — see `scripts/forms/txr_compensation/build_fields.py`.

## 3. Publish

```bash
node --env-file=.env.local scripts/forms/ingest/publish_form.mjs <config.json>
```

Upserts the PDF into the `transaction-forms` bucket, upserts the `crm_forms` row
(matched on `business_unit` + `name`) and replaces its `crm_form_fields`.
Idempotent. No app deploy is needed — but the forms list caches for ~45s per
instance, so a new form can take a minute to show up.

After replacing a PDF already in storage, an immediate re-download returns the
**old** bytes from cache. Re-read a moment later before concluding the write
failed.
