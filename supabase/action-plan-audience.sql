-- Optional client-type targeting for action plans. When set, a stage_change plan only
-- enrolls clients whose crm_clients.type matches (e.g. a "Buyer Closed & Won" plan with
-- audience='Buyer' fires only for buyers). Null = fires for any type (unchanged behavior).
-- Lets Buyer / Seller / Tenant "Closed & Won" plans all sit on the "Closed" stage without
-- cross-firing — see resolve in src/app/api/action-plans/stage-trigger/route.ts.
alter table crm_action_plans
  add column if not exists audience text;
