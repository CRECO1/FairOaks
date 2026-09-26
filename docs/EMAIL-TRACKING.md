# Email tracking — opens, clicks, and the watchdog

How campaign email tracking works, where each piece lives, and what to check
when the numbers look wrong.

## The short version

Opens are tracked **twice, by two independent mechanisms**. Clicks are tracked
**once, by Resend only**. That asymmetry is the single most important thing on
this page: opens can keep working while clicks are completely broken, so a
healthy-looking open rate is *not* evidence that tracking is fine.

| | Who does it | Where it lands |
|---|---|---|
| Open (our pixel) | 1×1 image we inject before `</body>` | `crm_campaign_sends.opened_at` / `open_count` |
| Open (Resend) | Resend's own pixel, injected at delivery | `email_tracking_events` (`event_type='open'`) |
| **Click** | **Resend only** — it rewrites every link | `email_tracking_events` (`event_type='click'`) |

## Opens

**Our pixel.** `cron/campaigns` injects `…/api/track/open?type=campaign&id=<tracking_id>`
into the HTML before sending (`src/lib/email-tracking.ts` does the same for
action-plan mail). The recipient's mail client loads it, `/api/track/open`
stamps `crm_campaign_sends.opened_at` and bumps `open_count`.

**Resend's pixel.** Separately, Resend injects its own pixel at delivery time
and fires an `email.opened` webhook, which we store in `email_tracking_events`.

These two are deliberately kept apart. The Resend webhook handler does **not**
write to `crm_campaign_sends.opened_at` — if it did, one open would be counted
twice and every open rate in the app would inflate.

## Clicks

There is no CRECO-side click tracking at all. The entire chain is Resend's:

1. **Link rewriting.** With click tracking enabled on the domain, Resend
   rewrites every `href` at delivery into
   `https://track.crecotx.com/CL0/<encoded-url>/…`. This needs the `track`
   CNAME → `links1.resend-dns.com`.
2. **The click.** The recipient hits `track.crecotx.com`, Resend logs it and
   302s to the real destination.
3. **The webhook.** Resend POSTs `email.clicked` to
   `/api/webhooks/resend`, svix-signed.
4. **Ingestion.** `recordCampaignEvent()` matches `data.email_id` against
   `crm_campaign_sends.provider_id` and inserts into `email_tracking_events`.

Break any one link and clicks silently become zero.

### The trap: Resend's API returns pre-processing HTML

`GET /emails/{id}` returns the HTML **as submitted**, not as delivered. Links
look raw and Resend's pixel is absent even when both are working perfectly.
**Do not use it to decide whether rewriting is on.** To check for real, read a
delivered message out of an actual mailbox — a rewritten link starts
`https://track.crecotx.com/CL0/`.

## What went wrong on 2026-09-25 (why the watchdog exists)

The Elkhorn campaign went out at **14:45 UTC**. Commit `3abf6f7`, which added
the campaign branch to the webhook handler, deployed at **21:09 UTC** —
6h24m later. Until it landed, every campaign event reached the handler, matched
no e-sign signer, and was answered `200 {ok:true}`. Resend read that as success
and never retried.

Resend recorded **15 clicks**. The CRM recorded **0**. Opens started landing at
21:12 UTC, three minutes after the deploy, so tracking looked alive the whole
time.

Those clicks are gone for good: Resend's `/events` endpoint returns nothing
historical, and the per-message record exposes `last_event` and recipient but
no click timestamp or clicked URL. **A click missed is a click lost** — which is
why this is monitored rather than reconciled after the fact.

## The watchdog

`src/app/api/cron/tracking-health/route.ts`, every 6 hours (`vercel.json`).

Four checks, cheapest first:

1. **Config** — Resend still reports `click_tracking: true` on `crecotx.com`,
   and the domain is still `verified`. Catches the dashboard toggle being
   turned off. → `error`
2. **Tracking host** — `https://track.crecotx.com` still answers. Catches the
   CNAME or its certificate breaking. → `error`
3. **Reconciliation** — samples up to 40 sends from the last 7 days (older than
   a 12h grace window), asks Resend for each message's `last_event`, and
   compares against our stored click rows. **If Resend reports clicks and we
   hold none, ingestion is broken.** This is the check that would have caught
   the Elkhorn failure, and it works regardless of *which* part of our side is
   at fault, because it trusts an external oracle rather than our own data. → `error`
4. **Opens without clicks** — a campaign with ≥15 opens and zero clicks more
   than 12h after sending. A campaign genuinely can go unclicked, so this only
   ever reports `degraded`. → `degraded`

Alerting matches the lead-importer cron exactly: de-duplicated through
`crm_integration_status` (id `email_tracking`), alerting on the way into
trouble, on worsening, or hourly while still broken, with one note on recovery.
**A healthy run writes a timestamp and sends nothing.** Failures also return
HTTP 500 so the endpoint itself is visibly unhealthy, not just the email.

### Gotcha: Cloudflare blocks unrecognised clients

`api.resend.com` sits behind Cloudflare, which 403s (`error code: 1010`) any
request without a plausible `User-Agent` — Python's `urllib` gets blocked,
`curl` does not. The watchdog always sends a UA, and **treats a failed lookup
as unknown rather than as "no clicks"**, so a blocked API can never be
misreported as a healthy zero. Worth remembering if you script against Resend.

## Where things live

| Thing | Path |
|---|---|
| Open pixel injection (campaigns) | `src/app/api/cron/campaigns/route.ts` |
| Open pixel injection (action plans) | `src/lib/email-tracking.ts` |
| Open pixel endpoint | `src/app/api/track/open/route.ts` |
| Resend webhook handler | `src/app/api/webhooks/resend/route.ts` |
| Watchdog | `src/app/api/cron/tracking-health/route.ts` |
| Event store | `email_tracking_events` |
| Per-send state | `crm_campaign_sends` (`opened_at`, `open_count`, `provider_id`) |
| Watchdog state | `crm_integration_status` (id `email_tracking`) |

## Manual checks

```bash
# Is click tracking on, and is the domain verified?
curl -s -H "Authorization: Bearer $RESEND_API_KEY_COMMERCIAL" \
  https://api.resend.com/domains

# What does Resend think happened to one message?
curl -s -H "Authorization: Bearer $RESEND_API_KEY_COMMERCIAL" \
  https://api.resend.com/emails/<provider_id>   # → last_event

# Does the webhook subscription still include email.clicked?
curl -s -H "Authorization: Bearer $RESEND_API_KEY_COMMERCIAL" \
  https://api.resend.com/webhooks
```

To verify end to end for real: send yourself a message from `noreply@crecotx.com`
with a link, open it in a mailbox, confirm the href starts
`https://track.crecotx.com/CL0/`, click it, and check `email_tracking_events`
for an `event_type='click'` row. A `crm_campaign_sends` row whose `provider_id`
matches the message must exist, or the handler has nothing to attach the click to.
