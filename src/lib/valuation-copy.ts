/**
 * Home-valuation copy — one wording for the offer, wherever it is promoted.
 *
 * What this offer is NOT: there is no instant online estimate on this site and
 * no automated valuation model behind it. We do not hold the comparable-sales
 * feed that would make an instant number honest, so we do not show one. The
 * offer is a real valuation a person prepares, and every line here has to keep
 * that promise — nothing may imply an instant figure, an algorithm, or an
 * appraisal.
 *
 * The commercial mirror of this lives in the CRECO repo at
 * src/lib/valuation-copy.ts. That one does have an instant range, because cap
 * rates and an owner's own NOI are enough to compute one. Houses are not.
 */

export const VALUATION_CTA = {
  heading: 'What is your home worth?',
  body:
    'Not an automated guess from a website that has never seen your house. A real valuation of your home, prepared by Zachary A. Stovall using recent Hill Country sales and what your home actually offers.',
  action: 'Request my home valuation',
  reassurance: 'Free · No obligation · Prepared by a person, not an algorithm',
} as const;

/** What the owner actually receives. Only things we genuinely do. */
export const VALUATION_INCLUDES = [
  {
    title: 'Recent comparable sales',
    body: 'What has actually sold near you, how those homes compared to yours, and what the spread between list and sale price has been.',
  },
  {
    title: 'Your home’s specifics',
    body: 'Condition, updates, lot, layout and the features a search portal cannot see — the things that move a buyer and therefore move the price.',
  },
  {
    title: 'Where the market sits',
    body: 'How long homes like yours are taking to sell right now, and whether current conditions favour listing, waiting, or preparing first.',
  },
  {
    title: 'A straight answer on price',
    body: 'A realistic range to list in, what would have to be true to reach the top of it, and what Zack would do with the house before it goes live.',
  },
] as const;

/**
 * Shown wherever the offer is described. An agent's valuation is not an
 * appraisal, and saying so plainly protects the seller and the brokerage.
 */
export const VALUATION_DISCLAIMER =
  'A broker valuation is an opinion of market value prepared by a licensed real estate agent using comparable sales and local market knowledge. It is not a formal appraisal by a licensed appraiser, and it is not a guarantee of sale price. Lenders require their own appraisal.';
