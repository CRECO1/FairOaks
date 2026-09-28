#!/usr/bin/env python3
"""Fill-once field map for TXR-2404 Commercial Registration Agreement Between Brokers.

Geometry read off the cleaned blank with pdfplumber. Coordinates are fractions of
the page box; `fy` is the printed rule measured from the TOP, which is what
TransactionDocEditor expects (it pins each box's bottom to fy and stamps 2pt above).

NOT placed, and each for a reason:
  · the "By (signature)" and "Date" lines in the page-3 block, and the
    "Initialed for Identification by …" runs in every page footer — signatures,
    initials and signing dates are added at send-for-signature time, not here.
  · the two 11pt Wingdings glyphs beside the "expense reimbursements" boxes on
    page 2 (x 468.5 and 438.3). They are NOT boxes — stamping them drew a bare
    "x" floating next to the real checkbox. Only the 9.8pt glyph is a box.
  · the 0.84pt rules under "Sales", "Leases", "Primary Lease", "Renewals",
    "Subsequent Sale to Prospect", "Entire Agreement", "Notices" and
    "Related Parties" — those are underline decoration on headings, not blanks.
"""
import json, pathlib

W, H = 612.0, 792.0
out = []
def t(page, key, label, x, y, w):
    out.append({"page": page, "fx": x/W, "fy": y/H, "fw": w/W, "type": "text",
                "field_key": key, "label": label})
def c(page, key, label, x, bottom, size=9.8):
    out.append({"page": page, "fx": x/W, "fy": bottom/H, "fw": size/W, "type": "check",
                "field_key": key, "label": label})

# ── PAGE 1 ───────────────────────────────────────────────────────────────────
t(1, "listing_broker_name",    "Listing/Principal Broker",              173.2, 180.3, 402.9)
t(1, "listing_broker_name_2",  "Listing/Principal Broker (cont.)",       72.0, 193.0, 504.1)
t(1, "listing_broker_address", "Listing/Principal Broker — address",    118.7, 205.7, 457.4)
t(1, "listing_broker_phone",   "Listing/Principal Broker — phone",      110.1, 218.4, 178.0)
t(1, "listing_broker_email",   "Listing/Principal Broker — e-mail",     361.5, 218.4, 214.6)
t(1, "listing_broker_fax",     "Listing/Principal Broker — fax",         93.4, 231.1, 194.7)
t(1, "listing_broker_other",   "Listing/Principal Broker — other",      354.9, 231.1, 221.2)
t(1, "coop_broker_name",       "Cooperating Broker",                    156.1, 254.1, 420.0)
t(1, "coop_broker_name_2",     "Cooperating Broker (cont.)",             72.0, 266.8, 504.1)
t(1, "coop_broker_address",    "Cooperating Broker — address",          118.7, 279.5, 457.4)
t(1, "coop_broker_phone",      "Cooperating Broker — phone",            110.1, 292.2, 178.0)
t(1, "coop_broker_email",      "Cooperating Broker — e-mail",           361.5, 292.2, 214.6)
t(1, "coop_broker_fax",        "Cooperating Broker — fax",               93.4, 305.0, 194.7)
t(1, "coop_broker_other",      "Cooperating Broker — other",            354.9, 305.0, 221.2)
t(1, "property_address",       "Property — address",                    118.7, 353.8, 457.4)
t(1, "property_city",          "Property — city",                        97.1, 366.5, 154.9)
t(1, "property_county",        "Property — county",                     296.2, 366.5, 167.4)
t(1, "property_zip",           "Property — zip",                        485.1, 366.5,  91.0)
t(1, "legal_description",      "Legal description",                     374.2, 379.2, 201.9)
for n, y in enumerate([392.0, 404.7, 417.4, 430.2], start=2):
    t(1, f"legal_description_{n}", f"Legal description (line {n})",       72.0, y,     504.1)
