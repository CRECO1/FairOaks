-- Property Workspaces — Contacts tab
-- Links CRM contacts (crm_clients) to a property folder with a role
-- (Landlord / Tenant / Buyer / Seller / Co-broker / Attorney / …).
-- Like crm_listing_files, it has no business_unit: access derives from the parent
-- listing (assertCanAccessListing honors the Restricted flag).

CREATE TABLE IF NOT EXISTS crm_listing_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES crm_listings(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES crm_clients(id)  ON DELETE CASCADE,
  role        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, client_id, role)
);

CREATE INDEX IF NOT EXISTS idx_listing_contacts_listing ON crm_listing_contacts(listing_id);
