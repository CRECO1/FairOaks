-- Scrub a real client's executed deal out of the "Letter of Intent to Purchase"
-- template, and add the LOI deal stage.
--
-- ── 1. The template ─────────────────────────────────────────────────────────
--
-- The template's default_values were not placeholders. Someone saved a COMPLETED
-- letter as the blank, so the template carried a real counterparty, a real buyer, a
-- $6,000,000 price, the earnest money, the title company and its closing agent by
-- name, and the January 2026 dates of that transaction. Anything that seeds a new
-- document from this template would have stamped one client's deal onto another's.
--
-- Latent rather than live: the LOIs open in the term-list builder, which renders
-- from the standard language in loi-doc.ts, so nothing has been rendering these.
-- That is also why the fix is safe — no document in flight depends on them.
--
-- What stays: the genuinely standard clauses (title policy, survey, possession,
-- feasibility, closing, option fee, environmental, prorations, purchaser's default).
-- Those are CRECO's own boilerplate and match DEFAULT_LOI_TERMS in loi-doc.ts.
--
-- What goes: everything that identified that transaction or its parties. Cleared to
-- empty rather than to invented placeholder text — an empty blank is honest, and the
-- auto-fill resolver already flags an empty required field as "needs your input".
--
-- Two rows keep generic language instead of being emptied, because the clause exists
-- in every letter and only its number changes; the underscores are how the template
-- says "somebody has to decide this", and the resolver treats a blank run as
-- needs_input automatically.

update public.crm_form_fields ff
   set default_value = ''
  from public.crm_forms f
 where f.id = ff.form_id
   and f.form_code = 'LOI-PURCHASE'
   and ff.field_key in (
     -- the parties and the property
     'addressee_name','addressee_addr1','addressee_addr2','re_line',
     'seller','purchaser','property_l1','property_l2',
     -- the money and the counterparties to the transaction
     'purchase_price','title_company',
     -- that letter's dates
     'loi_date',
     -- the agent block: this must follow whoever is signed in, not be frozen to one
     -- person. Hard-coded, every agent's letter went out under Zack's name and an
     -- address that is no longer the one on his CRM profile.
     'agent_name','agent_email','agent_phone'
   );

update public.crm_form_fields ff
   set default_value = 'The earnest money will be ($________) and escrowed within 3 business days'
  from public.crm_forms f
 where f.id = ff.form_id and f.form_code = 'LOI-PURCHASE' and ff.field_key = 'earnest_money_l1';

update public.crm_form_fields ff
   set default_value = 'This proposal expires on ____________ at 5:00 PM Central Time.'
  from public.crm_forms f
 where f.id = ff.form_id and f.form_code = 'LOI-PURCHASE' and ff.field_key = 'time_of_essence';

-- ── 2. The LOI deal stage ───────────────────────────────────────────────────
--
-- The CHECK allowed Prospect | Active | In Contract | Closed | Lost, but the stage
-- dropdown in the CRM and the copilot's update_deal_stage have both been offering
-- "LOI" — so choosing it failed with a constraint violation rather than doing
-- anything. Added between Active and In Contract, which is where the pipeline board
-- already draws it.
alter table public.crm_deals drop constraint if exists crm_deals_stage_check;
alter table public.crm_deals add constraint crm_deals_stage_check
  check (stage in ('Prospect','Active','LOI','In Contract','Closed','Lost'));
