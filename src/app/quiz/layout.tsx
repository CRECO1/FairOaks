import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "What's My Home Worth? | Free Home Value Quiz – Fair Oaks Ranch TX",
  description:
    "Find out what your Fair Oaks Ranch home is worth in today's market. Take our free 2-minute home value quiz and get a personalized report from local real estate experts.",
  keywords: [
    "what is my home worth Fair Oaks Ranch",
    "free home valuation Fair Oaks Ranch TX",
    "home value quiz Fair Oaks Ranch",
    "Fair Oaks Ranch home worth",
    "home price estimate Fair Oaks Ranch Texas",
    "Texas Hill Country home value",
    "Boerne TX home value estimate",
    "how much is my house worth Fair Oaks Ranch",
    "free home value report TX",
    "instant home valuation Fair Oaks Ranch",
  ],
  openGraph: {
    title: "What's My Home Worth? | Fair Oaks Ranch Home Value Quiz",
    description:
      "Take our free 2-minute quiz to find out what your home is worth in today's Fair Oaks Ranch real estate market.",
    url: 'https://www.fairoaksrealtygroup.com/quiz',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com/quiz',
  },
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
