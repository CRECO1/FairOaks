-- Matchmaker: structured buyer/tenant requirement fields on contacts.
-- asset_types (already present, text[]) captures desired property types; these add
-- numeric size/price ranges and submarket preferences for matching against inventory.
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS req_size_min   integer;
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS req_size_max   integer;
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS req_price_min  bigint;
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS req_price_max  bigint;
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS req_submarkets text[] NOT NULL DEFAULT '{}';
