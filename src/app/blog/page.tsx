export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Calendar, Tag } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

export const metadata: Metadata = {
  title: 'Hill Country Living | Fair Oaks Realty Group',
  description: 'Real estate insights for the Texas Hill Country — Fair Oaks Ranch market reports, neighborhood guides, buyer tips, and home selling advice from local experts.',
  keywords: ['texas hill country real estate blog', 'san antonio real estate news', 'fair oaks ranch market trends', 'boerne tx real estate market', 'texas home buying tips', 'new developments hill country', 'neighborhood guides texas', 'real estate market update 2025', 'hill country living', 'texas real estate insights'],
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'Hill Country Living | Fair Oaks Realty Group',
    description: 'New developments, neighborhood guides, and Hill Country real estate insights.',
    url: `${BASE_URL}/blog`,
    images: [{ url: `${BASE_URL}/og-blog.jpg`, width: 1200, height: 630 }],
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  featured: boolean;
  featuredImage?: { url: string; alt?: string } | null;
  author?: { name: string } | null;
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORIES: Record<string, { label: string; color: string; bg: string }> = {
  'new-developments': { label: 'New Developments', color: '#92400e', bg: '#fef3c7' },
  'neighborhoods':    { label: 'Neighborhoods',    color: '#1e40af', bg: '#dbeafe' },
  'market-update':    { label: 'Market Update',    color: '#065f46', bg: '#d1fae5' },
  'buyer-tips':       { label: 'Buyer Tips',       color: '#5b21b6', bg: '#ede9fe' },
  'seller-tips':      { label: 'Seller Tips',      color: '#9a3412', bg: '#fee2e2' },
  'lifestyle':        { label: 'Hill Country Lifestyle', color: '#374151', bg: '#f3f4f6' },
};

// ─── Seed / demo posts ────────────────────────────────────────────────────────
// These posts display until real content is added via the Payload admin panel.

const DEMO_POSTS: Post[] = [
  {
    id: 'demo-1',
    title: 'Veramendi: New Urbanism Comes to New Braunfels',
    slug: 'veramendi-new-braunfels',
    excerpt: 'Spanning 2,400 acres along the Comal River, Veramendi is one of the most ambitious master-planned communities in the Texas Hill Country. Here\'s what buyers need to know.',
    category: 'new-developments',
    publishedAt: '2025-04-15',
    featured: true,
    featuredImage: { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&auto=format&fit=crop', alt: 'Master-planned community homes' },
    author: { name: 'Fair Oaks Realty Group' },
  },
  {
    id: 'demo-2',
    title: 'Headwaters at Barton Creek: Austin\'s Hill Country Edge',
    slug: 'headwaters-barton-creek',
    excerpt: 'Headwaters is bringing 700 acres of Hill Country living to the edge of Austin — with preserved creek frontage, luxury custom lots, and quick access to the city.',
    category: 'new-developments',
    publishedAt: '2025-03-28',
    featured: false,
    featuredImage: { url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&auto=format&fit=crop', alt: 'Texas Hill Country creek and landscape' },
    author: { name: 'Fair Oaks Realty Group' },
  },
  {
    id: 'demo-3',
    title: 'Miralomas: Luxury Hillside Living Above Helotes',
    slug: 'miralomas-helotes',
    excerpt: 'Set on the elevated terrain northwest of San Antonio, Miralomas delivers gated Hill Country luxury with panoramic views, large lots, and quick access to Loop 1604.',
    category: 'new-developments',
    publishedAt: '2025-03-10',
    featured: false,
    featuredImage: { url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&auto=format&fit=crop', alt: 'Luxury Hill Country home exterior' },
    author: { name: 'Fair Oaks Realty Group' },
  },
  {
    id: 'demo-4',
    title: 'Boerne Market Report: Spring 2025',
    slug: 'boerne-market-report-spring-2025',
    excerpt: 'Inventory is up, days-on-market is stabilizing, and buyers finally have options. Here\'s the full picture for Boerne and the surrounding Hill Country market this spring.',
    category: 'market-update',
    publishedAt: '2025-04-01',
    featured: false,
    featuredImage: { url: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop', alt: 'Real estate market' },
    author: { name: 'Fair Oaks Realty Group' },
  },
  {
    id: 'demo-5',
    title: 'Why Fair Oaks Ranch Is Still One of the Best Values in the Hill Country',
    slug: 'fair-oaks-ranch-best-value',
    excerpt: 'With Boerne ISD schools, Hill Country terrain, and easy San Antonio access, Fair Oaks Ranch continues to attract families who want quality without premium Boerne prices.',
    category: 'neighborhoods',
    publishedAt: '2025-02-20',
    featured: false,
    featuredImage: { url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&auto=format&fit=crop', alt: 'Beautiful Hill Country neighborhood home' },
    author: { name: 'Fair Oaks Realty Group' },
  },
  {
    id: 'demo-6',
    title: '7 Questions to Ask Before Buying in a Master-Planned Community',
    slug: 'questions-before-buying-master-planned',
    excerpt: 'HOA fees, builder restrictions, school boundaries, resale comps — master-planned communities come with their own playbook. Know what to ask before you sign.',
    category: 'buyer-tips',
    publishedAt: '2025-02-05',
    featured: false,
    featuredImage: { url: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&auto=format&fit=crop', alt: 'Couple discussing home purchase' },
    author: { name: 'Fair Oaks Realty Group' },
  },
];

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getPosts(): Promise<Post[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/posts?limit=50&sort=-publishedAt&depth=1`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return DEMO_POSTS;
    const json = await res.json();
    const docs: Post[] = (json.docs ?? []).map((d: any) => ({
      id: d.id,
      title: d.title,
      slug: d.slug,
      excerpt: d.excerpt,
      category: d.category,
      publishedAt: d.publishedAt,
      featured: d.featured ?? false,
      featuredImage: d.featuredImage ? { url: d.featuredImage.url, alt: d.featuredImage.alt } : null,
      author: d.author ? { name: `${d.author.name ?? ''}`.trim() } : null,
    }));
    return docs.length > 0 ? docs : DEMO_POSTS;
  } catch {
    return DEMO_POSTS;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function CategoryPill({ cat }: { cat: string }) {
  const cfg = CATEGORIES[cat] ?? { label: cat, color: '#374151', bg: '#f3f4f6' };
  return (
    <span style={{ background: cfg.bg, color: cfg.color }}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold">
      {cfg.label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat } = await searchParams;
  const allPosts = await getPosts();
  const filtered = cat ? allPosts.filter(p => p.category === cat) : allPosts;
  const featured = allPosts.find(p => p.featured) ?? allPosts[0];
  const rest = filtered.filter(p => p.id !== featured.id);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Hill Country Living',
    url: `${BASE_URL}/blog`,
    publisher: {
      '@type': 'RealEstateAgent',
      name: 'Fair Oaks Realty Group',
      url: BASE_URL,
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Header variant="default" />
      <main className="min-h-screen pt-20">

        {/* Hero banner */}
        <section className="bg-primary py-16">
          <Container>
            <div className="max-w-2xl">
              <p className="text-gold text-caption uppercase tracking-widest mb-3">Hill Country Living</p>
              <h1 className="font-heading text-display font-bold text-white mb-4 leading-tight">
                New Developments &amp; Life in the Texas Hill Country
              </h1>
              <p className="text-white/70 text-body leading-relaxed">
                Expert insights on master-planned communities, neighborhood guides, market trends, and everything you need to buy or sell in the Hill Country.
              </p>
            </div>
          </Container>
        </section>

        {/* Category filter */}
        <div className="border-b border-border bg-white sticky top-20 z-10">
          <Container>
            <div className="flex gap-1 overflow-x-auto py-3 scrollbar-hide">
              <Link href="/blog"
                className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${!cat ? 'bg-primary text-white' : 'bg-transparent text-foreground-muted hover:bg-background-cream'}`}>
                All
              </Link>
              {Object.entries(CATEGORIES).map(([key, cfg]) => (
                <Link key={key} href={`/blog?cat=${key}`}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${cat === key ? 'bg-primary text-white' : 'bg-transparent text-foreground-muted hover:bg-background-cream'}`}>
                  {cfg.label}
                </Link>
              ))}
            </div>
          </Container>
        </div>

        <Container className="py-12">

          {/* Featured hero post */}
          {!cat && featured && (
            <Link href={`/blog/${featured.slug}`} className="group block mb-14">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 rounded-2xl border border-border overflow-hidden bg-white shadow-card hover:shadow-lg transition-shadow">
                {/* Image */}
                <div className="relative aspect-[16/9] lg:aspect-auto bg-background-warm">
                  {featured.featuredImage?.url ? (
                    <Image src={featured.featuredImage.url} alt={featured.featuredImage.alt ?? featured.title}
                      fill className="object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                      <span className="text-6xl">🏡</span>
                    </div>
                  )}
                  <div className="absolute top-4 left-4">
                    <span className="rounded-full bg-gold px-3 py-1 text-xs font-bold text-primary uppercase tracking-wide">
                      Featured
                    </span>
                  </div>
                </div>
                {/* Content */}
                <div className="p-8 flex flex-col justify-center">
                  <CategoryPill cat={featured.category} />
                  <h2 className="mt-3 font-heading text-heading-lg font-bold text-primary leading-tight group-hover:text-gold transition-colors">
                    {featured.title}
                  </h2>
                  <p className="mt-3 text-body text-foreground-muted leading-relaxed line-clamp-3">
                    {featured.excerpt}
                  </p>
                  <div className="mt-6 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-caption text-foreground-muted">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(featured.publishedAt)}
                      {featured.author && <span className="ml-2 text-foreground-muted">· {featured.author.name}</span>}
                    </div>
                    <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-gold group-hover:gap-2 transition-all">
                      Read more <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Post grid */}
          {rest.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {rest.map(post => (
                <Link key={post.id} href={`/blog/${post.slug}`} className="group flex flex-col rounded-xl border border-border bg-white overflow-hidden shadow-sm hover:shadow-card transition-shadow">
                  {/* Image */}
                  <div className="relative aspect-[16/9] bg-background-warm shrink-0">
                    {post.featuredImage?.url ? (
                      <Image src={post.featuredImage.url} alt={post.featuredImage.alt ?? post.title} fill className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-primary/50 flex items-center justify-center">
                        <span className="text-4xl opacity-60">🏡</span>
                      </div>
                    )}
                  </div>
                  {/* Body */}
                  <div className="flex flex-col flex-1 p-5">
                    <CategoryPill cat={post.category} />
                    <h3 className="mt-2 font-heading text-heading font-semibold text-primary leading-snug group-hover:text-gold transition-colors line-clamp-2">
                      {post.title}
                    </h3>
                    <p className="mt-2 text-body-sm text-foreground-muted leading-relaxed line-clamp-3 flex-1">
                      {post.excerpt}
                    </p>
                    <div className="mt-4 flex items-center gap-1.5 text-caption text-foreground-muted">
                      <Calendar className="h-3 w-3" />
                      {formatDate(post.publishedAt)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-foreground-muted">
              <p className="text-body font-semibold text-primary mb-2">No posts in this category yet.</p>
              <Link href="/blog" className="text-gold hover:underline text-body-sm font-semibold">View all posts →</Link>
            </div>
          )}

          {/* CTA strip */}
          <div className="mt-16 rounded-2xl bg-primary px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <h3 className="font-heading text-heading-lg font-bold text-white mb-1">Ready to find your Hill Country home?</h3>
              <p className="text-white/70 text-body-sm">Our agents know every new development, builder, and neighborhood in the area.</p>
            </div>
            <div className="flex gap-3 shrink-0">
              <Link href="/listings"
                className="inline-flex items-center justify-center rounded-lg border-2 border-white/30 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors">
                Browse Listings
              </Link>
              <Link href="/contact"
                className="inline-flex items-center justify-center rounded-lg bg-gold px-6 py-3 text-sm font-bold text-primary hover:bg-gold/90 transition-colors">
                Talk to an Agent
              </Link>
            </div>
          </div>

        </Container>
      </main>
      <Footer />
    </>
  );
}
