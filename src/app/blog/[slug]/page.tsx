export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Calendar, Phone } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Container } from '@/components/ui/Container';
import { RichTextRenderer } from '@/components/blog/RichTextRenderer';

const BASE_URL = 'https://www.fairoaksrealtygroup.com';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: any;   // Lexical JSON or null (for demo posts, we use demoBody)
  demoBody?: string; // Plain HTML string for demo content
  category: string;
  publishedAt: string;
  featuredImage?: { url: string; alt?: string } | null;
  author?: { name: string; title?: string } | null;
  seo?: { metaTitle?: string; metaDescription?: string };
}

// ─── Category labels ──────────────────────────────────────────────────────────

const CAT_LABELS: Record<string, string> = {
  'new-developments': 'New Developments',
  'neighborhoods':    'Neighborhoods',
  'market-update':    'Market Update',
  'buyer-tips':       'Buyer Tips',
  'seller-tips':      'Seller Tips',
  'lifestyle':        'Hill Country Lifestyle',
};

// ─── Demo posts (full content) ────────────────────────────────────────────────

const DEMO_POSTS: Post[] = [
  {
    id: 'demo-1',
    title: 'Veramendi: New Urbanism Comes to New Braunfels',
    slug: 'veramendi-new-braunfels',
    excerpt: 'Spanning 2,400 acres along the Comal River, Veramendi is one of the most ambitious master-planned communities in the Texas Hill Country. Here\'s what buyers need to know.',
    content: null,
    demoBody: `
      <h2>What Is Veramendi?</h2>
      <p>Veramendi is a 2,400-acre master-planned community under development along the banks of the Comal River in New Braunfels, Texas. When complete, it will be home to approximately 7,500 residences, a town center, parks, trails, and a network of connected neighborhoods designed around the principles of new urbanism.</p>
      <p>The project takes its name from Juan Martín de Veramendi, a 19th-century governor of Coahuila y Texas who owned the land. The development is being led by NNP-Veramendi LP and is one of the largest planned communities in the Texas Hill Country.</p>
      <h2>Location & Access</h2>
      <p>The community sits just off FM 306, approximately 3 miles from downtown New Braunfels and roughly 30 miles northeast of San Antonio and 45 miles south of Austin. Interstate 35 — the primary corridor between San Antonio and Austin — is minutes away, making Veramendi a legitimate option for long-distance commuters.</p>
      <h2>What's Being Built</h2>
      <p>Development is rolling out in phases. Early phases focused on infrastructure and the first residential villages. The planned buildout includes:</p>
      <ul>
        <li>A walkable town center with retail, restaurants, and office space</li>
        <li>Multiple distinct residential neighborhoods with varying price points</li>
        <li>A network of hike/bike trails connected to the Comal River</li>
        <li>Multiple parks and green spaces throughout</li>
        <li>Planned schools within the community</li>
      </ul>
      <h2>Builders & Price Points</h2>
      <p>Several national and regional builders are active in Veramendi, including David Weekley, Perry Homes, and Centex. Entry-level homes start in the low $300,000s, while larger custom-lot homes can exceed $700,000. The community is specifically designed to serve a wide range of buyers, from first-time homeowners to move-up buyers and retirees.</p>
      <h2>What to Watch</h2>
      <p>As with any large master-planned community, buyers should pay attention to HOA fees (which fund amenity maintenance), the timeline for the town center and commercial development, and builder contract terms. New Braunfels has some of the fastest population growth in the nation, so demand in the area remains strong.</p>
      <p>If you're interested in touring Veramendi or exploring inventory, our team is familiar with the community and can walk you through current availability across all builders.</p>
    `,
    category: 'new-developments',
    publishedAt: '2025-04-15',
    featuredImage: { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&auto=format&fit=crop', alt: 'Master-planned community homes' },
    author: { name: 'Fair Oaks Realty Group', title: 'Hill Country Specialists' },
  },
  {
    id: 'demo-2',
    title: 'Headwaters at Barton Creek: Austin\'s Hill Country Edge',
    slug: 'headwaters-barton-creek',
    excerpt: 'Headwaters is bringing 700 acres of Hill Country living to the edge of Austin — with preserved creek frontage, luxury custom lots, and quick access to the city.',
    content: null,
    demoBody: `
      <h2>Overview</h2>
      <p>Headwaters at Barton Creek is a 700-acre master-planned community located in Bee Cave, Texas — positioned at the western edge of the Austin metro where the Hill Country begins. Developed by Freehold Communities, the project focuses on preserving the natural landscape while delivering a high-quality residential experience close to Austin's amenities.</p>
      <h2>Location</h2>
      <p>The community sits along FM 3238 (Hamilton Pool Road) in Bee Cave, within the Lake Travis ISD school district. Downtown Austin is approximately 22 miles east via TX-71. The location places residents within easy reach of the Barton Creek Greenbelt, Lake Travis, and the Hill Country Galleria.</p>
      <h2>Key Features</h2>
      <ul>
        <li>Over 200 acres permanently preserved as open space and natural parkland</li>
        <li>Direct Barton Creek frontage with access trails</li>
        <li>Resort-style amenities including a pool, event lawn, and fitness facilities</li>
        <li>Multiple lot sizes ranging from standard to large custom homesites</li>
        <li>Lake Travis ISD schools, including Bee Cave Elementary</li>
      </ul>
      <h2>Builders & Pricing</h2>
      <p>Headwaters features a curated selection of builders including Taylor Morrison, Drees Custom Homes, and Highland Homes. Pricing starts in the upper $500,000s and extends well beyond $1 million for larger custom lots with premium views.</p>
      <h2>Who It's For</h2>
      <p>Headwaters attracts buyers who want Hill Country aesthetics with Austin proximity — particularly tech employees at the major campuses along TX-71 and Bee Cave Road. The preserved natural corridor sets it apart from denser suburban alternatives closer to the city.</p>
    `,
    category: 'new-developments',
    publishedAt: '2025-03-28',
    featuredImage: { url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&auto=format&fit=crop', alt: 'Texas Hill Country creek and landscape' },
    author: { name: 'Fair Oaks Realty Group', title: 'Hill Country Specialists' },
  },
  {
    id: 'demo-3',
    title: 'Miralomas: Luxury Hillside Living Above Helotes',
    slug: 'miralomas-helotes',
    excerpt: 'Set on the elevated terrain northwest of San Antonio, Miralomas delivers gated Hill Country luxury with panoramic views, large lots, and quick access to Loop 1604.',
    content: null,
    demoBody: `
      <h2>About Miralomas</h2>
      <p>Miralomas is a gated luxury residential community situated in the rolling terrain above Helotes, Texas — northwest of San Antonio near the intersection of Old Bandera Road and Loop 1604. The community offers large homesites with Hill Country views, custom and semi-custom home options, and the privacy of a gated neighborhood without sacrificing San Antonio access.</p>
      <h2>Location</h2>
      <p>The community is located off Shaenfield Road in far northwest San Antonio/Helotes, placing residents roughly 20 minutes from the Medical Center and 25 minutes from downtown San Antonio. Northside ISD serves the area, including sought-after campuses at the secondary level.</p>
      <h2>What Sets Miralomas Apart</h2>
      <ul>
        <li>Gated entry with 24-hour security</li>
        <li>Large lots ranging from half an acre to over an acre</li>
        <li>Panoramic Hill Country views from elevated terrain</li>
        <li>Custom and luxury semi-custom builders available</li>
        <li>Proximity to the Leon Creek Greenway trail system</li>
      </ul>
      <h2>Price Range</h2>
      <p>Homes in Miralomas typically range from the upper $600,000s to over $1.2 million depending on lot size, builder, and finishes. The combination of land size, elevation, and security drives premium pricing in the market.</p>
      <h2>Is It Right for You?</h2>
      <p>Miralomas is a strong fit for buyers who prioritize views, privacy, and lot size over walkability or urban proximity. If you're comparing it to communities like The Dominion or Stone Oak, expect more land for your dollar with a more rural Hill Country feel.</p>
      <p>Our team has deep familiarity with northwest San Antonio and Helotes inventory. Contact us to schedule a private tour or to discuss how Miralomas compares to other developments in the area.</p>
    `,
    category: 'new-developments',
    publishedAt: '2025-03-10',
    featuredImage: { url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&auto=format&fit=crop', alt: 'Luxury Hill Country home exterior' },
    author: { name: 'Fair Oaks Realty Group', title: 'Hill Country Specialists' },
  },
  {
    id: 'demo-4',
    title: 'Boerne Market Report: Spring 2025',
    slug: 'boerne-market-report-spring-2025',
    excerpt: 'Inventory is up, days-on-market is stabilizing, and buyers finally have options. Here\'s the full picture for Boerne and the surrounding Hill Country market this spring.',
    content: null,
    demoBody: `
      <h2>The Headline: More Inventory, Steadier Prices</h2>
      <p>After two years of extreme supply constraints, the Boerne and Hill Country market is showing signs of balance. Active listings are up year-over-year, days on market have extended from the sub-10 days seen during peak 2021–2022 frenzy to a more normalized 45–60 days, and buyers are increasingly in a position to negotiate.</p>
      <h2>Median Sale Price</h2>
      <p>The median sale price for single-family homes in the Boerne / Kendall County area held in the $520,000–$580,000 range through Q1 2025 — a modest softening from the 2023 peak of approximately $615,000. Price-per-square-foot has followed a similar trajectory.</p>
      <h2>Demand Drivers</h2>
      <p>Despite the cooling, demand fundamentals remain intact. Remote work continues to attract buyers from Austin and Houston seeking Hill Country quality of life at lower price points. Boerne ISD consistently ranks among the top school districts in Texas, which anchors family-buyer demand year-round.</p>
      <h2>New Construction Activity</h2>
      <p>Builder activity in the Boerne MSA remains elevated. Communities including Esperanza, Vintage Oaks, and the emerging development pipeline west of Boerne proper are adding inventory across multiple price tiers.</p>
      <h2>Our Take</h2>
      <p>Spring 2025 is arguably the best buying window the Hill Country has seen in several years. Rates remain the primary headwind, but motivated sellers, longer market times, and reduced bidding wars create an environment where patient buyers can find real value.</p>
      <p>If you're considering a purchase in the Boerne area this spring, reach out to our team for a personalized market analysis and property search.</p>
    `,
    category: 'market-update',
    publishedAt: '2025-04-01',
    featuredImage: { url: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&auto=format&fit=crop', alt: 'Real estate market' },
    author: { name: 'Fair Oaks Realty Group', title: 'Hill Country Specialists' },
  },
  {
    id: 'demo-5',
    title: 'Why Fair Oaks Ranch Is Still One of the Best Values in the Hill Country',
    slug: 'fair-oaks-ranch-best-value',
    excerpt: 'With Boerne ISD schools, Hill Country terrain, and easy San Antonio access, Fair Oaks Ranch continues to attract families who want quality without premium Boerne prices.',
    content: null,
    demoBody: `
      <h2>The Value Proposition</h2>
      <p>Fair Oaks Ranch occupies a sweet spot in the Hill Country market: it delivers Boerne ISD schools, genuine Hill Country terrain, and community amenities at price points that consistently run 10–15% below comparable Boerne listings. For buyers who've been priced out of Boerne proper, Fair Oaks Ranch deserves a close look.</p>
      <h2>Schools</h2>
      <p>The community falls within Boerne Independent School District, widely regarded as one of Texas's top public school systems. Both Boerne Middle School and Boerne High School serve the area, along with highly regarded elementary campuses.</p>
      <h2>Community Character</h2>
      <p>Fair Oaks Ranch is an incorporated city, which means residents have local governance and city services rather than just HOA management. The community has an active parks system, an equestrian center, pool facilities, and regular community events that give it a distinctly neighborly character.</p>
      <h2>Commute & Access</h2>
      <p>The community sits roughly 20 minutes northwest of San Antonio via US-281 — making it genuinely commutable for most San Antonio employment centers. The Medical Center, UTSA, and the North Side tech corridor are all within practical distance.</p>
      <h2>Current Market Snapshot</h2>
      <p>Median home prices in Fair Oaks Ranch currently range from approximately $480,000 for a standard 3-bedroom to $750,000+ for larger custom builds on premium lots. Inventory has improved over the past year, giving buyers meaningful options across price tiers.</p>
    `,
    category: 'neighborhoods',
    publishedAt: '2025-02-20',
    featuredImage: { url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&auto=format&fit=crop', alt: 'Beautiful Hill Country neighborhood home' },
    author: { name: 'Fair Oaks Realty Group', title: 'Hill Country Specialists' },
  },
  {
    id: 'demo-6',
    title: '7 Questions to Ask Before Buying in a Master-Planned Community',
    slug: 'questions-before-buying-master-planned',
    excerpt: 'HOA fees, builder restrictions, resale comps — master-planned communities come with their own playbook. Know what to ask before you sign.',
    content: null,
    demoBody: `
      <h2>Why This Matters</h2>
      <p>Master-planned communities are engineered environments. They can offer tremendous value — trails, pools, parks, top schools — but they also come with rules, fees, and a community structure that isn't right for every buyer. Knowing the right questions to ask upfront can save you from an expensive mismatch.</p>
      <h2>1. What Are the HOA Fees, and What Do They Cover?</h2>
      <p>HOA fees in master-planned communities vary widely — from $50/month to over $400/month depending on amenities. Understand exactly what's covered (common areas, amenity maintenance, reserve fund, landscaping) and whether any special assessments are anticipated.</p>
      <h2>2. What Are the Architectural Review Requirements?</h2>
      <p>Most master-planned communities have an Architectural Review Committee (ARC) that controls modifications to your home's exterior — fence styles, paint colors, landscaping, additions. Review the CC&Rs carefully before committing.</p>
      <h2>3. What's the Builder's Warranty Program?</h2>
      <p>New construction typically comes with a 1-year workmanship warranty, 2-year systems warranty, and 10-year structural warranty. Understand what's covered, how claims are handled, and whether the builder is a large national or a regional operator.</p>
      <h2>4. What Does the Resale Market Look Like?</h2>
      <p>New construction in an active development means you'll be competing with builder inventory when it comes time to sell. Research how resale homes in the community have performed against builder prices — some communities have strong resale velocity, others struggle when builder inventory is high.</p>
      <h2>5. What's the Planned Commercial Build-Out Timeline?</h2>
      <p>Many master-planned communities promise a town center, retail, restaurants, and office space. Ask about the realistic timeline for that development and whether there are contractual commitments or just conceptual plans.</p>
      <h2>6. What School District Are You In?</h2>
      <p>Large master-planned communities can span multiple school district boundaries. Verify your specific lot's district assignment — don't rely on general community marketing.</p>
      <h2>7. What's the Lot Premium and What Are You Getting for It?</h2>
      <p>Builders charge lot premiums for corner lots, cul-de-sac lots, greenbelt lots, and lots with views. Understand what you're paying for and whether the premium reflects real long-term value versus marketing positioning.</p>
      <p>Have more questions about a specific development? Our team specializes in the Hill Country market and can walk you through what to look for in any community you're considering.</p>
    `,
    category: 'buyer-tips',
    publishedAt: '2025-02-05',
    featuredImage: { url: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=1200&auto=format&fit=crop', alt: 'Couple discussing home purchase' },
    author: { name: 'Fair Oaks Realty Group', title: 'Hill Country Specialists' },
  },
];

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getPost(slug: string): Promise<Post | null> {
  // Check demo posts first
  const demo = DEMO_POSTS.find(p => p.slug === slug);
  if (demo) return demo;

  try {
    const res = await fetch(
      `${BASE_URL}/api/posts?where[slug][equals]=${encodeURIComponent(slug)}&limit=1&depth=2`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.docs?.[0];
    if (!d) return null;
    return {
      id: d.id,
      title: d.title,
      slug: d.slug,
      excerpt: d.excerpt,
      content: d.content ?? null,
      category: d.category,
      publishedAt: d.publishedAt,
      featuredImage: d.featuredImage ? { url: d.featuredImage.url, alt: d.featuredImage.alt } : null,
      author: d.author ? { name: d.author.name ?? '', title: d.author.title } : null,
      seo: d.seo,
    };
  } catch {
    return null;
  }
}

async function getRelatedPosts(currentSlug: string, category: string): Promise<Post[]> {
  return DEMO_POSTS.filter(p => p.slug !== currentSlug && p.category === category).slice(0, 3);
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: 'Post Not Found' };
  const title = post.seo?.metaTitle ?? `${post.title} | Hill Country Living`;
  const description = post.seo?.metaDescription ?? post.excerpt;
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/blog/${post.slug}` },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/blog/${post.slug}`,
      images: post.featuredImage?.url ? [{ url: post.featuredImage.url }] : [],
      type: 'article',
      publishedTime: post.publishedAt,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const related = await getRelatedPosts(slug, post.category);
  const catLabel = CAT_LABELS[post.category] ?? post.category;
  const pubDate = new Date(post.publishedAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    author: { '@type': 'Organization', name: post.author?.name ?? 'Fair Oaks Realty Group' },
    publisher: { '@type': 'RealEstateAgent', name: 'Fair Oaks Realty Group', url: BASE_URL },
    url: `${BASE_URL}/blog/${post.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Header variant="default" />
      <main className="min-h-screen pt-20">

        {/* Hero */}
        <div className="bg-primary">
          <Container className="py-12">
            <Link href="/blog"
              className="mb-6 inline-flex items-center gap-2 text-white/60 hover:text-white text-body-sm transition-colors">
              <ArrowLeft className="h-4 w-4" /> Hill Country Living
            </Link>
            <div className="flex items-center gap-2 mb-4">
              <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-semibold text-gold uppercase tracking-wide">
                {catLabel}
              </span>
            </div>
            <h1 className="font-heading text-display-sm font-bold text-white max-w-3xl leading-tight mb-4">
              {post.title}
            </h1>
            <p className="text-white/70 text-body max-w-2xl leading-relaxed mb-6">{post.excerpt}</p>
            <div className="flex items-center gap-4 text-caption text-white/50">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> {pubDate}
              </span>
              {post.author && (
                <span>by <span className="text-white/70 font-semibold">{post.author.name}</span>
                  {post.author.title && <span className="text-white/40"> · {post.author.title}</span>}
                </span>
              )}
            </div>
          </Container>
        </div>

        {/* Featured image */}
        {post.featuredImage?.url && (
          <div className="bg-background-warm">
            <Container className="py-6">
              <div className="relative aspect-[16/7] rounded-2xl overflow-hidden">
                <Image src={post.featuredImage.url} alt={post.featuredImage.alt ?? post.title}
                  fill className="object-cover" priority />
              </div>
            </Container>
          </div>
        )}

        {/* Article body */}
        <Container className="py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Main content */}
            <article className="lg:col-span-2">
              {/* Lexical richText from Payload */}
              {post.content && <RichTextRenderer content={post.content} />}

              {/* Demo HTML body (for seed posts) */}
              {post.demoBody && !post.content && (
                <div className="prose-article"
                  dangerouslySetInnerHTML={{ __html: post.demoBody }} />
              )}

              {/* Back to blog */}
              <div className="mt-12 pt-8 border-t border-border">
                <Link href="/blog"
                  className="inline-flex items-center gap-2 text-gold font-semibold hover:underline">
                  <ArrowLeft className="h-4 w-4" /> Back to Hill Country Living
                </Link>
              </div>
            </article>

            {/* Sidebar */}
            <aside className="lg:col-span-1">
              <div className="sticky top-28 space-y-6">

                {/* Contact CTA */}
                <div className="rounded-xl border border-border bg-white p-6 shadow-card">
                  <h3 className="font-heading text-heading font-semibold text-primary mb-2">
                    Interested in the Hill Country?
                  </h3>
                  <p className="text-body-sm text-foreground-muted mb-5">
                    Our agents specialize in this market and can show you available homes in any of the communities we cover.
                  </p>
                  <Link href="/contact"
                    className="mb-3 flex w-full items-center justify-center rounded-lg bg-gold px-6 py-3 text-sm font-bold text-primary hover:bg-gold/90 transition-colors">
                    Talk to an Agent
                  </Link>
                  <Link href="/listings"
                    className="flex w-full items-center justify-center rounded-lg border-2 border-primary px-6 py-3 text-sm font-semibold text-primary hover:bg-primary hover:text-white transition-colors">
                    Browse Listings
                  </Link>
                  <div className="mt-5 pt-5 border-t border-border text-center">
                    <p className="text-caption text-foreground-muted mb-2">Or call us directly</p>
                    <a href="tel:+12103909997"
                      className="inline-flex items-center gap-2 font-semibold text-primary hover:text-gold transition-colors">
                      <Phone className="h-4 w-4" /> 210-390-9997
                    </a>
                  </div>
                </div>

                {/* Related posts */}
                {related.length > 0 && (
                  <div className="rounded-xl border border-border bg-white p-6">
                    <h4 className="font-heading text-heading-sm font-semibold text-primary mb-4">More Articles</h4>
                    <div className="space-y-4">
                      {related.map(r => (
                        <Link key={r.id} href={`/blog/${r.slug}`}
                          className="group block">
                          <p className="text-body-sm font-semibold text-primary group-hover:text-gold transition-colors leading-snug line-clamp-2">
                            {r.title}
                          </p>
                          <p className="text-caption text-foreground-muted mt-1">
                            {new Date(r.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </Link>
                      ))}
                    </div>
                    <Link href="/blog"
                      className="mt-5 block text-center text-body-sm font-semibold text-gold hover:underline">
                      View all articles →
                    </Link>
                  </div>
                )}

              </div>
            </aside>
          </div>
        </Container>

      </main>
      <Footer />
    </>
  );
}
