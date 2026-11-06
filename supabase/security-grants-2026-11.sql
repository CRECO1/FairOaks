-- Least-privilege table grants (2026-11-05). APPLIED to production 2026-11-05. Re-run after creating any table from the Supabase dashboard
-- (its default grants to `anon` can't be changed by us). REVOKE-ONLY: this never adds a right, it only takes unused ones away.
--
-- Supabase gives the browser roles (`anon` = not signed in, `authenticated` = signed in) broad rights on every new table, and row-level
-- security is then the only thing standing between them and the data. This removes the rights nothing can use, so a forgotten or loosened
-- policy can no longer expose a table. A role keeps SELECT/INSERT/UPDATE/DELETE on a table ONLY if some policy for that command (or ALL)
-- names the role (or PUBLIC) and is not a plain `false`. TRUNCATE/REFERENCES/TRIGGER/MAINTAIN are never usable through a policy, so they go.
-- Server-only tables (no usable policy) end up with no browser rights at all. The server (service_role) is untouched.
-- Rollback: Backups/grants-2026-11-05/grants-before.json lists every grant that existed.

do $$
declare r record; op_ text; role_ text; usable boolean;
begin
  for r in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') loop
    foreach role_ in array array['anon','authenticated'] loop
      execute format('revoke truncate, references, trigger on public.%I from %I', r.relname, role_);
      foreach op_ in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(role_, r.oid, op_) then
          select exists (
            select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = r.relname
              and p.cmd in (op_, 'ALL')
              and (p.roles && array[role_, 'public']::name[])
              and not (coalesce(p.qual, p.with_check, 'true') in ('false', '(false)'))
          ) into usable;
          if not usable then execute format('revoke %s on public.%I from %I', op_, r.relname, role_); end if;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- New tables: not-signed-in visitors get nothing by default (tables made through the SQL editor used to give `anon` full access).
alter default privileges in schema public revoke all on tables from anon;
