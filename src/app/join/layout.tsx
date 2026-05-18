import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Join Our Team | Fair Oaks Realty Group',
  description: 'Build your real estate career with Fair Oaks Realty Group. Competitive splits, tech tools, marketing support, and a proven lead system in the Texas Hill Country.',
  keywords: ['real estate agent jobs San Antonio', 'join real estate brokerage Texas', 'real estate careers Hill Country', 'Fair Oaks Realty Group careers', 'real estate agent Fair Oaks Ranch'],
  alternates: { canonical: 'https://www.fairoaksrealtygroup.com/join' },
  openGraph: {
    title: 'Join Our Team — Fair Oaks Realty Group',
    description: 'Competitive splits, tech tools, and a proven lead system. Apply to join one of the Texas Hill Country\'s most trusted real estate teams.',
    url: 'https://www.fairoaksrealtygroup.com/join',
    images: [{ url: 'https://www.fairoaksrealtygroup.com/images/og-home.jpg', width: 1200, height: 630 }],
  },
};

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
