-- Security hardening, 2026-11-04 (round 2). Idempotent; one transaction.
--
-- 1. Trigger functions in public were EXECUTE-able by every role (PostgreSQL grants EXECUTE to PUBLIC by default). Nothing needs
--    that: triggers fire without an EXECUTE check. Removing it stops anyone probing / invoking them through /rest/v1/rpc.
-- 2. crm_client_held(uuid): answers "is this contact held?" for any id and was callable by anon. Signed-in roles keep it (RLS uses it).
begin;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;

revoke execute on function public.crm_client_held(uuid) from public, anon;
grant  execute on function public.crm_client_held(uuid) to authenticated, service_role;


commit;

-- Rollback: grant execute on function <name> to public;  (per function; none of these are called by the app)
