-- Form auto-fill, LOI slice — schema.
--
-- Two columns and one curation pass. Nothing here changes existing behaviour:
-- both columns default to the value that means "as it was before".

-- ── 1. Which side of the deal we are on ──────────────────────────────────────
--
-- Today the side is only ever implied: crm_deals.type says "Tenant Lease" /
-- "Buyer Purchase" / "Seller Listing", and crm_clients.type says what a contact
-- usually is. Measured against the live book those two agree on 17 of 23 deals;
-- the other 6 are an investor buying (contact type describes their habit, not
-- their role here), a genuine conflict, and three deals whose linked contact is
-- a broker rather than a principal.
--
-- 74% is a good inference and a bad source of truth for a legal document. So the
-- DECISION is stored, not just the inference: once an agent confirms a side it
-- stops being re-derived, and every later form on that deal fills consistently.
--
-- It lives on the DEAL, not the contact: the same company can be our tenant on
-- one deal and our landlord on the next, so a side on the contact card would be
-- wrong as often as it was right.
alter table public.crm_deals
  add column if not exists representation_side text not null default 'unknown';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_deals_representation_side_check') then
    alter table public.crm_deals add constraint crm_deals_representation_side_check
      check (representation_side in ('buyer','tenant','seller','landlord','intermediary','unknown'));
  end if;
end $$;

comment on column public.crm_deals.representation_side is
  'Which party CRECO represents on this deal. ''unknown'' means not yet established — '
  'auto-fill refuses to map party fields until an agent confirms it.';

-- ── 2. Required fields ───────────────────────────────────────────────────────
-- crm_form_fields had no way to say a blank must be filled. Defaults to false so
-- every existing form behaves exactly as it does today.
alter table public.crm_form_fields
  add column if not exists required boolean not null default false;

comment on column public.crm_form_fields.required is
  'Blocks generating the document while this field is empty. Curated per form.';

-- ── 3. Curate the LOI forms ──────────────────────────────────────────────────
-- Only what makes the letter a valid letter. Deliberately conservative: a field
-- marked required here stops an agent generating, so anything merely desirable
-- (rentable_sf, escalation, TI allowance) is left optional and surfaced as
-- "check these" in the review screen instead.
update public.crm_form_fields ff
   set required = true
  from public.crm_forms f
 where f.id = ff.form_id
   and f.form_code = 'LOI-PURCHASE'
   and ff.field_key in (
     'loi_date','addressee_name','seller','purchaser','property_l1',
     'purchase_price','agent_name','agent_email','agent_phone'
   );

update public.crm_form_fields ff
   set required = true
  from public.crm_forms f
 where f.id = ff.form_id
   and f.form_code = 'LOI-LEASE'
   and ff.field_key in (
     'loi_date','landlord_name','property_address','lease_term','rental_rate',
     'agent_name','agent_email','agent_phone'
   );
