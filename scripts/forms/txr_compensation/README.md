# TXR compensation agreements

Broker-fee forms for the **Compensation** folder in Transaction Docs.

| Form | crm_forms id | Storage |
|---|---|---|
| TXR-2402 Compensation Agreement Between Brokers (08-23-24, 1 p) | `eb4ab54d-819f-4621-aba2-cad543647c76` | `commercial/clean/txr2402_compensation_agreement_between_brokers.pdf` |

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
