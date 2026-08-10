-- Property Workspaces (Stage 1)
-- Turns each listing into a shareable folder of documents (uploads + fillable
-- transaction forms) and links deals ↔ listings for the "Deal Properties" view.
--
-- Additive + idempotent. Applied live via the pooler (no DDL lives in the repo
-- for these tables; see supabase/rbac-property-db.sql for the same pattern).

-- 1) A fillable transaction doc can now attach to a PROPERTY, not just a deal.
ALTER TABLE crm_form_submissions
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES crm_listings(id) ON DELETE SET NULL;

-- 2) Teammate sharing on listings (mirrors crm_deals.assigned_agent_ids) + a
--    per-folder "Restricted" flag (public by default; restrict to owner+assigned+admin).
ALTER TABLE crm_listings
  ADD COLUMN IF NOT EXISTS assigned_agent_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE crm_listings
  ADD COLUMN IF NOT EXISTS is_restricted boolean NOT NULL DEFAULT false;

-- 3) Structured deal ↔ listing link so "listings where we did a lease/purchase
--    deal" is reliable instead of matching the free-text deal.property.
ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES crm_listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_submissions_listing ON crm_form_submissions(listing_id);
CREATE INDEX IF NOT EXISTS idx_deals_listing ON crm_deals(listing_id);
