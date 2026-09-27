/**
 * Which side of a deal we are on.
 *
 * Every party field on a legal form depends on this: who is "our client" and who is
 * "the other party", and — on the contract forms — which representation box is ticked.
 * Getting it wrong does not produce an obviously broken document, it produces a
 * plausible one with the parties transposed, which is far worse.
 *
 * So this module derives, and reports how sure it is. It never settles a conflict by
 * precedence. Anything short of `confirmed` is a pre-selection the agent accepts; a
 * conflict or a blank is surfaced and auto-fill of party fields stops.
 *
 * Measured against the live book when this was written: deal.type and the linked
 * contact's type agreed on 17 of 23 deals. Of the other six, two were an investor
 * buying (the contact type describes what they usually are, not their role here), one
 * was a real contradiction, and three had a broker rather than a principal on the deal.
 */

export type Side = 'buyer' | 'tenant' | 'seller' | 'landlord' | 'intermediary' | 'unknown';

/** Mirrors the crm_deals_representation_side_check constraint. */
export const VALID_SIDES: Side[] = ['buyer', 'tenant', 'seller', 'landlord', 'intermediary', 'unknown'];

/** How much weight the answer carries. Only `confirmed` and `high` may fill party fields. */
export type SideConfidence = 'confirmed' | 'high' | 'medium' | 'conflict' | 'none';

export interface SideResult {
  side: Side;
  confidence: SideConfidence;
  /** One line an agent can read and judge. */
  reason: string;
  /** True when the agent must choose before party fields can be filled. */
  needsConfirmation: boolean;
  /** What each signal said, so the review screen can show its working. */
  signals: { dealType?: string | null; contactType?: string | null; stored?: Side };
}

/** The two camps. Which one we are in decides who is "our client" on every form. */
export const isProposingSide = (s: Side) => s === 'buyer' || s === 'tenant';
export const isOwnerSide = (s: Side) => s === 'seller' || s === 'landlord';

/**
 * Two independent axes, because the two signals answer different questions.
 *
 *   TRANSACTION (lease or sale) — only the DEAL knows this. A contact typed
 *   "Landlord/Investor" is describing what that person generally is, not whether
 *   this particular deal is a lease or a purchase.
 *
 *   CAMP (owner side or proposing side) — the deal says it and the contact can
 *   corroborate it, because that part does travel with the person.
 *
 * Deriving them separately is what stops the two classic mistakes: reading
 * "Seller Listing" + "Landlord/Investor" as a LEASE (it is a sale — we represent the
 * seller), and reading "Buyer Purchase" + "Landlord/Investor" as agreement (it is not
 * — the deal puts us on the proposing side and the contact on the owner side).
 */
type Transaction = 'lease' | 'sale' | 'unknown';
type Camp = 'owner' | 'proposing' | 'unknown';

function dealAxes(dealType: string | null | undefined): { txn: Transaction; camp: Camp } {
  const t = (dealType ?? '').toLowerCase();
  if (t.includes('seller listing') || t.includes('listing')) return { txn: 'sale', camp: 'owner' };
  if (t.includes('landlord')) return { txn: 'lease', camp: 'owner' };
  if (t.includes('tenant') || t.includes('lease')) return { txn: 'lease', camp: 'proposing' };
  if (t.includes('buyer') || t.includes('purchase')) return { txn: 'sale', camp: 'proposing' };
  return { txn: 'unknown', camp: 'unknown' };
}

/** The contact's type votes on the CAMP only. Broker/Agent/Other are not principals. */
function contactCamp(contactType: string | null | undefined): Camp {
  switch ((contactType ?? '').trim()) {
    case 'Tenant': case 'Buyer': return 'proposing';
    case 'Seller': case 'Landlord/Investor': return 'owner';
    default: return 'unknown';
  }
}

