# Security audit — fairoaksrealtygroup.com / Fair Oaks CRM — October 2026

**Audited:** the production code = tip of `consolidate/props-plus-calls` (`b71dce1`), 180 API routes, middleware, `next.config.js`, `src/lib`, the Supabase schema/RLS/storage **as deployed** (read-only catalog queries), git history (1,480 commits, all refs), npm dependencies.
**Method:** full route inventory (auth-token grep over all 180 routes) + five parallel read-only code reviews + my own cross-cutting checks. **No code was changed, nothing was deployed, no writes were made to any system.** This report file is the only addition (uncommitted).
**Confidence tags:** **[V]** = I re-read the code/queried the system myself and confirmed it. **[R]** = reported by a reviewer who read the code; not independently re-verified. Line numbers are as of `b71dce1`.

---

## 0. Summary

| Severity | Count | Needs action now? |
|---|---|---|
| **Critical** | 1 | **Yes** — Gmail OAuth callback account-linking |
| **High** | 8 | Yes, this week (H1–H3, H8 first) |
| Medium | 15 | Schedule |
| Low | ~14 | Backlog |

**There is no confirmed unauthenticated read of CRM data.** The database is in good shape (RLS on 90/90 tables, no secrets in git, webhooks are signed, crons fail closed). The real exposure is (a) a few OAuth flows that trust a browser cookie instead of the logged-in user, (b) **Supabase sign-up is open**, so "any logged-in user" is not a trust boundary, and (c) many routes authorise by *workspace* only, so any agent can act on any colleague's records.

### Prior audit (`fix/audit-high-1-3`, `audit/security-2026-10`, `audit/mobile-2026-10`)
All three branches sit at `fa951b7`, which **is an ancestor of production** — merged. There is no `SECURITY-AUDIT*.md` in any branch; the work is recorded in `supabase/security-lockdown-2026-10.sql` (applied 2026-10-07) and commits `69775b9`, `5dae8c4`, `708bca7`. Spot-checked as present in production: `auth/social/done` XSS fix (identical to `main`), commissions/tasks/timeline ownership checks, `campaigns/preview` relay fix (recipient is always the caller's own profile email). `contacts/export` no longer exists in production (CSV exports were removed on purpose). The blog/Posts fixes are moot (Payload CMS was removed). `main` is **not** what deploys — production builds from `consolidate`; see `CLAUDE.md`.

---

## 1. CRITICAL

### C1. Gmail OAuth callback binds *any* Google account to *any* CRM user — [V]
`src/app/api/gmail/callback/route.ts:73-82` (nonce check), `:141-160` (upsert into `gmail_connections`); `src/app/api/gmail/auth/route.ts:36-41` (nonce cookie).
- **Risk:** The callback never checks who is logged in. It takes `userId` from the `state` query string and "protects" it by comparing the state nonce with a cookie `gmail_oauth_nonce`. Both values come from the *requester's own browser*, so an attacker simply sets the cookie to match their forged state. The comment ("blocks account-linking CSRF") is wrong.
- **Exploit:** Attacker builds a Google consent URL with the app's (public) `client_id`, `redirect_uri=…/api/gmail/callback` and `state=<victimProfileUUID>|commercial||N`; sets cookie `gmail_oauth_nonce=N`; consents with *their own* Gmail. The callback stores the attacker's tokens under the victim's `user_id` (insert, or update of the victim's existing row). From then on the victim's CRM sends mail *through the attacker's mailbox*: every client email the victim sends from the CRM lands in the attacker's Sent folder, replies go to the attacker, and the victim's real connection is replaced (silent outage). Needs only a victim `crm_profiles` UUID (visible to any CRM user in many API lists). Works unauthenticated; if the Google OAuth app is in "Testing" mode only listed test users can consent, which would limit it — not verifiable from code.
- **Fix:** In the callback, require a session (`getCrmUser`) and refuse unless `session.user.id === state.userId`; replace the positional state with an HMAC-signed `{uid, nonce, exp}` (as `auth/social/twitter` already does). Rotate/clear any connection created from an unexpected IP/time if you want to check for past abuse (see "How to check" at the end).

---

## 2. HIGH

