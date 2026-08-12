import Image from 'next/image';
import { ArrowUpRight, Briefcase, Building2, LineChart, Wrench } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { RevealOnScroll } from '@/hooks/useScrollReveal';

const CRECO_URL = 'https://www.crecotx.com';

const SERVICES = [
  { icon: Briefcase, label: 'Tenant Representation', desc: 'We work for tenants finding the right space and terms.' },
  { icon: Building2, label: 'Leasing & Sales', desc: 'Owner-side leasing and sales across every asset type.' },
  { icon: LineChart, label: 'Investment Advisory', desc: 'Underwriting and strategy for multi-property owners.' },
  { icon: Wrench, label: 'Property Management', desc: 'Day-to-day operations for commercial assets.' },
];

/**
 * Home-page cross-promotion band introducing CRECO, the commercial real estate
 * arm of the business, to residential visitors. Links out to crecotx.com.
 */
export function CommercialCallout() {
  return (
    <section className="section-luxury bg-background-warm">
      <Container>
        <RevealOnScroll>
          <div className="overflow-hidden rounded-2xl bg-white shadow-luxury ring-1 ring-gold/20">
            <div className="grid grid-cols-1 lg:grid-cols-2">
              {/* ── Copy ─────────────────────────────────────────────── */}
              <div className="flex flex-col justify-center p-8 sm:p-12 lg:p-14">
                <p className="overline mb-3">Commercial Real Estate</p>
                <h2 className="font-heading text-display-sm font-bold text-primary">
                  Need space for your business?
                </h2>
                <p className="mt-5 max-w-xl text-body text-foreground-muted">
                  Beyond finding homes, our team also runs <strong className="font-semibold text-primary">CRECO</strong> —
                  a full-service commercial real estate company serving businesses and
                  investors across Texas. Retail, office, industrial, and land, for
                  lease or for sale.
                </p>

                <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                  {SERVICES.map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold-dark">
                        <Icon className="h-5 w-5" strokeWidth={1.75} />
                      </span>
                      <div>
                        <p className="font-semibold text-primary text-body-sm leading-snug">{label}</p>
                        <p className="mt-0.5 text-caption text-foreground-muted">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Button size="lg" asChild>
                    <a href={CRECO_URL} target="_blank" rel="noopener noreferrer">
                      Explore CRECO Commercial
                      <ArrowUpRight className="ml-2 h-5 w-5" />
                    </a>
                  </Button>
                  <p className="text-caption text-foreground-muted">
                    Same local team · 8000 Fair Oaks Pkwy
                  </p>
                </div>
              </div>

              {/* ── Brand mark ───────────────────────────────────────── */}
              <div className="relative flex flex-col items-center justify-center gap-6 bg-gold-lighter/60 p-8 sm:p-12 lg:border-l lg:border-gold/10">
                <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-card">
                  <Image
                    src="/creco-logo.jpg"
                    alt="CRECO — Commercial Real Estate Company"
                    width={720}
                    height={506}
                    className="h-auto w-full"
                  />
                </div>
                <p className="text-caption uppercase tracking-widest text-foreground-light">
                  Texas Commercial Real Estate · Statewide
                </p>
              </div>
            </div>
          </div>
        </RevealOnScroll>
      </Container>
    </section>
  );
}
