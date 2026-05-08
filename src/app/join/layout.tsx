import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Join Our Team | Fair Oaks Realty Group',
  description: 'Build your real estate career with Fair Oaks Realty Group. Competitive splits, tech tools, marketing support, and a proven lead system in the Texas Hill Country.',
  keywords: ['real estate agent jobs San Antonio', 'join real estate brokerage Texas', 'real estate careers Hill Country', 'Fair Oaks Realty Group careers', 'real estate agent Fair Oaks Ranch'],
  openGraph: {
    title: 'Join Our Team — Fair Oaks Realty Group',
    description: 'Competitive splits, tech tools, and a proven lead system. Apply to join one of the Texas Hill Country\'s most trusted real estate teams.',
  },
};

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
