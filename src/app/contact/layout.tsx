import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact a Fair Oaks Ranch Realtor | Schedule a Consultation',
  description:
    'Contact the top real estate agents in Fair Oaks Ranch, TX. Schedule a free consultation, get a home valuation, or ask about buying or selling in Texas Hill Country.',
  keywords: [
    'Fair Oaks Ranch realtor contact',
    'contact real estate agent Fair Oaks Ranch TX',
    'Fair Oaks Ranch real estate consultation',
    'schedule home valuation Fair Oaks Ranch',
    'Fair Oaks Realty Group phone number',
    'contact Texas Hill Country realtor',
    'Fair Oaks Ranch TX real estate office',
    'Boerne TX realtor contact',
    'Helotes real estate agent contact',
    'real estate help Fair Oaks Ranch',
  ],
  openGraph: {
    title: 'Contact Fair Oaks Realty Group | Fair Oaks Ranch TX Realtors',
    description:
      'Reach out to our expert team of Fair Oaks Ranch realtors. Free consultations, home valuations, and local market insights.',
    url: 'https://www.fairoaksrealtygroup.com/contact',
    type: 'website',
  },
  alternates: {
    canonical: 'https://www.fairoaksrealtygroup.com/contact',
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
