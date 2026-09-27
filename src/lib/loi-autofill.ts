/**
 * Deterministic auto-fill for the Letters of Intent.
 *
 * The rule this module exists to enforce: a legal field value is either PULLED from a
 * named CRM record, SUPPLIED by the agent, or LEFT BLANK AND FLAGGED. There is no
 * fourth branch, and nothing here asks a model for a value. Everything below is a
 * lookup table and a handful of formatters.
 *
 * Every slot carries where its value came from, so the review screen can show the
 * agent the provenance of each line rather than a wall of pre-filled text they will
 * skim. A field the CRM could not source is not quietly left empty — it is named.
 *
 * WHY THE LOIs FIRST. These four forms are the only ones whose generator is already
 * data-driven: loi-doc.ts renders from a term list (`LoiPurchaseData`), not from
 * stamped overlay coordinates. So "which field" is a label from a closed set defined
 * in our own source, not a string scraped off a PDF — exact matching is actually
 * exact. The 43/19/19 template field_keys are legacy, used here only to read which
 * fields were curated as required.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  specForForm, type LoiSpec, type LoiPurchaseData, type LoiTermRow,
} from '@/lib/loi-doc';
import { deriveSide, mayFillPartyFields, isProposingSide, type SideResult, type Side } from '@/lib/representation-side';

/** Where a value came from. Drives the review screen and nothing else. */
export type Provenance =
  | 'crm'            // pulled from a named record — `source` says which
  | 'default'        // the template's standard language, or today's date
  | 'agent'          // supplied by the agent on this request
  | 'needs_input'    // no source exists; the agent must type it
  | 'missing_source';// a mapping exists but the record's field is empty

export interface DraftSlot {
  /** Stable identifier: a meta slot ("loi_date") or a term row's label. */
  slot: string;
  label: string;
  value: string;
  provenance: Provenance;
  /** Human sentence naming the origin, e.g. 'Contact — Acme Holdings LLC'. */
  source: string;
  required: boolean;
  /** Worth a second look even though it is filled (money, an inferred figure). */
  check?: string;
}

export interface LoiDraft {
  formId: string;
  formName: string;
  formCode: string;
  title: string;
  dealId: string | null;
  listingId: string | null;
  side: SideResult;
  /** The rendered payload. Only complete once the agent has filled needsInput. */
  data: LoiPurchaseData;
  slots: DraftSlot[];
  needsInput: DraftSlot[];
  checkThese: DraftSlot[];
  /** Set when the draft cannot responsibly be produced at all. */
  blocked: { reason: string; fix: string } | null;
}

/* ── formatters ─────────────────────────────────────────────────────────────── */

const longDate = (d = new Date()): string =>
  d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' });

