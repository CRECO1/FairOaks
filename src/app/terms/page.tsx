import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';

/**
 * /terms — Terms of Use.
 *
 * The footer has linked "Terms of Service" to /terms on every page, but the route
 * never existed, so that link 404'd site-wide (caught by the 2026-09 CTA test).
 * Adapted from crecotx.com's /terms for the residential brand and Fair Oaks' own
 * NAP. General-purpose brokerage boilerplate — review and tighten with counsel
 * before treating it as legally binding.
 */
export const metadata: Metadata = {
  title: 'Terms of Use | Fair Oaks Realty Group',
  description:
    'Fair Oaks Realty Group Terms of Use — the terms that govern use of fairoaksrealtygroup.com, our services, and the content published on the site.',
  alternates: { canonical: 'https://www.fairoaksrealtygroup.com/terms' },
  robots: { index: true, follow: true },
};

const LAST_UPDATED = 'September 18, 2026';

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen pt-20 bg-white">
        <div className="bg-primary py-12 text-white">
          <Container>
            <p className="overline mb-2 text-gold">Legal</p>
            <h1 className="font-heading text-display-sm font-bold">Terms of Use</h1>
            <p className="mt-2 text-body-sm text-white/60">Last updated: {LAST_UPDATED}</p>
          </Container>
        </div>

        <Container className="py-12 max-w-3xl">
          <article className="space-y-6 text-body text-foreground-muted leading-relaxed">
            <p>
              Welcome to Fair Oaks Realty Group (&ldquo;Fair Oaks Realty Group,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). These Terms of Use (&ldquo;Terms&rdquo;) govern your access to and use of the website located at{' '}
              <a href="https://www.fairoaksrealtygroup.com" className="text-gold hover:underline">fairoaksrealtygroup.com</a> (the &ldquo;Site&rdquo;). By using the Site, you agree to be bound by these Terms. If you do not agree, please do not use the Site.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Use of the Site</h2>
            <p>
              You may use the Site for lawful personal purposes related to buying, selling, or researching residential real estate. You agree not to use the Site in any manner that could interfere with, disrupt, or overburden its operation, to scrape or republish listing data in bulk, or to violate any applicable law or regulation.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Listing Information</h2>
            <p>
              Home listings, prices, availability, square footage, school assignments, HOA details, and other property information shown on the Site come in part from the San Antonio Board of REALTORS&reg; Multiple Listing Service and other sources. This information is provided for informational purposes, is deemed reliable but not guaranteed, and is subject to change without notice. Listings may be held by brokerages other than Fair Oaks Realty Group. Verify all material facts — including school zoning — independently before making any purchase decision.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Home Valuations and Market Information</h2>
            <p>
              Home value estimates, market reports, guides, and other content on the Site are general information only. A value estimate is not an appraisal, and nothing on the Site is legal, tax, lending, or investment advice. Consult a qualified professional before acting on any information found on the Site.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Broker Licensing</h2>
            <p>
              Real estate brokerage services are provided under Texas Real Estate Commission (TREC) license #9014367, in accordance with TREC rules and applicable Texas law. The TREC Information About Brokerage Services and Consumer Protection Notice are linked in the Site footer.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Intellectual Property</h2>
            <p>
              The Site&apos;s design, logo, text, graphics, and other original content are the property of Fair Oaks Realty Group or its licensors and are protected by copyright and trademark law. You may not reproduce, republish, or distribute Site content without our prior written permission, except that limited quotation for personal or editorial purposes is permitted with attribution. Listing photographs remain the property of their respective owners.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Third-Party Links</h2>
            <p>
              The Site may link to third-party websites (for example, Google Maps, lenders, school districts, and TREC). We do not control those sites and are not responsible for their content, policies, or practices. Visits to linked sites are at your own risk.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, Fair Oaks Realty Group and its affiliates, principals, agents, and employees will not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of the Site or reliance on any content provided through the Site.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. When we do, we&apos;ll update the &ldquo;Last updated&rdquo; date above. Continued use of the Site after changes constitutes acceptance of the updated Terms.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Governing Law</h2>
            <p>
              These Terms are governed by the laws of the State of Texas, without regard to conflict-of-laws principles. Any dispute arising under these Terms is subject to the exclusive jurisdiction of the state and federal courts located in Bexar County, Texas.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Contact</h2>
            <p>
              Questions about these Terms? Reach us at{' '}
              <a href="mailto:info@fairoaksrealtygroup.com" className="text-gold hover:underline">info@fairoaksrealtygroup.com</a>,{' '}
              <a href="tel:+12103909997" className="text-gold hover:underline">210-390-9997</a>, or via the{' '}
              <Link href="/contact" className="text-gold hover:underline">contact page</Link>. Our office is at 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015.
            </p>

            <hr className="my-10 border-border" />
            <p className="text-body-sm">
              See also our <Link href="/privacy" className="text-gold hover:underline">Privacy Policy</Link>.
            </p>
          </article>
        </Container>
      </main>
      <Footer />
    </>
  );
}
