#!/usr/bin/env python3
"""Emit the fill-once field map for TXR-2402 Compensation Agreement Between Brokers.

Geometry read off the cleaned blank with pdfplumber (see README). Coordinates are
fractions of the page box: fx = x0/W, fy = <the printed rule>/H measured from the
TOP of the page, fw = width/W — which is what TransactionDocEditor expects (it
pins each box's BOTTOM to fy via translateY(-100%) and stamps the value 2pt above
the rule).

Deliberately NOT placed, per the template rule (text + checkbox only, signatures
are added at send-for-signature time):
  · the two "Broker's Signature / Date" rules (y 674.2)
Deliberately NOT placed, because they are underline DECORATION on headings, not
blanks — the 0.72pt rect under "Fees", "or", "Earned and Payable", "Related Parties".
"""
import json, pathlib

W, H = 612.0, 792.0
out = []


def text(key, label, x, y, w):
    out.append({"page": 1, "fx": x / W, "fy": y / H, "fw": w / W, "type": "text",
                "field_key": key, "label": label})


def check(key, label, x, bottom, size):
    out.append({"page": 1, "fx": x / W, "fy": bottom / H, "fw": size / W, "type": "check",
                "field_key": key, "label": label})


# 1. PARTIES ─────────────────────────────────────────────────────────────────
text("listing_broker_name",    "Listing/Principal Broker",                 159.0, 153.1, 417.1)
text("listing_broker_address", "Listing/Principal Broker — full address",  133.1, 164.5, 443.0)
text("listing_broker_phone",   "Listing/Principal Broker — phone",         103.7, 176.1, 148.3)
text("listing_broker_email",   "Listing/Principal Broker — e-mail/fax",    305.4, 176.1, 270.6)
text("coop_broker_name",       "Cooperating Broker",                       146.3, 194.5, 429.8)
text("coop_broker_address",    "Cooperating Broker — full address",        133.1, 205.9, 443.0)
text("coop_broker_phone",      "Cooperating Broker — phone",               103.7, 217.5, 148.3)
text("coop_broker_email",      "Cooperating Broker — e-mail/fax",          305.4, 217.5, 270.6)

# 2. PROPERTY ────────────────────────────────────────────────────────────────
text("property_address",  "Property — full address or description",        179.5, 254.3, 360.6)
check("exhibit_attached", "or as described in an attached exhibit",         54.0, 266.8,   8.9)

# 3. REGISTRATION ────────────────────────────────────────────────────────────
text("client_name",   "Client registered by Cooperating Broker",           266.3, 284.2, 309.8)
text("client_name_2", "Client registered by Cooperating Broker (cont.)",    54.0, 295.7, 342.1)

# 4. TERM ────────────────────────────────────────────────────────────────────
text("term_begin_date", "Term begins on",                                  208.0, 325.6, 116.0)
text("term_end_date",   "Term ends at 11:59 pm on",                        440.2, 325.6, 135.9)

# 5. COOPERATING BROKER'S FEES ───────────────────────────────────────────────
text("sale_fee_pct",   "(1) Sale — % of the sales price",                  116.4, 373.9,  63.6)
text("sale_flat_fee",  "(1) Sale — or a flat fee of $",                    339.5, 373.9,  92.5)
text("lease_fee_pct",  "(2) Lease — % of one full month's rent",           121.0, 385.4,  59.0)
text("lease_flat_fee", "(2) Lease — or $",                                 496.5, 385.4,  79.6)
text("other_fee",      "(3) Other fee terms",                               87.0, 396.9, 489.1)

# Signature block — printed names + licence numbers only. Each rule carries the
# name on the left and "License No." on the right; the caption's "License" word
# (x 243.1 left column, 526.7 right) is where we split them.
text("listing_broker_printed_name", "Listing/Principal Broker's Printed Name",  27.0, 643.1, 211.1)
text("listing_broker_license",      "Listing/Principal Broker — License No.",  240.1, 643.1,  48.0)
text("coop_broker_printed_name",    "Cooperating Broker's Printed Name",       324.1, 643.1, 197.6)
text("coop_broker_license",         "Cooperating Broker — License No.",        523.7, 643.1,  52.4)

check("listing_broker_associate_signs", "Listing/Principal Broker's Associate (signs instead of broker)",  30.0, 695.8, 8.0)
check("coop_broker_associate_signs",    "Cooperating Broker's Associate (signs instead of broker)",       327.1, 695.8, 8.0)

text("listing_broker_associate_name",    "Listing/Principal Broker's Associate's Printed Name",  27.0, 715.6, 211.1)
text("listing_broker_associate_license", "Listing/Principal Broker's Associate — License No.",  240.1, 715.6,  48.0)
text("coop_broker_associate_name",       "Cooperating Broker's Associate's Printed Name",       324.1, 715.6, 197.6)
text("coop_broker_associate_license",    "Cooperating Broker's Associate — License No.",        523.7, 715.6,  52.4)

path = pathlib.Path(__file__).with_name("txr2402.fields.json")
path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
print(f"✓ {path.name}: {len(out)} fields "
      f"({sum(1 for f in out if f['type'] == 'text')} text, "
      f"{sum(1 for f in out if f['type'] == 'check')} check)")
