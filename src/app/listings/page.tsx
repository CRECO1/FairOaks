import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { getFirstPageListings } from '@/lib/listings-first-page';
import { ListingsBrowser } from './ListingsBrowser';

// Server-rendered (ISR) so the initial HTML carries the H1, an intro and the first
// page of live MLS listings as real links. The page used to be a client component
// that fetched everything after load, so crawlers saw no heading and no listings.
// Search, filters, pagination and the map still run client-side on top.
export const revalidate = 1800;

export default async function ListingsPage() {
  const firstPage = await getFirstPageListings(revalidate);
  // Stamped when this page was rendered, i.e. when the listings below were fetched.
  const renderedAt = new Date();
  const lastUpdated = renderedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">

        {/* Page Header */}
        <div className="bg-primary py-10 sm:py-14 text-white">
          <Container>
            <p className="overline mb-2 text-gold">SABOR MLS</p>
            <h1 className="font-heading text-display-sm font-bold">Homes for Sale in Fair Oaks Ranch, Boerne &amp; the Texas Hill Country</h1>
            <p className="mt-3 max-w-3xl text-body text-white/70">
              Search homes currently for sale and under contract across Fair Oaks Ranch, Boerne, Helotes,
              San Antonio and the surrounding Hill Country. Listings come directly from the San Antonio
              Board of REALTORS&reg; MLS and include homes listed by other brokerages. Filter by area,
              price, bedrooms and bathrooms, or switch to the map view.
            </p>
          </Container>
        </div>

        <ListingsBrowser
          initialListings={firstPage?.listings ?? null}
          initialTotal={firstPage?.total ?? null}
          initialTotalPages={firstPage?.totalPages ?? 1}
        />

        {/* IDX Disclaimer */}
        <div className="border-t border-border bg-background-cream py-6">
          <Container>
            <p className="text-[11px] leading-relaxed text-foreground-muted">
              Information provided is deemed reliable but not guaranteed. Listings courtesy of San Antonio Board of
              REALTORS® MLS. &copy; {renderedAt.getFullYear()} SABOR. All rights reserved. Information last updated {lastUpdated}.
              IDX information is provided exclusively for consumers&apos; personal, non-commercial use and may not be used for
              any purpose other than to identify prospective properties consumers may be interested in purchasing.
            </p>
          </Container>
        </div>

      </main>
      <Footer />
    </>
  );
}
