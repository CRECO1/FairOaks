import Link from 'next/link';
import { ArrowRight, Home } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { VALUATION_CTA } from '@/lib/valuation-copy';

/**
 * The one home-valuation call-to-action.
 *
 * Every surface that promotes the valuation reads its wording from
 * lib/valuation-copy, so the promise on the button always matches what
 * /home-valuation actually delivers — a valuation a person prepares, never an
 * instant number we cannot honestly produce.
 *
 * Belongs on seller-facing pages only. A buyer reading the buyer guide does
 * not own the house they are shopping for, and asking what it is worth is
 * noise to them.
 *
 * `variant`:
 *   band   — full-width dark band, to close a page
 *   inline — bordered card, to sit inside existing content
 */
export function ValuationCta({
  variant = 'band',
  surface,
}: {
  variant?: 'band' | 'inline';
  /** Where this instance lives, passed through for attribution. */
  surface?: string;
}) {
  const href = surface ? `/home-valuation?from=${encodeURIComponent(surface)}` : '/home-valuation';

  if (variant === 'inline') {
    return (
      <div className="rounded-2xl border border-border bg-background-cream p-6 sm:p-8">
        <div className="mb-3 flex items-center gap-2">
          <Home className="h-5 w-5 shrink-0 text-gold-dark" />
          <h3 className="font-heading text-heading-xl font-bold text-primary">{VALUATION_CTA.heading}</h3>
        </div>
        <p className="mb-5 text-body-sm leading-relaxed text-foreground-muted">{VALUATION_CTA.body}</p>
        <Link
          href={href}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-body-sm font-bold text-primary transition-colors hover:bg-gold-dark"
        >
          {VALUATION_CTA.action} <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
        <p className="mt-3 text-caption text-foreground-muted">{VALUATION_CTA.reassurance}</p>
      </div>
    );
  }

  return (
    <section className="bg-primary py-14 sm:py-16 text-white">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gold/15">
            <Home className="h-6 w-6 text-gold" />
          </div>
          <h2 className="font-heading text-display-sm font-bold text-white">{VALUATION_CTA.heading}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-body text-white/75">{VALUATION_CTA.body}</p>
          <Link
            href={href}
            className="mt-7 inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-7 py-3.5 text-body-sm font-bold text-primary transition-colors hover:bg-gold-dark"
          >
            {VALUATION_CTA.action} <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
          <p className="mt-4 text-caption text-white/55">{VALUATION_CTA.reassurance}</p>
        </div>
      </Container>
    </section>
  );
}
