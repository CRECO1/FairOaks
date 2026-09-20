/**
 * Recruiting copy — the single source of truth for what we tell agents.
 *
 * Every claim in here is one the broker has confirmed. Economics are the
 * exception: the terms ARE settled, but the broker does not want them public,
 * so no split percentage, cap, fee figure or contractor classification may
 * appear in this file or anything it feeds. See PRIVATE_TERMS below.
 *
 * Shared by /join and /careers and by the printed one-pagers, so the pitch
 * can't drift between the website and what Zack hands someone in person.
 */

/**
 * How economics are described in PUBLIC copy.
 *
 * The broker has settled the actual terms, but they are deliberately not
 * published: no split percentage, no cap, no fee figure, and no contractor
 * classification appears on any page this module feeds. Those are discussed
 * with a candidate directly.
 *
 * The real terms are recorded off the web surface entirely, in
 * /Users/creco/Documents/CRECO/Marketing/recruiting/INTERNAL-recruiting-terms.md.
 * Do not import them here, and do not "helpfully" put a number in this string —
 * anything in this file renders on a public page.
 */
export const PRIVATE_TERMS =
  'Competitive commission structure and terms discussed directly with qualified candidates.';

export interface ValueProp {
  /** lucide-react icon name, resolved by the page. */
  icon: 'UserCheck' | 'Laptop' | 'Megaphone' | 'Search' | 'Network' | 'DollarSign';
  title: string;
  body: string;
}

/**
 * Residential pitch (Fair Oaks Realty Group). Warmer, service-led — the
 * audience is a Hill Country agent who wants support, not a bigger logo.
 */
export const FAIR_OAKS_VALUE_PROPS: ValueProp[] = [
  {
    icon: 'UserCheck',
    title: 'You work directly with the broker',
    body:
      'Zachary Stovall is a hands-on broker/owner, not a name on the wall. You bring him a deal question and you get an answer the same day — from the person who actually signs off on the file.',
  },
  {
    icon: 'Laptop',
    title: 'A CRM built for this brokerage',
    body:
      'Not a bolt-on you have to pay for separately. Our own CRM handles your contacts, action plans and campaigns, with e-signature built in so you can send a document for signature and track it without leaving the system.',
  },
  {
    icon: 'Megaphone',
    title: 'Lead generation you inherit on day one',
    body:
      'We run an active lead-generation operation — website capture, follow-up automation and a CRM that routes new inquiries to an owner instead of letting them sit in an inbox.',
  },
  {
    icon: 'Search',
    title: 'Found on Google and by AI search',
    body:
      'We invest in how this brokerage shows up in search — including the AI assistants buyers now ask first. Your listings sit on a site built to be found and cited, not buried on page four.',
  },
  {
    icon: 'Network',
    title: 'Two brokerages, one roof',
    body:
      'Fair Oaks Realty Group handles residential; our sister company CRECO handles commercial. Your residential client with a business need has somewhere to go, and commercial clients who need a home come back the other way. You refer across instead of giving the deal away.',
  },
  {
    icon: 'DollarSign',
    title: 'Straightforward economics',
    body:
      `${PRIVATE_TERMS} Zack walks you through the whole structure himself — you will know exactly where you stand well before you commit to anything.`,
  },
];

/**
 * Commercial pitch (CRECO). Drier, economics-forward — the audience is a
 * commercial broker who cares about pipeline, support and the split.
 */
export const CRECO_VALUE_PROPS: ValueProp[] = [
  {
    icon: 'UserCheck',
    title: 'Principal-led, not an agent farm',
    body:
      'You work assignments alongside Zachary Stovall, the broker/owner, and Brian Blanco, who runs an active leasing pipeline. Small team, real deals, direct access to the people making the decisions.',
  },
  {
    icon: 'Laptop',
    title: 'Deal infrastructure that already exists',
    body:
      'A custom CRM with e-signature and automation built in — LOIs and lease documents out for signature, tenant and landlord records, tasks and follow-up sequences. You are not rebuilding a tech stack on your own dime.',
  },
  {
    icon: 'Megaphone',
    title: 'Live leasing pipeline and lead flow',
    body:
      "Brian's leasing pipeline is active, and we run ongoing lead generation into the CRM. There is real product to work from your first week rather than a cold start.",
  },
  {
    icon: 'Search',
    title: 'Search presence that surfaces your listings',
    body:
      'We put serious work into how CRECO ranks on Google and how AI search tools cite us. Tenants and investors researching Texas space find our listings — which means they find yours.',
  },
  {
    icon: 'Network',
    title: 'Commercial and residential under one owner',
    body:
      'CRECO handles commercial; our sister brokerage Fair Oaks Realty Group handles residential. Your tenant buying a house, your investor selling a personal residence — that referral stays in the family instead of walking out the door.',
  },
  {
    icon: 'DollarSign',
    title: 'Economics worth a conversation',
    body:
      `${PRIVATE_TERMS} Zack sets them directly with you — no committee, and no sliding scale to decode.`,
  },
];

// ── Recruiting pipeline ─────────────────────────────────────────────────────

/**
 * The recruiting funnel. Deliberately NOT the crm_deals stage list — agent
 * prospects are people we are hiring, not client transactions, and mixing
 * them into the deal board would corrupt pipeline value reporting.
 *
 * Implemented as tags so it works in the CRM's existing contact UI with no
 * schema change: a contact carries exactly one `Recruiting: <stage>` tag and
 * moving them is swapping that tag. Each stage also has a saved smart list.
 */
export const RECRUITING_STAGES = ['Prospect', 'Contacted', 'Interview', 'Offer', 'Joined'] as const;
export type RecruitingStage = typeof RECRUITING_STAGES[number];

/** Tag every agent prospect carries, whatever their stage. */
export const RECRUITING_TAG = 'Recruiting';

export function stageTag(stage: RecruitingStage): string {
  return `Recruiting: ${stage}`;
}

/** Tags applied to a brand-new applicant. */
export function newApplicantTags(businessUnit: 'residential' | 'commercial'): string[] {
  return [
    RECRUITING_TAG,
    stageTag('Prospect'),
    businessUnit === 'commercial' ? 'CRECO' : 'Fair Oaks',
  ];
}
