-- TeamChat: files + links on a message. attachments = [{path,name,size,type}] (private bucket chat-files);
-- links = [{kind:'deal'|'contact'|'doc', id, label}] (label resolved server-side from what the sender may see).
alter table public.crm_chat_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.crm_chat_messages add column if not exists links jsonb not null default '[]'::jsonb;
alter table public.crm_chat_messages drop constraint if exists crm_chat_messages_body_check;
alter table public.crm_chat_messages drop constraint if exists crm_chat_body_ok;
alter table public.crm_chat_messages add constraint crm_chat_body_ok check (
  char_length(body) <= 4000 and (char_length(body) > 0 or jsonb_array_length(attachments) + jsonb_array_length(links) > 0)
);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 26214400, array[
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