t(1, "prospect_name",          "Prospect registered by Cooperating Broker",       228.1, 453.4, 348.1)
t(1, "prospect_name_2",        "Prospect registered by Cooperating Broker (cont.)", 54.0, 466.3, 522.1)
t(1, "sale_deadline",          "4A(1) Sale — binding agreement on or before",     124.6, 601.7, 119.5)
# the % blank here is a run of underscores in the text, not a drawn rule
t(1, "sale_fee_pct",           "4A(1)(a) — % of the sales price",                 108.0, 615.5,  52.7)
t(1, "sale_fee_other",         "4A(1)(b) — other sale fee",                       106.7, 627.1, 464.6)
c(1, "sale_fee_pct_check",     "4A(1)(a) % of the sales price",                    72.0, 615.4)
c(1, "sale_fee_other_check",   "4A(1)(b) other sale fee",                          72.0, 628.2)

# ── PAGE 2 ───────────────────────────────────────────────────────────────────
t(2, "property_address_hdr2",  "Header — registration agreement concerning",      183.2,  45.2, 393.0)
t(2, "lease_deadline",         "4B(1)(a) Primary lease — on or before",           386.9, 103.6, 185.4)
t(2, "lease_base_rent_pct",    "4B(1)(a)(1) — % of all base rents",               124.7, 129.0,  55.3)
t(2, "lease_other_items",      "4B(1)(a)(1) — and (other items)",                 245.9, 154.5, 328.5)
t(2, "lease_fee_other",        "4B(1)(a)(2) — other lease fee",                   124.7, 167.2, 451.4)
t(2, "lease_fee_other_2",      "4B(1)(a)(2) — other lease fee (line 2)",          126.0, 179.9, 450.1)
t(2, "lease_fee_other_3",      "4B(1)(a)(2) — other lease fee (line 3)",          126.0, 192.6, 445.3)
t(2, "lease_pay_upon",         "4B(1)(b)(1) — in one payment upon",               232.1, 230.8, 339.2)
t(2, "lease_pay_other",        "4B(1)(b)(3) — other payment schedule",            126.0, 269.0, 450.1)
t(2, "lease_pay_other_2",      "4B(1)(b)(3) — other payment schedule (line 2)",   126.0, 281.7, 445.3)
t(2, "renewal_base_rent_pct",  "4B(2)(a)(1) Renewal — % of all base rents",       127.1, 355.5,  52.9)
t(2, "renewal_items",          "4B(2)(a)(1) — reimbursements (other)",            324.7, 380.9, 246.7)
t(2, "expansion_base_rent_pct","4B(2)(a)(2) Expansion — % of all base rents",     124.0, 393.7,  56.1)
t(2, "expansion_items",        "4B(2)(a)(2) — reimbursements (other)",            242.3, 419.1, 297.8)
t(2, "renewal_fee_other",      "4B(2)(a)(3) — other renewal fee",                 124.7, 431.8, 451.4)
t(2, "renewal_fee_other_2",    "4B(2)(a)(3) — other renewal fee (line 2)",        108.0, 444.6, 468.1)
t(2, "renewal_fee_other_3",    "4B(2)(a)(3) — other renewal fee (line 3)",        108.0, 457.3, 463.3)
t(2, "subsequent_sale_pct",    "4B(3)(a)(1) — % of the gross sales price",        124.7, 569.2,  64.7)
t(2, "subsequent_sale_other",  "4B(3)(a)(2) — other subsequent-sale fee",         124.7, 582.0, 446.6)
t(2, "special_provisions",     "5. Special provisions",                           179.9, 643.4, 396.2)
for n, y in enumerate([656.3, 669.0, 681.7, 694.4, 707.1], start=2):
    t(2, f"special_provisions_{n}", f"5. Special provisions (line {n})",            54.0, y,     522.1)