function combine(txn: Transaction, camp: Camp): Side {
  if (txn === 'unknown' || camp === 'unknown') return 'unknown';
  if (txn === 'sale') return camp === 'owner' ? 'seller' : 'buyer';
  return camp === 'owner' ? 'landlord' : 'tenant';
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

export interface DeriveInput {
  /** crm_deals.representation_side — an agent's stored decision, if there is one. */
  stored?: string | null;
  /** What the agent said in this request. Outranks everything: they are the source. */
  stated?: string | null;
  dealType?: string | null;
  contactType?: string | null;
  /**
   * The transaction the FORM is for, when there is no deal to say.
   *
   * A contact's type cannot tell a lease from a sale — "Landlord/Investor" describes a
   * person, not this transaction. But the document does: a Letter of Intent to Purchase
   * is a sale by construction. Supplying it is what lets a contact-only or ad-hoc
   * request derive a side at all instead of always stopping to ask.
   */
  formTransaction?: 'lease' | 'sale' | null;
}

export function deriveSide({ stored, stated, dealType, contactType, formTransaction }: DeriveInput): SideResult {
  const signals = { dealType: dealType ?? null, contactType: contactType ?? null };

  // 0. The agent said it in this request. They are the authority; nothing outranks it.
  if (stated && stated !== 'unknown' && VALID_SIDES.includes(stated as Side)) {
    return {
      side: stated as Side, confidence: 'confirmed',
      reason: `You told me we represent the ${stated}.`,
      needsConfirmation: false, signals: { ...signals, stored: stated as Side },
    };
  }

  // 1. An agent already recorded it on the deal. Nothing re-derives over that.
  if (stored && stored !== 'unknown') {
    return {
      side: stored as Side, confidence: 'confirmed',
      reason: `Set on the deal: we represent the ${stored}.`,
      needsConfirmation: false, signals: { ...signals, stored: stored as Side },
    };
  }

  const fromDeal = dealAxes(dealType);
  // With no deal type, the form supplies the transaction axis and the contact the camp.
  const txn: Transaction = fromDeal.txn !== 'unknown' ? fromDeal.txn : (formTransaction ?? 'unknown');
  const dealCamp = fromDeal.camp;
  const cCamp = contactCamp(contactType);

  // 2. Nothing establishes lease vs sale — not the deal, not the form.
  if (txn === 'unknown') {
    return {
      side: 'unknown', confidence: 'none',
      reason: cCamp === 'unknown'
        ? 'Nothing here says which side we are on — there is no deal type and the contact type does not settle it.'
        : `There is no way to tell a lease from a sale here. The contact is ${article(String(contactType))} ${contactType}, which only says which side of the table they are on.`,
      needsConfirmation: true, signals,
    };
  }

  const noDeal = fromDeal.camp === 'unknown';

  // 3. NO DEAL, but the form gives the transaction and the contact gives the camp.
  //    This is the contact-only path: a real derivation, one signal short of the
  //    corroborated case, so the agent still confirms it.
  if (noDeal) {
    if (cCamp === 'unknown') {
      return {
        side: 'unknown', confidence: 'none',
        reason: contactType
          ? `The contact is ${article(contactType)} ${contactType}, which is not a principal, so it does not say which side we represent. Tell me and I will use it.`
          : 'There is no deal and no contact to derive a side from. Tell me which side we represent.',
        needsConfirmation: true, signals,
      };
    }
    const side = combine(txn, cCamp);
    return {
      side, confidence: 'medium',
      reason: `No deal record, so this comes from the form (${txn === 'sale' ? 'a purchase' : 'a lease'}) and the contact's type "${contactType}" — that puts us on the ${side} side. Confirm it.`,
      needsConfirmation: true, signals,
    };
  }

  // 4. The contact is not a principal (broker, agent, unset) — the deal stands alone.
  if (cCamp === 'unknown') {
    return {
      side: combine(txn, dealCamp), confidence: 'medium',
      reason: contactType
        ? `Deal type "${dealType}" points to the ${combine(txn, dealCamp)} side. The linked contact is ${article(contactType)} ${contactType}, not a principal, so it does not corroborate.`
        : `Deal type "${dealType}" points to the ${combine(txn, dealCamp)} side. The deal has no linked contact to corroborate it.`,
      needsConfirmation: true, signals,
    };
  }

  // 5. Both agree on the camp. The deal supplies lease-vs-sale.
  if (cCamp === dealCamp) {
    const side = combine(txn, dealCamp);
    return {
      side, confidence: 'high',
      reason: `Deal type "${dealType}" and the contact's type "${contactType}" both put us on the ${side} side.`,
      needsConfirmation: true,   // high, but on a legal form it is still a pre-selection
      signals,
    };
  }

  // 6. They contradict each other on the camp. Do not pick a winner.
  return {
    side: 'unknown', confidence: 'conflict',
    reason: `Deal type "${dealType}" puts us on the ${combine(txn, dealCamp)} side, but the contact is typed "${contactType}", which is the other side of the table. Confirm which is right.`,
    needsConfirmation: true, signals,
  };
}

/** Party fields may only be auto-filled from a side we are actually sure of. */
export function mayFillPartyFields(r: SideResult): boolean {
  return r.confidence === 'confirmed' || r.confidence === 'high';
}

/** Plain-English label for the UI chip and the Copilot's narration. */
export function sideLabel(side: Side): string {
  switch (side) {
    case 'buyer': return 'the Buyer';
    case 'tenant': return 'the Tenant';
    case 'seller': return 'the Seller';
    case 'landlord': return 'the Landlord';
    case 'intermediary': return 'both parties (intermediary)';
    default: return 'not yet established';
  }
}
