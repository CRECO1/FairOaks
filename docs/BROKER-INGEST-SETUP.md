# Broker-Email Ingestion Pipeline — Setup

Reads commercial-real-estate broker **"available space"** listing emails from the
already-connected Gmail account (`zack@crecotx.com`), extracts each listing with
Claude vision, and inserts new buildings into `crm_prospective_properties`
(`business_unit = 'commercial'`, `source = 'broker_email'`) — the commercial "Property DB".

Gmail is **already connected** — there is no OAuth setup. The pipeline reuses the CRM's
stored, auto-refreshing Gmail tokens (`gmail_connections` row for `zack@crecotx.com`).

---

## 1. Env var to add (ONE)

Add to `.env.local` (and to Vercel project env for the deployed cron):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Use the same key the CRECOWEBSITE app uses. This is the only new variable.

Already present in this project's env — confirm they exist, do **not** re-add:

- `CRON_SECRET` — gates the weekly cron route
- `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` — all DB reads/writes go through the Supabase REST API
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Gmail token refresh
- `TOKEN_ENCRYPTION_KEY` — decrypt/encrypt the stored Gmail tokens

Optional override:

- `BROKER_INGEST_MODEL` — defaults to `claude-sonnet-4-6` (vision-capable, cost-effective)

---

## 2. Install

`@anthropic-ai/sdk` is already a dependency in `package.json`, so a plain install pulls in
everything needed:

```
npm install
```

(No new package is added by this feature — the SDK was already present.)

---

## 3. Backfill (one-time historical sweep)

The backfill script sweeps history for the `zack@crecotx.com` connection, extracts, and
dedup-inserts. It is a **DRY RUN by default** (no writes). Run it under `tsx` so the
imported TypeScript transpiles on the fly. Node here is at `/opt/homebrew/bin/node` and is
not on PATH, so call npx by absolute path:

```bash
# Dry run — see what WOULD be inserted (no DB writes)
/opt/homebrew/bin/npx tsx scripts/broker-backfill.mjs

# Narrow the window / cap volume while testing
/opt/homebrew/bin/npx tsx scripts/broker-backfill.mjs --window=newer_than:1y --limit=200

# When the dry-run output looks right, actually insert:
/opt/homebrew/bin/npx tsx scripts/broker-backfill.mjs --commit
```

Flags:

| Flag | Meaning | Default |
|------|---------|---------|
| `--query="..."` | Override the Gmail search query | `unsubscribe (SF OR acres OR "square feet") (lease OR sale OR available OR sublease)` |
| `--window=...` | Append a Gmail recency filter, e.g. `newer_than:2y` | none (all history) |
| `--limit=N` | Max messages to scan | `500` |
| `--commit` | Write to the DB | off (dry run) |

The script prints per-email decisions (listing / not-a-listing / error) and a final summary
with the exact rows it inserted (or, on a dry run, would insert). It is **idempotent** —
re-running skips properties already in the DB via normalized-address dedup.

---

## 4. Weekly cron (ongoing)

`GET /api/cron/broker-ingest` runs weekly and ingests recent emails
(default `newer_than:8d`), inserting only new buildings (idempotent via dedup).

- **Auth:** `Authorization: Bearer $CRON_SECRET` (same as every other cron route).
- **Schedule:** added to `vercel.json` as `30 14 * * 1` (Mondays 14:30 UTC).
- **Returns:** `{ scanned, listings, nonListings, extractErrors, inserted, dupSkipped, model }`.

Manual test against a running server:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://www.fairoaksrealtygroup.com/api/cron/broker-ingest"

# Optional overrides for a manual run:
#   ?window=newer_than:30d   ?query=...   ?limit=40
```

> **Vercel plan note:** `vercel.json` already defined 7 cron entries before this change
> (well over the Hobby plan's 2-cron cap), so the project is on **Pro**. Adding this 8th
> cron is within plan limits. If the project were ever downgraded to Hobby, remove this
> entry and instead call `/api/cron/broker-ingest` from an existing cron dispatcher.

---

## How it works

```
gmail_connections (zack@crecotx.com, auto-refresh tokens)
        │  Gmail REST (raw fetch — no googleapis package)
        ▼
list matching messages ─▶ fetch body + flyer images (base64)
        │
        ▼  Claude vision (model: claude-sonnet-4-6)
one JSON per email: { is_listing, name, address, asset_type, size_sf, asking_rate, ... }
        │  drop is_listing=false (digests, tenant-needs, sold/under-contract, own threads)
        ▼
normalized-address dedup vs. existing commercial rows
        ▼
POST crm_prospective_properties (uniform keys, service-role REST)
```

Code lives in `src/lib/broker-ingest/`:

- `types.ts` — shared types + the `asset_type` enum
- `gmail.ts` — token resolve/refresh reuse + list/get messages + image bytes
- `extract.ts` — Claude-vision extraction + enum validation
- `upsert.ts` — normalized-address dedup + REST insert
- `pipeline.ts` — list → fetch → extract → drop non-listings → dedup-insert
- `index.ts` — public surface

Extraction is conservative by design: Claude never invents an address, price, size, or zip —
unknown fields are left null.
