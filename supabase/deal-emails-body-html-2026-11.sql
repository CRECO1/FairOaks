-- The exact HTML of each logged email (what the recipient received / the sender sent), so every teammate who can see
-- the email sees it as it looked, not just the stored plain-text copy. Nullable: older rows keep rendering from `body`.
-- Rollback: alter table crm_deal_emails drop column body_html;
alter table crm_deal_emails add column if not exists body_html text;
