# VultStack Multi-Tenancy — Migration Plan

Turning the CRM from a **single-tenant** app (one account = Fair Oaks + CRECO)
into a **multi-tenant SaaS** where each brokerage signs up and gets a private,
isolated CRM.

## TL;DR of the current state (verified against the live DB)

- **34 tables**, all RLS-enabled. Today they're partitioned by `business_unit`
  (`residential` / `commercial`) and `agent_id` — there is **no `org_id`
  anywhere**. That confirms single-tenant.
- `business_unit` is the **CRECO ↔ Fair Oaks** switch — two workspaces inside
  **one** account. It is NOT a tenant boundary. After this work, the hierarchy is:
  **organization → business_unit (workspace) → agent**.
- The only RLS helper is `crm_is_admin()` (checks `role='admin'`). **It is not
  org-aware** — in a naive multi-tenant setup, any brokerage admin would see
  *every* brokerage's data.
- **All 24 CRM API routes use the Supabase service-role key (`adminClient()`),
  which BYPASSES RLS.** They filter only by `business_unit`. → The **application
  layer is the primary isolation boundary**; RLS is defense-in-depth.

## The two enforcement layers (both required)

| Layer | Used by | Enforced by |
|------|---------|-------------|
| **App layer** | All `/api/crm/*` routes (service role → bypasses RLS) | `org_id` added to every query/insert (Phase 3) |
| **RLS** | Any direct anon/authenticated JWT query | Restrictive `org_isolation` policy (Phase 2, `0001_*.sql`) |

Missing either layer leaves a hole. The app layer is the bigger lift.

---

## Phasing

### Phase 1 — Foundation schema (additive, safe) ✅ drafted
`0001_multitenancy_foundation.sql` in this folder:
- `organizations` table + `crm_profiles.org_id` (membership, one org per user).
- `org_id` on all **26 private** CRM/social tables, backfilled to the single
  existing org (`slug='fair-oaks'`), then `NOT NULL` + FK + index.
- `auth_org_id()` resolver (SECURITY DEFINER, no RLS recursion).
- A **RESTRICTIVE** `org_isolation` policy per table — AND-ed with the existing
  ~60 permissive policies, so we add isolation **without rewriting** them.

This is additive and reversible (rollback block included). It is harmless on the
current DB because everything backfills to the one org.

> **Validation gap:** Supabase branch creation needs a cost-confirmation tool not
> available in this environment, so this wasn't applied to a live branch. Before
> prod, run it on a branch (Supabase dashboard → Branches) or a local
> `supabase db reset`, then run the isolation test in "Verification" below.

### Phase 2 — Apply schema to a branch & verify
1. Create a dev branch (or local stack). Apply `0001_*.sql`.
2. Seed **two** orgs + a user in each. Confirm each user sees only their org's
   rows via the authenticated (anon-key) client (see Verification).
3. Run `get_advisors(security)` — expect no new "RLS disabled" / "policy missing"
   findings.

### Phase 3 — App-layer org scoping (the real work)
Every route currently does: `getCrmUser()` → `adminClient()` → query by
`business_unit`. Change to resolve and apply the caller's org.

1. **Add `getCrmContext()`** in `src/lib/crm-auth.ts`:
   returns `{ user, orgId, role, businessUnits }` by reading
   `crm_profiles` for `auth.uid()`. Return 401/403 if no profile/org.
2. **Every read** in `src/app/api/crm/**`: add `.eq('org_id', ctx.orgId)`.
3. **Every insert**: set `org_id: ctx.orgId` (and derive child-row `org_id`
   from the parent/context).
4. **Reject cross-org refs**: when a body references a `client_id`/`deal_id`,
   verify the referenced row's `org_id === ctx.orgId` before writing.
5. The **invite** route (`/api/crm/invite`) must stamp the new `crm_profiles`
   row with the inviter's `org_id` (today it hardcodes brokerage identity).

Scope: ~24 route files. This is mechanical but must be exhaustive — a single
unscoped `adminClient()` query is a cross-tenant leak. Recommend a tiny query
wrapper (`orgScoped(supabase, table, orgId)`) + a lint/grep check that no
`adminClient().from('crm_...')` call ships without an `org_id` filter.

### Phase 4 — Self-serve signup & provisioning
- **`/signup`** (on the CRM app / `app.vultstack.com`): create brokerage →
  create `organizations` row → create first user as `role='admin'` with that
  `org_id` → land in onboarding.
- Reuse the existing **invite flow** for additional agents (already per-agent;
  just scope to the new org).
- **Stripe** per-seat billing keyed to `organizations.id`; add billing columns to
  `organizations`; gate `status` (`trial`/`active`/`suspended`) in middleware.

### Phase 5 — Public website per org (separate decision)
The website tables (`agents`, `listings`, `neighborhoods`, `testimonials`,
`leads`, `listing_alerts`, `site_settings`) are deliberately **excluded** from
Phase 1. Decide first: do brokerages get a **public VultStack-hosted website**
too, or **just the CRM**? If yes → add `org_id` there + subdomain/custom-domain
routing. If no → those tables stay tied to the Fair Oaks site only.

### Phase 6 — Production cutover
1. Backup / PITR checkpoint.
2. Apply `0001_*.sql` (off-hours; small tables = fast).
3. Deploy the Phase 3 app build (org-scoped) **in the same window** — schema and
   app must ship together so no unscoped query runs against multi-org data.
4. Smoke test as a real user. Keep the single-org state until a 2nd org is
   intentionally created.

---

## Verification (cross-org isolation test)

After applying on a branch, with two orgs A and B each having one user:

```sql
-- As user in org A (authenticated/anon-key client, NOT service role):
select count(*) from crm_clients;          -- only A's rows
select * from crm_profiles;                 -- only A's members
-- Attempt to read a known B row id -> 0 rows.
-- Attempt to insert a row with org_id = B -> blocked by with_check.
```

Service-role queries will still see everything (expected) — that's why Phase 3
app scoping is mandatory.

## Risk register

| Risk | Mitigation |
|------|-----------|
| Unscoped service-role query leaks across tenants | Phase 3 exhaustive review + grep/lint gate; RLS as backstop only for JWT paths |
| `SET NOT NULL` lock on a large table | Tables are small now; future: nullable → batched backfill → `NOT VALID`/`VALIDATE` |
| Admin sees other orgs | Restrictive `org_isolation` bounds `crm_is_admin()` to own org |
| New-user insert blocked by restrictive policy | Invites/signup run via service role (RLS bypassed) and set `org_id` explicitly |
| Schema and app drift during cutover | Ship `0001_*.sql` + Phase 3 build in one window (Phase 6) |
```
