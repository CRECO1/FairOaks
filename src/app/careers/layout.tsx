import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Careers | Fair Oaks Realty Group',
  description: 'Join one of the Texas Hill Country\'s most trusted real estate teams. Competitive splits, built-in lead flow, full marketing support, and a culture that has your back.',
  keywords: ['real estate agent jobs San Antonio', 'join real estate team Texas', 'real estate careers Hill Country', 'Fair Oaks Realty Group careers', 'real estate agent Fair Oaks Ranch', 'CRECO careers'],
  openGraph: {
    title: 'Careers at Fair Oaks Realty Group',
    description: 'Build your real estate career with a team that invests in your success. Open positions in residential and commercial real estate.',
  },
};

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
