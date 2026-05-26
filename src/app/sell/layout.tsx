import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sell Your Home in Fair Oaks Ranch TX | Free Home Valuation',
  description:
    'Thinking of selling your Fair Oaks Ranch or Hill Country home? Get a free home valuation and market analysis from Fair Oaks Realty Group\'s local experts.',
  keywords: [
    'sell my home Fair Oaks Ranch TX',
    'Fair Oaks Ranch home valuation',
    'what is my home worth Fair Oaks Ranch',
    'sell house Fast Fair Oaks Ranch',
    'Fair Oaks Ranch listing agent',
    'home seller Fair Oaks Ranch Texas',
    'Fair Oaks Ranch realtor sell home',
    'Texas Hill Country home seller',
    'sell home above asking price Fair Oaks Ranch',
    'Fair Oaks Ranch real estate agent seller',
    'Boerne TX home valuation',
    'Helotes TX sell home',
  ],
  openGraph: {
    title: 'Sell Your Home in Fair Oaks Ranch TX | Free Home Valuation',
    description:
      'Get a free home valuation from the top Fair Oaks Ranch realtors. We sell homes at 103% of list price with an average of 21 days on market.',
    url: 'https://www.fairoaksrealtygroup.com/sell',
    type: 'website',
  },
  alternates: {
    canonical: '/sell',
  },
};

export default function SellLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
