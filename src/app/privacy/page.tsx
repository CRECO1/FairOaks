import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';

/**
 * /privacy — Privacy Policy.
 *
 * The site had no on-domain privacy page; the footer pointed at a Dropbox PDF
 * that was actually CRECO's text-messaging policy. Adapted from crecotx.com's
 * /privacy for the residential brand and Fair Oaks' NAP, and it carries forward
 * — for Fair Oaks — the text-messaging commitments that PDF made (no sharing of
 * mobile opt-in data or consent, reply STOP to opt out). Carriers require those
 * statements for A2P 10DLC texting, so they must not be dropped.
 * General-purpose boilerplate — review with counsel.
 */
export const metadata: Metadata = {
  title: 'Privacy Policy | Fair Oaks Realty Group',
  description:
    'How Fair Oaks Realty Group collects, uses, and protects the information you share through fairoaksrealtygroup.com, including text messaging.',
  alternates: { canonical: 'https://www.fairoaksrealtygroup.com/privacy' },
  robots: { index: true, follow: true },
};

const LAST_UPDATED = 'September 18, 2026';

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen pt-20 bg-white">
        <div className="bg-primary py-12 text-white">
          <Container>
            <p className="overline mb-2 text-gold">Legal</p>
            <h1 className="font-heading text-display-sm font-bold">Privacy Policy</h1>
            <p className="mt-2 text-body-sm text-white/60">Last updated: {LAST_UPDATED}</p>
          </Container>
        </div>

        <Container className="py-12 max-w-3xl">
          <article className="space-y-6 text-body text-foreground-muted leading-relaxed">
            <p>
              Fair Oaks Realty Group (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) respects your privacy. This policy describes how we collect, use, and protect information you provide through our website at{' '}
              <a href="https://www.fairoaksrealtygroup.com" className="text-gold hover:underline">fairoaksrealtygroup.com</a>.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Information We Collect</h2>
            <p>
              When you request a home valuation, contact us, ask about a listing, save a search or sign up for listing alerts, take our home-match quiz, or apply to join our team, we collect the information you choose to provide — typically your name, email address, phone number, property address, and details about the home you are buying or selling. We may also collect basic technical information automatically (IP address, browser type, pages visited) for analytics and security.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">How We Use Your Information</h2>
            <ul className="list-disc list-outside pl-6 space-y-2">
              <li>To respond to your inquiry and provide the real estate services you request</li>
              <li>To send listing alerts, market updates, or follow-up communications related to your inquiry</li>
              <li>To improve our website, services, and client experience</li>
              <li>To comply with our obligations as a Texas real estate broker</li>
            </ul>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">How We Share Your Information</h2>
            <p>
              We do not sell, rent, or trade your personal information, and we do not share it with third parties without your consent except as described here or where required by law. We may share information with:
            </p>
            <ul className="list-disc list-outside pl-6 space-y-2">
              <li>Service providers who help us operate the site (for example, database hosting and email delivery) under confidentiality obligations</li>
              <li>Lenders, title companies, inspectors, attorneys, or cooperating brokers directly involved in a transaction you have engaged us for, with your knowledge</li>
              <li>Government authorities when legally required</li>
            </ul>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Text Messaging</h2>
            <p>
              If you provide your mobile number and opt in to receive text messages from us, you consent to the collection and use of your information as described in this policy, and we make clear what kinds of messages you will receive.
            </p>
            <ul className="list-disc list-outside pl-6 space-y-2">
              <li><strong className="text-primary">No sharing of mobile opt-in data.</strong> Text messaging originator opt-in data and consent are never shared with or sold to third parties. The sharing described above excludes this information entirely.</li>
              <li><strong className="text-primary">Opting out.</strong> You can stop receiving text messages at any time by replying <strong className="text-primary">STOP</strong> to any message from us. Reply <strong className="text-primary">HELP</strong> for help. Message and data rates may apply.</li>
            </ul>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Email</h2>
            <p>
              Every marketing email we send includes an unsubscribe link, and we honor unsubscribe requests.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Cookies &amp; Analytics</h2>
            <p>
              Our website may use cookies and similar technologies for analytics and to improve your experience. You can disable cookies in your browser settings.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Data Retention &amp; Security</h2>
            <p>
              We keep inquiry data only as long as needed to respond to your request and to meet our recordkeeping obligations as a Texas real estate broker. We use reasonable safeguards to protect your information, but no system is completely secure — please do not share sensitive information such as Social Security numbers or bank details through our forms.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Your Rights</h2>
            <p>
              You may ask us to update or delete your personal information at any time by emailing{' '}
              <a href="mailto:info@fairoaksrealtygroup.com" className="text-gold hover:underline">info@fairoaksrealtygroup.com</a>. We will honor reasonable requests, subject to legal requirements.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Children&apos;s Privacy</h2>
            <p>
              Our services are not directed at children under 13, and we do not knowingly collect information from children.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. The &ldquo;Last updated&rdquo; date at the top reflects the most recent revision.
            </p>

            <h2 className="font-heading text-heading-lg font-bold text-primary mt-10">Contact</h2>
            <p>
              Questions about this policy? Reach us at{' '}
              <a href="mailto:info@fairoaksrealtygroup.com" className="text-gold hover:underline">info@fairoaksrealtygroup.com</a> or{' '}
              <a href="tel:+12103909997" className="text-gold hover:underline">210-390-9997</a>. Fair Oaks Realty Group, 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015.
            </p>

            <hr className="my-10 border-border" />
            <p className="text-body-sm">
              See also our <Link href="/terms" className="text-gold hover:underline">Terms of Use</Link>.
            </p>
          </article>
        </Container>
      </main>
      <Footer />
    </>
  );
}
