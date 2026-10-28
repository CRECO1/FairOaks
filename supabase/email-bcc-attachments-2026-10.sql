-- Sent/received emails keep who was Bcc'd and their attachments (2026-10-28).
--   bcc_emails  — the Bcc line of an email we sent (Gmail keeps it on the sender's copy).
--   attachments — [{name,size,mime,path}] stored in the private 'email-attachments' bucket so anyone with access to the
--                 deal/contact can open them, not only the mailbox owner. NULL = not checked yet, [] = no attachments.
alter table public.crm_deal_emails add column if not exists bcc_emails text;
alter table public.crm_deal_emails add column if not exists attachments jsonb;

insert into storage.buckets (id, name, public) values ('email-attachments', 'email-attachments', false)
on conflict (id) do nothing;
