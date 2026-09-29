-- Lead definition: recruiting is not pipeline, and bots are not leads.
--
-- 1. crm_lead_is_inbound() listed 'agent application' as an inbound source, so
--    every recruiting applicant was charted as a client lead — the weekly digest's
--    "top source" was Agent application. Applications are their own category
--    (tagged Recruiting by lib/recruiting-crm.ts); they are now excluded up front,
--    ahead of the attribution short-circuit, so an applicant carrying UTMs is not
--    counted either.
--
-- 2. lead_name_is_gibberish() mirrors gibberishNameReason() in src/lib/bot-guard.ts
--    (change both together). It is folded into lead_is_test(), which every lead
--    surface already uses purely as an exclusion filter — weekly_lead_digest,
--    lead_attribution_report (all three sources) and the follow-up task helper —
--    so a scripted submission that reaches the database by any path drops out of
--    all of them without rewriting those functions.

create or replace function public.lead_name_is_gibberish(p_name text)
returns boolean
language sql
immutable
as $$
  with w as (
    select regexp_replace(tok, '[^A-Za-z]', '', 'g') as w
    from regexp_split_to_table(
      translate(coalesce(p_name, ''),
        'áàâäãåéèêëíìîïóòôöõúùûüñçýÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇÝ',
        'aaaaaaeeeeiiiiooooouuuuncyAAAAAAEEEEIIIIOOOOOUUUUNCY'),
      '[[:space:]''’.,-]+') as tok
  ), words as (select w from w where w <> '')
  select coalesce((
    select bool_or(
         -- capitals scattered through a word: "VDaQZLEHkjmteyqoa"
         (length(w) >= 6 and w <> upper(w) and length(regexp_replace(substr(w, 2), '[^A-Z]', '', 'g')) >= 3)
         -- a five-plus letter word with no vowel: "Pdbzdt"
      or (length(w) >= 5 and lower(w) !~ '[aeiouy]')
         -- six consonants in a row (Hirschfeld peaks at five)
      or (lower(w) ~ '[^aeiouy]{6,}')
    ) from words), false)
  or (
    -- every word opens on a pair no name starts with: "Rzlyuoh Rqmcowk"
    (select count(*) from words) >= 2
    and coalesce((select bool_and(
          length(w) >= 4
          and substr(lower(w), 1, 2) ~ '^[^aeiouy]{2}$'
          and substr(lower(w), 1, 2) <> all (string_to_array(
            'bl br ch cl cr dr fl fr gl gr kl kn kr ph pl pr sc sh sk sl sm sn sp st sw th tr tw wh wr '
            'ts tz zh sz cz dz zb zd zv zw dw gw kw sv vl vr hr bh dh gh jh kh rh sr mc mb nd ng nk '
            'dm ps pt pf fj bj tk gn kv hv wl ll sq pn mn ck cw', ' '))
        ) from words), false)
  );
$$;

create or replace function public.lead_is_test(p_name text, p_email text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_name,'')  ~* '(^zz|attr probe|attribution probe)'
      or coalesce(p_email,'') ~* ('(@example\.(com|org|net)$|\.invalid$|\.test$|^test@|^zz@|crecotest|zztrace|zz-trace'
                                  || '|^attr\.probe\.deploy@|probe\.deploy@|^attr\.probe@)')
      -- scripted submissions are not leads either (see lead_name_is_gibberish)
      or public.lead_name_is_gibberish(p_name);
$$;

create or replace function public.crm_lead_is_inbound(p_lead_source text, p_lead_site text, p_channel text, p_utm_campaign text, p_referrer text, p_landing_page text)
returns boolean
language sql
immutable
as $$
  select
    -- Recruiting applications are a separate funnel, never client pipeline.
    coalesce(p_lead_source, '') !~* '(agent application|recruit)'
    and (
      -- Anything carrying real attribution came through a tracked form.
      coalesce(p_lead_site, p_channel, p_utm_campaign, p_referrer, p_landing_page) is not null
      or (
        -- Named lists and feeds are never inbound, however they are worded.
        p_lead_source !~* '(prospect|list|import|appraisal|property db|dentwizard|marketed listing|broker)'
        and p_lead_source ~* '(website|web lead|home valuation|contact form|listing inquiry|tour request|tenant rep|sell / list|valuation tool|market report|elkhornpoint\.com|crecotx\.com|fairoaksrealtygroup\.com)'
      )
    );
$$;
