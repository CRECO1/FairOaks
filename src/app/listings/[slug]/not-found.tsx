import Link from 'next/link';
import Image from 'next/image';
import { Home, ArrowRight, Bed, Bath, Square, MapPin } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { searchProperties, getMediaBatch, resoPropertyToListing } from '@/lib/sabor-reso';
import { formatPrice } from '@/lib/utils';
import { ListingContactForm } from './ListingContactForm';

/**
 * Rendered for /listings/[slug] when the listing is no longer in the MLS feed
 * (sold or taken off-market). page.tsx calls notFound() in that case, so this
 * still returns a 404 status — Google deindexes the dead URL — while giving the
 * visitor active alternatives and a way to get matched instead of a dead end.
 */

/** A handful of current active listings to offer as alternatives. */
async function fetchActiveListings(limit = 6) {
  try {
    const filter = `StandardStatus eq ODataService.StandardStatus'ACTIVE'`;
    const result = await searchProperties({ filter, top: limit, orderby: 'ListPrice desc' });
    const props = result.value.slice(0, limit);
    if (props.length === 0) return [];
    const mediaMap = await getMediaBatch(props.map(p => p.ListingId));
    return props.map(p => resoPropertyToListing(p, mediaMap.get(p.ListingId) ?? []));
  } catch {
    return [];
  }
}

export default async function ListingNotFound() {
  const listings = await fetchActiveListings(6);

  return (
    <>
      <Header variant="minimal" />
      <main className="min-h-screen pt-20">

        {/* ── Message ──────────────────────────────────────────────────── */}
        <section className="bg-primary text-white">
          <Container className="py-16 sm:py-20 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gold/15">
              <Home className="h-8 w-8 text-gold" />
            </div>
            <p className="overline mb-3 text-gold">No longer on the market</p>
            <h1 className="font-heading text-display-sm sm:text-display font-bold text-white">
              This home is no longer available
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-body-lg text-white/70">
              The listing you were looking for has sold or been taken off the market.
              The Texas Hill Country moves fast — here are homes available right now, and
              our local team is happy to help you find the perfect one.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Button size="lg" asChild>
                <Link href="/listings">Browse Active Listings <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
                <Link href="#get-matched">Get a Custom Home Search</Link>
              </Button>
            </div>
          </Container>
        </section>

        {/* ── Active alternatives ──────────────────────────────────────── */}
        {listings.length > 0 && (
          <section className="bg-background-cream py-14">
            <Container>
              <div className="mb-10 text-center">
                <p className="overline mb-2">Available Now</p>
                <h2 className="font-heading text-display-sm font-bold text-primary">Homes on the market today</h2>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map(l => {
                  const imgs = (l.images as string[] | null) ?? [];
                  return (
                    <Link key={l.listing_key} href={`/listings/${l.slug}`} className="card-luxury group block">
                      <div className="image-luxury aspect-property bg-background-warm">
                        {imgs[0] ? (
                          <Image src={imgs[0]} alt={l.title} fill className="object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-foreground-subtle"><Home className="h-10 w-10" /></div>
                        )}
                      </div>
                      <div className="p-5">
                        <p className="mb-1 text-caption uppercase tracking-wider text-foreground-muted">
                          <MapPin className="mr-1 inline h-3 w-3" />{l.city}, TX
                        </p>
                        <h3 className="mb-2 font-heading text-heading font-semibold text-primary group-hover:text-gold transition-colors line-clamp-1">{l.title}</h3>
                        <p className="mb-4 price-tag">{formatPrice(l.price)}</p>
                        <div className="flex items-center gap-3 text-caption text-foreground-muted border-t border-border pt-4">
                          {l.bedrooms > 0 && <span className="flex items-center gap-1"><Bed className="h-3.5 w-3.5" />{l.bedrooms} bd</span>}
                          {l.bathrooms > 0 && <span className="flex items-center gap-1"><Bath className="h-3.5 w-3.5" />{l.bathrooms} ba</span>}
                          {l.sqft > 0 && <span className="flex items-center gap-1"><Square className="h-3.5 w-3.5" />{l.sqft.toLocaleString()} sf</span>}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
              <div className="mt-10 text-center">
                <Button variant="outline" size="lg" asChild>
                  <Link href="/listings">View All Active Listings <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
              </div>
            </Container>
          </section>
        )}

        {/* ── Get matched (lead capture) ───────────────────────────────── */}
        <section id="get-matched" className="bg-white py-14 scroll-mt-24">
          <Container>
            <div className="mx-auto max-w-xl rounded-2xl border border-border p-6 shadow-card sm:p-8">
              <h2 className="text-center font-heading text-heading-lg font-bold text-primary">
                Tell us what you&rsquo;re looking for
              </h2>
              <p className="mx-auto mt-2 mb-6 max-w-md text-center text-body-sm text-foreground-muted">
                We&rsquo;ll set up a custom search and alert you the moment a matching home hits the
                market — often before it&rsquo;s public.
              </p>
              <ListingContactForm listingTitle="a home like the one you were viewing" />
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
