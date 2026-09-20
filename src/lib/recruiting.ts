/**
 * Recruiting copy — the single source of truth for what we tell agents.
 *
 * Every claim in here is one the broker has confirmed. Nothing about
 * economics (splits, caps, desk fees, benefits) is stated as fact, because
 * none of it has been set yet: those read as CONFIRM_* placeholders so an
 * unfinished number is obvious on the page instead of quietly becoming a
 * promise we can't keep. Replace a placeholder only with a figure the broker
 * has actually given you.
 *
 * Shared by /join and /careers and by the printed one-pagers, so the pitch
 * can't drift between the website and what Zack hands someone in person.
 */

/** Marks a number only the broker can supply. Renders visibly unfinished on purpose. */
export const CONFIRM = {
  split: '[commission split — confirm]',
  cap: '[annual cap — confirm]',
  fees: '[desk / monthly fees — confirm]',
  transactionFee: '[per-transaction fee — confirm]',
  benefits: '[benefits & perks — confirm]',
  capPlan: '[cap / post-cap structure — confirm]',
} as const;

export interface ValueProp {
  /** lucide-react icon name, resolved by the page. */
  icon: 'UserCheck' | 'Laptop' | 'Megaphone' | 'Search' | 'Network' | 'DollarSign';
  title: string;
  body: string;
  /** True when the copy contains a placeholder the broker still has to fill. */
  needsConfirm?: boolean;
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
      `Commission split ${CONFIRM.split}, ${CONFIRM.fees}. Ask Zack directly — he'll tell you the exact structure before you ever fill out a form.`,
    needsConfirm: true,
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
      `Split ${CONFIRM.split}, ${CONFIRM.capPlan}, ${CONFIRM.fees}. Zack sets these directly with you — no committee, no sliding scale you have to decode.`,
    needsConfirm: true,
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
