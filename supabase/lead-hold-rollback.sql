-- Undo supabase/lead-hold.sql: release every held lead, drop the hide rules and triggers (the columns stay, harmlessly).
update public.crm_clients set lead_hold = false where lead_hold;
drop policy if exists lead_hold_hide on public.crm_clients;
drop policy if exists lead_hold_hide on public.crm_tasks;
drop policy if exists lead_hold_hide on public.crm_activity;
drop policy if exists lead_hold_hide on public.crm_client_activities;
drop policy if exists lead_hold_hide on public.crm_call_log;
drop trigger if exists aa_crm_clients_lead_hold_insert on public.crm_clients;
drop trigger if exists aa_crm_clients_lead_hold_update on public.crm_clients;