const money = (v: unknown): string => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString('en-US')}` : '';
};

const sqft = (v: unknown): string => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('en-US') : '';
};

/** A contact's name as it should read on a contract: the entity first. */
const contactName = (c: Record<string, any> | null): string =>
  !c ? '' : (String(c.business_name ?? '').trim() || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim());

/**
 * A property's address, or nothing.
 *
 * Joining whatever columns happen to be populated is not safe here: a listing with
 * only `state` filled yielded the string "TX", which would have gone onto a letter's
 * RE: line as though the CRM knew the address. A street line is the minimum that
 * makes the rest meaningful — without one this returns '' and the caller falls back
 * or asks.
 */
const addressOf = (l: Record<string, any> | null): string => {
  const street = String(l?.address ?? '').trim();
  if (!street) return '';
  return [street, l?.city, l?.state, l?.zip].map(x => String(x ?? '').trim()).filter(Boolean).join(', ');
};

/** A run of underscores is the template saying "somebody has to decide this". */
const BLANK_RE = /_{3,}/;
/** Replace the first blank run in a sentence. Used only where a CRM value is exact. */
const fillFirstBlank = (text: string, value: string): string => text.replace(BLANK_RE, value);

/* ── required fields ────────────────────────────────────────────────────────── */

/**
 * Which slots are required, read from the curated crm_form_fields.required flags and
 * translated into this generator's slots.
 *
 * The LOIs render from term rows, so a required `field_key` has to be mapped back to
 * the row it belongs to. spec.overlayKeys already holds exactly that relationship
 * (label → the field_key(s) that carried its value), so the mapping is just that map
 * inverted rather than a second list that could drift from the first.
 */
function requiredSlots(spec: LoiSpec, requiredKeys: Set<string>): Set<string> {
  const out = new Set<string>();
  const meta = spec.overlayMeta;
  const metaSlot: Record<string, string | undefined> = {
    loi_date: meta.date, addressee_name: meta.addresseeName,
    addressee_addr1: meta.addresseeAddr1, addressee_addr2: meta.addresseeAddr2,
    re_line: meta.reLine, agent_name: meta.agentName, agent_email: meta.agentEmail, agent_phone: meta.agentPhone,
  };
  for (const [slot, key] of Object.entries(metaSlot)) if (key && requiredKeys.has(key)) out.add(slot);
  // A term row is required when any field_key that fed it was marked required.
  for (const [label, keys] of Object.entries(spec.overlayKeys)) {
    if (keys.some(k => requiredKeys.has(k))) out.add(label);
  }
  // A template with no curated fields at all (the Short-Term LOI has no field rows)
  // still needs the letter to be a letter.
  if (requiredKeys.size === 0) ['loi_date', 'addressee_name', 're_line', 'agent_name', 'agent_email', 'agent_phone'].forEach(s => out.add(s));
  return out;
}

/* ── the fill ───────────────────────────────────────────────────────────────── */

export interface BuildInput {
  formId: string;
  dealId?: string | null;
  listingId?: string | null;
  /** Values the agent has already supplied, by slot. Always wins over a CRM pull. */
  provided?: Record<string, string>;
}

export interface AgentIdentity { name: string; email: string; phone: string; license: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildLoiDraft(db: SupabaseClient<any, any, any>, agent: AgentIdentity, input: BuildInput): Promise<LoiDraft | { error: string }> {
  const provided = input.provided ?? {};

  const { data: form } = await db.from('crm_forms').select('id, name, form_code, business_unit').eq('id', input.formId).maybeSingle();
  if (!form) return { error: 'Form not found' };
  const spec = specForForm(form.form_code, form.name);
  if (!spec) return { error: 'That form is not a Letter of Intent. This slice covers the LOIs only.' };

  const { data: deal } = input.dealId
    ? await db.from('crm_deals').select('id, client, client_email, client_phone, type, property, value, client_id, listing_id, representation_side, business_unit').eq('id', input.dealId).maybeSingle()
    : { data: null };
  const { data: contact } = deal?.client_id
    ? await db.from('crm_clients').select('id, first_name, last_name, business_name, email, phone, cell_phone, type').eq('id', deal.client_id).maybeSingle()
    : { data: null };
  const listingId = input.listingId ?? deal?.listing_id ?? null;
  const { data: listing } = listingId
    ? await db.from('crm_listings').select('id, name, address, city, state, zip, sq_ft, asking_price').eq('id', listingId).maybeSingle()
    : { data: null };

  const side = deriveSide({ stored: deal?.representation_side, dealType: deal?.type, contactType: contact?.type });
  const canFillParties = mayFillPartyFields(side);

  const { data: reqRows } = await db.from('crm_form_fields').select('field_key').eq('form_id', form.id).eq('required', true);
  const requiredKeys = new Set((reqRows ?? []).map(r => String(r.field_key)).filter(Boolean));
  const required = requiredSlots(spec, requiredKeys);

  const slots: DraftSlot[] = [];
  const add = (slot: string, label: string, value: string, provenance: Provenance, source: string, check?: string) =>
    slots.push({ slot, label, value, provenance, source, required: required.has(slot), check });

  /** An agent-supplied value always wins, and is tagged as theirs. */
  const take = (slot: string, label: string, pull: () => { value: string; provenance: Provenance; source: string }, check?: string) => {
    const given = provided[slot];
    if (given !== undefined && String(given).trim() !== '') { add(slot, label, String(given).trim(), 'agent', 'You supplied this', check); return; }
    const r = pull();
    add(slot, label, r.value, r.provenance, r.source, r.value ? check : undefined);
  };

  // ── Direction check ────────────────────────────────────────────────────────
  // Both LOI templates are written from the PROPOSING side: our client makes the
  // offer, the other party countersigns (the acceptance block is headed
  // "Seller:"/"Landlord:"). On a listing-side deal that direction is inverted, and
  // mapping our client into the counterparty's block would produce a letter that
  // reads as though we act for the other side. Refuse rather than transpose.
  let blocked: LoiDraft['blocked'] = null;
  if (canFillParties && !isProposingSide(side.side)) {
    blocked = {
      reason: `This deal has us representing ${side.side === 'seller' ? 'the seller' : 'the landlord'}, but the LOI templates are written from the proposing side — our client makes the offer and the other party countersigns.`,
      fix: 'Use this only if you are drafting on behalf of the offering party. Otherwise set the deal’s representation side, or start the letter blank.',
    };
  }

  // ── Meta ───────────────────────────────────────────────────────────────────
  take('loi_date', 'Letter date', () => ({ value: longDate(), provenance: 'default', source: "Today's date (US Central)" }));

  // The counterparty. No CRM record holds it: crm_listings has no owner/landlord
  // link and the deal stores only our own client. So it is asked for, every time.
  const otherPartyLabel = spec.kind === 'purchase' ? 'Seller' : 'Landlord';
  take('addressee_name', `${otherPartyLabel} — name`, () => ({
    value: '', provenance: 'needs_input',
    source: `No CRM record holds the ${otherPartyLabel.toLowerCase()} for this deal — type it in`,
  }));
  take('addressee_addr1', `${otherPartyLabel} — address line 1`, () => ({ value: '', provenance: 'needs_input', source: 'Not held in the CRM' }));
  take('addressee_addr2', `${otherPartyLabel} — address line 2`, () => ({ value: '', provenance: 'needs_input', source: 'Not held in the CRM' }));

  // Best available description of the property, in descending order of trust.
  const listingAddress = addressOf(listing);
  const propertyAddress = listingAddress || String(deal?.property ?? '').trim() || String(listing?.name ?? '').trim();
  const propertySource = listingAddress ? `Property — ${listing?.name ?? listingAddress}`
    : deal?.property ? 'Deal — property field'
    : listing?.name ? `Property — ${listing.name} (no street address on the record)`
    : '';
  take('re_line', 'RE: line', () => propertyAddress
    ? { value: propertyAddress, provenance: 'crm' as Provenance, source: propertySource }
    : { value: '', provenance: 'needs_input' as Provenance, source: 'No property on this deal — type the address' });

  // ── Agent block ────────────────────────────────────────────────────────────
  const fromProfile = (v: string, what: string) => v
    ? { value: v, provenance: 'crm' as Provenance, source: `Your profile — ${what}` }
    : { value: '', provenance: 'missing_source' as Provenance, source: `Your profile has no ${what}. Add it in Settings.` };
  take('agent_name', 'Agent name', () => fromProfile(agent.name, 'name'));
  take('agent_email', 'Agent email', () => fromProfile(agent.email, 'email'));
  take('agent_phone', 'Agent phone', () => fromProfile(agent.phone, 'phone'));

  // ── Term rows ──────────────────────────────────────────────────────────────
  const ourClient = contactName(contact) || String(deal?.client ?? '').trim();
  const ourClientSource = contact ? `Contact — ${ourClient}` : deal?.client ? 'Deal — client name' : '';

  const terms: LoiTermRow[] = spec.defaultTerms.map(row => {
    const label = row.label;
    const given = provided[label];
    if (given !== undefined && String(given).trim() !== '') {
      add(label, label.replace(/:$/, ''), String(given).trim(), 'agent', 'You supplied this');
      return { ...row, value: String(given).trim() };
    }

    let value = row.value;
    let provenance: Provenance = 'default';
    let source = 'Standard CRECO language';
    let check: string | undefined;

    // Party rows, only when the side is settled and the direction is right.
    if (label === 'Purchaser:' || label === 'Seller:') {
      const isOurSlot = (label === 'Purchaser:') === isProposingSide(side.side);
      if (!canFillParties || blocked) {
        value = ''; provenance = 'needs_input';
        source = blocked ? 'Not filled — see the direction warning above' : `Which side we represent is not settled, so party names are not filled (${side.confidence})`;
      } else if (isOurSlot && ourClient) {
        value = ourClient; provenance = 'crm'; source = `${ourClientSource} — our client, we represent ${side.side === 'buyer' ? 'the buyer' : 'the seller'}`;
      } else {
        value = ''; provenance = 'needs_input';
        source = isOurSlot ? 'No client name on this deal' : 'The other party is not held in the CRM — type it in';
      }
    } else if (label === 'Property:') {
      if (propertyAddress) { value = propertyAddress; provenance = 'crm'; source = propertySource; }
      else { value = ''; provenance = 'needs_input'; source = 'No property on this deal'; }
    } else if (label === 'Purchase Price:') {
      const m = money(deal?.value);
      if (m) { value = m; provenance = 'crm'; source = 'Deal — value'; check = 'Taken from the deal value. Confirm this is the offer price.'; }
      else { value = ''; provenance = 'needs_input'; source = 'No value on this deal'; }
    } else if (label === 'Premises:' && sqft(listing?.sq_ft) && BLANK_RE.test(row.value)) {
      value = fillFirstBlank(row.value, sqft(listing?.sq_ft));
      provenance = 'crm'; source = `Property — ${listing?.name ?? 'listing'} (${sqft(listing?.sq_ft)} SF)`;
      check = 'Rentable SF came from the property record — confirm it against the plans.';
    }

    // Whatever else happened, a row still carrying a blank run is not finished.
    if (provenance !== 'needs_input' && BLANK_RE.test(value)) {
      provenance = 'needs_input';
      source = 'The standard language leaves a blank here for you to complete';
    }
    // A template row with no standard language and nothing pulled is an empty blank
    // dressed up as a default. Say so, rather than letting it read as "filled".
    if (provenance === 'default' && !value.trim()) {
      provenance = 'needs_input';
      source = 'The template leaves this row for you to fill';
    }
    add(label, label.replace(/:$/, ''), value, provenance, source, check);
    return { ...row, value };
  });

  const bySlot = new Map(slots.map(s => [s.slot, s]));
  const v = (slot: string) => bySlot.get(slot)?.value ?? '';

  const data: LoiPurchaseData = {
    loiDate: v('loi_date'),
    addresseeName: v('addressee_name'),
    addresseeAddr1: v('addressee_addr1'),
    addresseeAddr2: v('addressee_addr2'),
    reLine: v('re_line'),
    terms,
    additionalTerms: provided.additional_terms ?? '',
    agentName: v('agent_name'),
    agentEmail: v('agent_email'),
    agentPhone: v('agent_phone'),
    sellers: [{ entity: v('addressee_name'), signatory: provided.party1_signatory ?? '' }],
  };

  return {
    formId: form.id, formName: form.name, formCode: form.form_code, title: spec.title,
    dealId: deal?.id ?? null, listingId,
    side, data, slots,
    needsInput: slots.filter(s => s.provenance === 'needs_input' || s.provenance === 'missing_source'),
    checkThese: slots.filter(s => s.check),
    blocked,
  };
}

/** Required slots still empty. The generate step refuses while this is non-empty. */
export function missingRequired(draft: LoiDraft): DraftSlot[] {
  return draft.slots.filter(s => s.required && !String(s.value).trim());
}

export const sideOf = (d: LoiDraft): Side => d.side.side;