t(2, "special_provisions_7",   "5. Special provisions (line 7)",                   54.0, 719.9, 517.3)
for key, label, x, b, sz in [
    ("lease_pct_check",          "4B(1)(a)(1) % of base rents",            90.0, 130.1, 9.8),
    ("lease_expense_check",      "4B(1)(a)(1) expense reimbursements",    518.9, 142.8, 9.8),
    ("lease_and_other_check",    "4B(1)(a)(1) and (other)",               233.0, 155.5, 9.8),
    ("lease_fee_other_check",    "4B(1)(a)(2) other lease fee",            90.0, 168.2, 9.8),
    ("pay_one_payment_check",    "4B(1)(b)(1) in one payment",             90.0, 231.8, 9.8),
    ("pay_two_payments_check",   "4B(1)(b)(2) in two payments",            90.0, 244.6, 9.8),
    ("pay_other_check",          "4B(1)(b)(3) other schedule",             90.0, 270.0, 9.8),
    ("renewal_pct_check",        "4B(2)(a)(1) % of base rents",            90.1, 356.6, 9.8),
    ("renewal_expense_check",    "4B(2)(a)(1) expense reimbursements",    458.6, 369.3, 9.8),
    ("renewal_other_items_check","4B(2)(a)(1) other items",               311.7, 382.0, 9.8),
    ("expansion_pct_check",      "4B(2)(a)(2) % of base rents",            90.0, 394.7, 9.8),
    ("expansion_expense_check",  "4B(2)(a)(2) expense reimbursements",    428.5, 407.4, 9.8),
    ("expansion_other_check",    "4B(2)(a)(2) other items",               229.4, 420.2, 9.8),
    ("renewal_fee_other_check",  "4B(2)(a)(3) other renewal fee",          90.0, 432.9, 9.8),
    ("subsequent_pct_check",     "4B(3)(a)(1) % of gross sales price",     90.0, 570.3, 9.8),
    ("subsequent_other_check",   "4B(3)(a)(2) other",                      90.0, 583.0, 9.8),
]:
    c(2, key, label, x, b, sz)

# ── PAGE 3 ───────────────────────────────────────────────────────────────────
t(3, "property_address_hdr3",  "Header — registration agreement concerning",      183.2,  45.2, 393.0)
t(3, "addenda",                "6. Addenda",                                      385.9,  68.3, 190.2)
t(3, "addenda_2",              "6. Addenda (line 2)",                              54.0,  81.1, 522.1)
t(3, "addenda_3",              "6. Addenda (line 3)",                              54.0,  93.9, 518.8)
# Signature block: the firm-name lines repeat paragraph 1, so they share its key
# and fill together. Everything below them is per-signer and keyed separately.
t(3, "listing_broker_name",    "Listing/Principal Broker",                        143.8, 319.0, 145.1)
t(3, "coop_broker_name",       "Cooperating Broker",                              407.7, 319.0, 162.3)
t(3, "listing_broker_name_2",  "Listing/Principal Broker (cont.)",                 36.8, 334.8, 252.1)
t(3, "coop_broker_name_2",     "Cooperating Broker (cont.)",                      317.9, 336.9, 252.1)
t(3, "listing_broker_license", "Listing/Principal Broker — License No.",          233.8, 353.9,  55.1)
t(3, "coop_broker_license",    "Cooperating Broker — License No.",                514.9, 353.9,  55.1)
t(3, "listing_signer_name",    "Listing/Principal Broker — signer printed name",  115.2, 384.6, 173.7)
t(3, "coop_signer_name",       "Cooperating Broker — signer printed name",        396.3, 384.6, 173.7)
t(3, "listing_signer_title",   "Listing/Principal Broker — signer title",          76.9, 400.0, 103.9)
t(3, "listing_signer_license", "Listing/Principal Broker — signer License No.",   233.8, 400.0,  55.1)
t(3, "coop_signer_title",      "Cooperating Broker — signer title",               358.0, 400.0, 103.9)
t(3, "coop_signer_license",    "Cooperating Broker — signer License No.",         514.9, 400.0,  55.1)

p = pathlib.Path(__file__).with_name("txr2404.fields.json")
p.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
print(f"✓ {p.name}: {len(out)} fields "
      f"({sum(1 for f in out if f['type']=='text')} text, {sum(1 for f in out if f['type']=='check')} check) "
      f"across {max(f['page'] for f in out)} pages")