### H1. Social OAuth connects (Facebook, YouTube unauthenticated; LinkedIn unsigned state) — [V Facebook; R others]
`src/app/api/auth/social/facebook/route.ts:12-34` and `youtube/route.ts` (no `getCrmUser()`; only checks the `?userId=` exists in `crm_profiles`, `:25`); callbacks trust `userId` from the same unsigned `state` (`facebook/callback`, `youtube/callback`); `linkedin/callback/route.ts:19` (`split(':')` of an unsigned state — init route requires login but a logged-in agent can edit the state's userId).
- **Exploit:** same pattern as C1: `GET /api/auth/social/facebook?userId=<victim>` in the attacker's own browser, consent with their own Facebook/Google → attacker's pages/channel are stored under the victim's `agent_id`. The victim's scheduled posts (`cron/social-publish`) publish to the attacker's page; duplicate active rows make `.maybeSingle()` error so the victim's publishing/replies silently stop. The 403 "Invalid userId" is also a UUID-existence oracle.
- **Fix:** `getCrmUser()` on init, force `userId = user.id`, HMAC-sign state, re-check the session in the callback. Twitter's implementation is the template — but see M12 (its `'dev-fallback-key'`).

### H2. Stored XSS → privilege escalation: `market-report-preview` serves campaign HTML on the app origin — [V]
`src/app/api/campaigns/market-report-preview/route.ts:55-57` returns `campaign.email_body` as `text/html` with no CSP/sandbox. Site CSP allows `script-src 'unsafe-inline'`; the Supabase session cookie is client-readable (not HttpOnly) and accepted by every `/api/crm` route (`src/lib/crm-auth.ts:31`).
- **Exploit:** Any agent creates/edits a draft campaign whose body contains `<script>…</script>` plus the `{{market_report}}` token (needed so the route will render it), then sends a broker/owner the link `/api/campaigns/market-report-preview?campaign=<id>` ("check this preview"). One click runs the script as that user → it can call `/api/crm/*` as them (reset-password, invite, profile role changes, exports) → agent becomes owner. (CRM's own iframe embeds are `sandbox="allow-same-origin"` without scripts, so they're safe — the direct URL is the hole.)
- **Fix:** respond with `Content-Security-Policy: sandbox; default-src 'none'` (or JSON + render in a sandboxed iframe), and sanitize `email_body` with the existing `sanitizeHtml` on save.

### H3. Sign-up is open, and a set of routes only check "is logged in", not "has a CRM profile" — [V]
Supabase `GET /auth/v1/settings`: `disable_signup: false`, email provider on, `mailer_autoconfirm: false` (so a stranger just needs an inbox they control). `getCrmUser()` (`crm-auth.ts:15-36`) returns any auth user; `getCrmContext()` correctly fails closed. Routes still on `getCrmUser` only:
- `attom/route.ts:10` — **paid ATTOM property-data proxy** usable by strangers.
- `crm/social/caption/route.ts:2` — Anthropic (Opus) calls billed to you.
- `crm/social/upload/route.ts:54` — mints signed upload URLs into the **public `images` bucket** (12 MB images/video; content-type is not bound to the signed URL → can host arbitrary files on your Supabase domain).
- `lead-routing/route.ts:2` — GET returns routing rules + agent names for any `?unit=`.
- `action-plans/test/route.ts:8`, `action-plans/stage-trigger/route.ts` — see H7.
- `crm/forms/[id]/fields` GET [R], gmail/calendar/social routes (these are scoped to the caller's own id, so harmless).
- **Fix:** swap `getCrmUser` → `getCrmContext` everywhere a CRM resource is touched (mechanical). Separately decide whether public sign-up needs to exist at all: if CRM users are only ever invited, set `disable_signup=true` (the 2026-10-07 lockdown SQL exists precisely because "Supabase Auth signups are open"). That one setting removes this whole class.

### H4. Any agent can read another agent's Gmail via `gmail/sync` — [V]
`src/app/api/gmail/sync/route.ts:125` takes `clientEmail` from the request body; `:141` authorizes only "same workspace as the deal"; the route then searches the **deal owner's mailbox** with that attacker-supplied string and writes up to 100 matching messages (4,000 chars of body each) into `crm_deal_emails`, which the caller can read. The code comment says the query is "scoped to from:/to: the client" but the client is whatever the caller typed.
- **Exploit:** `POST {dealId:<any deal in my unit>, clientEmail:"gmail.com"}` (or any third party / a keyword-style address) → bulk mailbox extraction of a colleague's mail.
- **Fix:** derive `clientEmail` from the deal/contact row, ignore the request value; require the caller to own the mailbox or be admin.

### H5. Arbitrary read of any object in the `listing-files` bucket — [V loi-exhibits side; R form-submissions side]
`crm/form-submissions/route.ts:190,196,265` store client-supplied `builder_data` verbatim; `crm/loi-exhibits/route.ts:26` then signs `ex.path` from that stored data with no prefix/listing check (`createSignedUrl(ex.path, 600)`); `lib/loi-generate.ts:140` also downloads it when regenerating an LOI.
- **Exploit:** save a submission with `builder_data.exhibits=[{id:'x',path:'<listingId>/<file>'}]`, call `GET /api/crm/loi-exhibits?submission_id=…&id=x` → signed URL to another workspace's or a Restricted listing's file / rent roll. Needs the path (`{listingId}/{ts}_{name}`), which leaks via other responses.
- **Fix:** never accept `exhibits` from the client; validate each path with `isPathInsideListing` against a listing the caller can access, in both routes.

### H6. Commission hijack and self-edit — [V]
- `crm/commissions/route.ts:62-92` (POST): `assertOwnsResource('crm_deals', …)` has no `requireOwner`, then `upsert … onConflict:'deal_id'` **overwrites** an existing commission: agent B posts `{deal_id:<A's deal>, agent_split:100, status:'paid'}` and becomes payee. `[id]` PATCH/DELETE require ownership; this path bypasses it.
- `crm/commissions/[id]/route.ts:5-9` (PATCH): the owner may set `agent_split`, `commission_rate`, `status`, `paid_date`, `agent_id`, `sale_price` — i.e. edit their own pay.
- `crm/commissions/[id]/route.ts:19` (GET): readable by any agent in the unit (the list route pins agents to their own rows — inconsistent; the comment says this is intentional, confirm).
- **Fix:** require admin to create/overwrite; if a row exists, require owner/admin; make money fields and `agent_id` admin-only; make GET owner-only for non-admins.

### H7. Brand-domain email abuse — [V action-plans/test; R rest]
- `action-plans/test/route.ts:8-12,32-41`: `getCrmUser()` only (H3); `plan_id` unscoped, `agent_id` from the body → any logged-in user sends a plan's HTML to *any CRM user* from `CRECO <zack@crecotx.com>` / `noreply@fairoaksrealtygroup.com` over Resend (valid DKIM); a CRM agent can author the plan body ⇒ phishing of brokers from your own domain. `plan.name` is injected unescaped.
- `action-plans/stage-trigger/route.ts:53`: `.ilike('trigger_value', stage)` with attacker-supplied `stage:"%"` fires every active stage-change plan for any `clientId`; no ownership check.
- `action-plans/[id]/enrollments`, `campaigns/[id]/enrollments` POST: `client_ids` not workspace-checked (cross-workspace enrolment → cron emails other workspaces' contacts); `[id]/steps` lets any agent rewrite a **live** plan; `from_name`/`from_email` settable by any agent ⇒ send "as" `zack@crecotx.com`.
- **Anonymous variant:** `listing_alerts` has an RLS policy `listing_alerts_anon_insert WITH CHECK (true)` — anyone with the (public) anon key can insert unlimited rows **directly through Supabase REST, bypassing the app's rate limit and bot guard**; `cron/listing-alerts` emails every row (no double opt-in, no tokenized unsubscribe). → unlimited unsolicited mail to arbitrary addresses from your domain; deliverability/blacklist risk.
- **Fix:** `getCrmContext` + `assertOwnsResource` on every one; escape merge values; admin-only sender fields; double opt-in + unique(email) on alerts and drop the anon-insert policy (insert via the API only).

### H8. Next.js 15.5.25 is behind several security releases; image optimizer is an open proxy — [V]
`package.json` pins `next ^15.5.25`; lockfile resolves 15.5.25. `npm audit` flags `next` ≤15.5.27: *Image Optimization API RCE via `sharp`* (critical), *Server Actions DoS* (high), *SSG/ISR cache poisoning* (moderate ×2). **Mitigated:** the installed `sharp` is 0.35.5 — exactly the advisory's stated workaround (≥0.35.5); and the app has one `'use server'` file (`lib/audit.ts`). Still: upgrade to **≥15.5.28**.
- `next.config.js:109-112` has a catch-all `remotePatterns: { protocol:'https', hostname:'**' }` — `/_next/image?url=https://anything` makes your server fetch and process **any** https image for anonymous visitors: bandwidth/compute cost abuse, a parser attack surface (exactly what the sharp advisory targets), and your domain proxying arbitrary content. Restrict to the hosts you actually use (Supabase, SABOR/ConnectMLS, Unsplash, Vercel storage).

---

## 3. MEDIUM

| # | Finding | Where | Fix |
|---|---|---|---|
| M1 | **Restricted-deal bypass on child records** (`assertOwnsResource` applies the hidden-deal rule only when `table==='crm_deals'`, `crm-auth.ts:195`). Any same-workspace agent with a submission/envelope UUID on a private deal can `copy_from`, edit, delete, `get_link` (live signing URL ⇒ could sign as the client), void, nudge; `esign-import` GET lists hidden-deal imports with signed PDF URLs. [R] | `form-submissions/route.ts:172,205,299`; `form-submissions/[id]:55`; `envelopes/route.ts:27-29,252-265,413,456`; `esign-import/route.ts:183-205` | Resolve each row's `deal_id`/`listing_id` and run the hidden-deal/restricted check; put it in a shared helper. |
| M2 | **Listing takeover/delete** — PATCH allow-list includes `listing_agent_id`, `assigned_agent_ids`, `is_restricted`, `co_agent_id`; any workspace agent can claim + restrict (locking the owner out) or DELETE another's listing. [R] | `crm/listings/[id]/route.ts:6,16,33` | Admin/owner-only for ownership+restriction fields and DELETE. |
| M3 | **Calls on private deals** reachable by id: bot transcript (`calls?turns=`), audio (`calls/audio`), `calls/contact`, `PATCH calls`; POST `deal_id` unvalidated. Needs a call UUID. [R] | `crm/calls/route.ts:41-45,192,249,274`; `calls/audio:29`; `calls/contact:29` | `assertOwnsResource('crm_deals')` on the call's deal. |
| M4 | **Block-list (the call block-list I built this month) — manual add has no contact guard**: an agent can block a client's cell on *all lines*; DELETE lets any agent remove `all` rows; raw DB error echoed. `belongsToContact` is used only on the `call_id` path and auto-block. [V] | `crm/call-blocklist/route.ts:35,47-50,68`; `lib/call-blocklist.ts:90` | Run the contact check on every add; admin-only for `all`; use `dbError`. |
| M5 | **Admin can edit a super_admin's profile** (email/business_unit unvalidated), which weakens `reset-password`'s role lookup (`crm_profiles.email`, exact match, normalisation mismatch) and injects unescaped `firstName` into the reset email. Reset link still goes to the target's own inbox. [R] | `crm/profiles/[id]/route.ts:11-46`; `crm/reset-password/route.ts:51-61,73,96,107` | Refuse non-owner edits of admin/super_admin; `ilike`/id lookup; `esc(firstName)`. |
| M6 | **Task IDOR**: PATCH accepts `client_id`/`deal_id` with no workspace check (POST validates them); `GET /tasks` then joins the contact's name/email → read a contact from another workspace. [R] | `crm/tasks/[id]/route.ts:14-18` | Validate with `assertOwnsResource`. |
| M7 | **`gmail/send`**: no authorization on `dealId`/`clientId` (any user with a Gmail connection can attach sent-mail rows to any deal/client); `dealId`/`clientId` interpolated unvalidated into a service-role REST URL (`:183`); CRLF/header injection via raw `inReplyTo` (`:234`) and attachment `mimeType` (`:120`) ⇒ Bcc/extra headers; `agentName` display-name spoof. [R] | `gmail/send/route.ts:120-125,144-160,183,217,234` | `assertOwnsResource`, UUID-validate, `stripLineBreaks`, validate base64. |
| M8 | **`email-leads/sync` trusts the From substring** (`includes(domain)` on the whole header incl. display name) — spoofed "Zillow" mail becomes a contact + Prospect deal; with `LEAD_AUTOENROLL_UNITS` on, step 1 emails an attacker-chosen address. Auth compare is `===` (not timing-safe). [R] | `email-leads/sync/route.ts:217-220,305-345,557` | Match on the parsed address + require `dmarc=pass`. |
| M9 | **Bot guard doesn't bound abuse**: `elapsed_ms` is client-supplied (`"elapsed_ms":5000` passes); limits are per-IP only; `leads` and `listing-alerts` share one bucket; `track/event` and `track/pageview` have **no rate limit** (writes up to 20 rows/req; User-Agent regex only); `agent-apply`, `quiz/lead` have no length/type caps (≈4.5 MB per field into CRM + broker email). Client-IP trust chain (Cloudflare→Vercel) unverified. [R] | `lib/bot-guard.ts:90`; `lib/ratelimit.ts`; `track/*`; `agent-apply`; `quiz/lead` | Server-signed form token, per-email/phone limits, rate-limit tracking, caps. |
| M10 | **MLS search filter bug** — city filter is joined without parentheses (`a or b and c…`), so a `city` matching `SubdivisionName` escapes the status/price/**agent/office restriction**; public endpoint, no rate limit (each call hits SABOR). [V] | `mls/search/route.ts:83,95` | Wrap in `( … )`; rate-limit. |
| M11 | **Anonymous storage/DB write paths via the public anon key**: policy `plaza_resumes_anon_insert` lets anyone upload to bucket `plaza-resumes` (5 MB, doc/PDF types); anon-callable `SECURITY DEFINER` RPCs `plaza_*_submit`, `plaza_job_apply`, `plaza_claim_*`, `site_bot_hit` (input is length-capped/validated — fine — but unthrottled); `crm_client_held(uuid)` is anon-callable (lead_hold oracle). [V] | DB policies/functions | Move to API routes with rate limits, or add per-IP throttling in the functions; revoke anon EXECUTE on `crm_client_held`/`crm_deal_visible`. |
| M12 | **CSRF/cookie/CSP posture**: `/api/crm` and `/api/mls/sync` are *exempted* from the CSRF check (`middleware.ts` `apiSessionNoCsrfRoutes`) while `getCrmUser` accepts the cookie session — protected only by SameSite=Lax; missing Origin+Referer is allowed through (`csrf.ts:94`); Supabase cookies use library defaults (not HttpOnly); CSP has `script-src 'unsafe-inline'`; `img-src https:`. Twitter OAuth HMAC key falls back to the literal `'dev-fallback-key'` if `TOKEN_ENCRYPTION_KEY` is unset. [V] | `middleware.ts`; `lib/csrf.ts`; `next.config.js`; `auth/social/twitter` | Run CSRF on `/api/crm` for cookie-only requests; nonce-based CSP; fail closed on missing key. |
| M13 | **Storage path traversal (suspected)**: `esign-import` PUT only checks `startsWith('imports/'+uid+'/')` (no `..` check), failure paths `storage.remove([storage_path])`; `form-submissions` POST builds `submissions/${form_id}/…` from an unvalidated client `form_id` with `upsert:true`. Depends on Supabase normalising `..`. [R] | `esign-import/route.ts:115,132-144`; `form-submissions/route.ts:223` | Reject `..`, require UUIDs. |
| M14 | **Token storage hygiene**: AES-256-GCM is sound (random 16-byte IV, tag verified) but `decryptToken` swallows failures and returns the input (plaintext fallback, `token-crypto.ts:40,49`); key = first 32 *characters* of `TOKEN_ENCRYPTION_KEY` (a 64-char hex key yields 128 bits); `crm/social/accounts` GET does `select('*')` and **returns the (encrypted) tokens to the browser** (`:11-20`); Gmail scopes include full `gmail.readonly` + `calendar.events`. [R] | `lib/token-crypto.ts`; `crm/social/accounts/route.ts` | Explicit column lists; derive the key with a KDF; drop the plaintext fallback after migration; minimise scopes. |
| M15 | **Misc authorization gaps** [R]: `campaigns/POST` `listing_id` and `sender_agent_id` unchecked on create; `review-request` has no throttle/dedupe; `calls?bulk=skip_old` and `calls/sync` (Talkroute pull) open to any agent; `deals` POST accepts arbitrary `agent_id`/`client_id`; `doc-email` / `calls/contact` use `ilike` on email with unescaped `%`/`_` (cross-unit linking); texts/tasks unscoped within a unit (likely by design). | various | Per-route fixes |

---

## 4. LOW / informational
- **Anon table grants:** `anon` holds INSERT/UPDATE/DELETE/**TRUNCATE** on 16 tables (`site_*`, `plaza_*`, `crm_dead_emails`, `crm_copilot_chats`, …). RLS blocks DML (no anon policies) but TRUNCATE ignores RLS; PostgREST doesn't expose it, so not reachable today. `REVOKE ALL … FROM anon` on tables that need no anon access. [V]
- 36 tables have RLS on with **zero policies** (deny-all; service-role only) — by design, noted for awareness. [V]
- Campaign `preflight` fetches URLs from campaign bodies with redirects and no private-IP/metadata guard (authenticated, blind SSRF with status oracle) — reuse `safeFetchImage`/`resolvePublicIp` from `lib/broker-ingest/gmail.ts`. [R]
- `Talkroute` webhook secret travels in the URL query (`?key=`) — timing-safe compare is correct, but it will appear in access logs; no replay window; `new Date(p.datetime)` can throw on bad input. [R]
- `gmail/send` token refresh PATCHes `user_id=eq.X` with no account filter and uses `rows[0]` → multi-account mix-up. [R]
- `sync-logins` upserts a bare `crm_profiles` row for *every* auth user (any row = CRM user for `getCrmContext`) — confirm column defaults so stray sign-ups don't become CRM users. [R]
- `stripe/webhook`: if `ALLOW_TENANT_PROVISIONING` is ever turned on, a checkout with an existing user's email upserts their profile to admin/residential. Off by default. [R]
- `plaza-listings` approve and `property-db` store URLs (`website`, `brochure_url`…) without an http(s) check — possible `javascript:` href. [R]
- Unsubscribe is a state-changing GET (scanners can unsubscribe people) and no `List-Unsubscribe` header exists anywhere. [R]
- Cron secrets compared with `!==`/`===` (not timing-safe); `crm/social/clear-ratelimit` likewise. [R]
- Logs: `console.error('Token exchange failed:', tokens)` (`gmail/callback:116`) logs Google's error body; Facebook/YouTube/LinkedIn routes log `userId`/nonce. [R]
- `track/open` read-modify-write loses counts under concurrency. [R]
- Dependency CVEs (50 total, 3 "critical"): `next` (H8); `dompurify` 3.4.15 — the advisories concern `IN_PLACE` and `SAFE_FOR_TEMPLATES`, neither used by `sanitizeHtml` (string mode) → not exploitable here, but bump with `isomorphic-dompurify`; `tar` and ~30 `@vercel/*` packages come in only via the **devDependency** `vercel` CLI (build-time, not in the deployed bundle); `exceljs`/`uuid`, `postcss`, `zod`, `js-yaml` are DoS-class. Run `npm audit fix` after the Next bump.
- `x-crm-internal: <CRON_SECRET>` header bypasses the CRM automation-UA block (intended for the Copilot's server-to-server calls). Fine, but it means CRON_SECRET is a second-purpose secret.

---

## 5. Checked and solid
- **RLS:** enabled on **90/90** public tables; every `SECURITY DEFINER` function pins `search_path`; the three views use `security_invoker`; private buckets (`deal-docs`, `listing-files`, `transaction-forms`, `receipts`, `plaza-resumes`) are private with mime/size limits; `images` write needs `site_admin_ok()`; `crm_profiles` SELECT is scoped; the October lockdown SQL is applied.
- **Secrets:** no `.env*` ever committed (only `.env.example`); no key/token patterns in the tree or in 1,480 commits across all refs; no service-role key in any client component (`supabase-admin` imported only from `api/` and `lib/`); no `NEXT_PUBLIC_` secrets. (The Vercel env value for `NEXT_PUBLIC_SUPABASE_URL` contains a literal `\n`; code trims it.)
- **Telephony:** all 7 `api/voice/*` routes verify the Twilio HMAC-SHA1 signature with a timing-safe compare against a fixed public origin and fail closed when unconfigured (`lib/twilio.ts:27-39`); `voice/screen` fails *open to the team* by design. The Talkroute webhook is keyed + timing-safe. Blocklist endpoints require a CRM profile and are workspace-scoped (see M4 for the exception). Recording audio proxy is unit-checked and `recording_url` is DB-sourced (no SSRF).
- **Cron:** all 25 routes use `if (!secret || header !== 'Bearer '+secret) 401` — fail closed when unset; none accept `?key=`.
- **Webhooks:** Stripe (`constructEvent` on raw body), Resend (Svix HMAC, 300 s replay window), lead/plaza webhooks (Bearer + timing-safe).
- **E-sign:** 192-bit signer tokens, atomic single-sign claim, order enforced, signer sees only their own fields, no cross-envelope access, storage paths from DB.
- **Public pixel `track/open`:** needs a 122-bit UUID, constant GIF response, rate-limited (60/min/IP), leaks nothing. **Unsubscribe:** 122-bit token, rate-limited, no reflected input.
- **XSS:** every `dangerouslySetInnerHTML` is either JSON-LD (`<>&` escaped) or `sanitizeHtml` (DOMPurify allow-list); CRM email/campaign previews are `sandbox="allow-same-origin"` (no scripts); `auth/social/done` is allow-listed + escaped; all outbound lead/notification emails escape interpolated fields.
- **Open redirects:** none (all redirect targets are fixed origins; no `next=`/`returnTo`).
- **SQL/filter injection:** no raw SQL; PostgREST `.or()` filters use UUID-validated or sanitised input in the reviewed routes (exceptions are low-impact, listed above); OData inputs escaped (`'`→`''`) in `listings`.
- **Authz done right:** `merge-contacts`, `invite`, `integration-health`, `plaza-*`, `site-*`, `cam-reconciliation`, `assistant` (HMAC write tickets, single-use), `contacts` (capped, audited), `calendar/*`, social posts/inbox (agent-scoped).
- **Rate limiting:** Upstash Redis (durable), fails closed in production on `leads`, `quiz`, `agent-apply`, `unsubscribe`, `track/open`, OAuth init.
- **Headers:** HSTS (2y, preload), `X-Content-Type-Options`, frame-ancestors/XFO, `object-src 'none'`, `base-uri`, `form-action 'self'`, `Referrer-Policy`, no CORS headers (same-origin only).

---

## 6. Recommended order of work
1. **This week:** C1, then H1 (same fix pattern), **set `disable_signup=true` in Supabase Auth** if CRM users are invite-only (closes H3 at the root), H2 (one-line CSP/sandbox header), H8 (bump Next, restrict `remotePatterns`).
2. **Next:** H4, H5, H6, H7 (incl. dropping the anon `listing_alerts` insert policy).
3. **Then:** M1–M3 (restricted-deal/child-record gaps: build one shared `assertCanAccess…` helper), M4, M5–M15, and a sweep replacing `getCrmUser` with `getCrmContext`.
4. **Hygiene:** anon grants/TRUNCATE, token-column select lists, KDF for the token key.

### How to check whether C1/H1 were already abused (read-only SQL)
```sql
-- Gmail connections: any user whose connected Gmail address is not their own CRM email domain/identity
select c.user_id, p.email as crm_email, c.gmail_email, c.created_at, c.updated_at
from gmail_connections c join crm_profiles p on p.id = c.user_id
where lower(c.gmail_email) <> lower(p.email) order by c.updated_at desc;
-- Social: more than one active connection per (agent, platform) is the symptom of H1
select agent_id, platform, count(*) from social_connections group by 1,2 having count(*) > 1;
```

## 7. Not assessed / limits
Runtime behaviour of Supabase storage on `..` keys; Cloudflare/Vercel client-IP trust chain; whether the Google OAuth consent screen is in Testing vs Production; `lib/crm-assistant-tools.ts` (1,753 lines, Copilot tool dispatch) and `lib/crm-read-guard.ts` were only grepped; `lib/social-publish.ts` media-URL SSRF; the front-end `/sign/[token]` page; no dynamic testing was performed (no requests against production endpoints other than the public Supabase auth-settings read and catalog queries).
