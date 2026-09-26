-- Widen lead_is_test() to catch the deploy probe by ADDRESS, not just by name.
--
-- A synthetic "Attr Probe" lead lands in the live CRM roughly daily
-- (attr.probe.deploy@gmail.com — contact + deal + importer row). The name
-- pattern already matched "Attr Probe"/"Attribution Probe", so those rows were
-- never reaching the dashboard — but the match hung entirely on the display
-- name. If whatever generates it is ever renamed, every future probe would
-- start counting as a real lead.
--
-- Two changes:
--  * the probe's address is matched explicitly, and any *.probe.deploy@ style
--    address, so containment survives a rename;
--  * the probe phrases are no longer anchored to the start of the name, so
--    "CRECO Attr Probe" or "Deploy Attribution Probe" are caught too.
--
-- "^zz" stays anchored deliberately — matching "zz" anywhere would flag real
-- surnames (Rizzo, Mazzone, Pizzuti), and a false positive here silently hides
-- a real lead, which is far worse than showing a test row.
--
-- Containment only. It stops the rows polluting reporting; it does not stop
-- them being written.

create or replace function public.lead_is_test(p_name text, p_email text)
returns boolean language sql immutable as $$
  select coalesce(p_name,'')  ~* '(^zz|attr probe|attribution probe)'
      or coalesce(p_email,'') ~* ('(@example\.(com|org|net)$|\.invalid$|\.test$|^test@|^zz@|crecotest|zztrace|zz-trace'
                                  || '|^attr\.probe\.deploy@|probe\.deploy@|^attr\.probe@)');
$$;

revoke all on function public.lead_is_test(text, text) from public, anon, authenticated;
grant execute on function public.lead_is_test(text, text) to service_role;
