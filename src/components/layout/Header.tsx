'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Sparkles, Phone, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { trackCTA, trackPhoneClick } from '@/lib/analytics';

/**
 * The header carries the phone number on every page, at every width.
 *
 * It did not before: the only call affordance sitewide was StickyCTA, which
 * stays hidden until the visitor has scrolled 400px. Anyone landing on a page
 * and wanting to ring the office had to open the menu, go to Contact and find
 * the number there — three taps for the single highest-intent action on a
 * real-estate site. Now it is one, from the top of any page.
 */
const PHONE_DISPLAY = '210-390-9997';
const PHONE_E164 = '+12103909997';

const navLinks = [
  { href: '/listings', label: 'Listings' },
  { href: '/neighborhoods', label: 'Neighborhoods' },
  { href: '/market-reports', label: 'Market Reports' },
  { href: '/services', label: 'Services' },
  { href: 'https://www.crecotx.com', label: 'Commercial', external: true },
  { href: '/team', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

interface HeaderProps {
  variant?: 'default' | 'minimal' | 'transparent';
}

export function Header({ variant = 'default' }: HeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [isScrolled, setIsScrolled] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  React.useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isMenuOpen]);

  const isTransparent = variant === 'transparent' && !isScrolled;

  // Text shadow style for transparent header to ensure readability
  const textShadowStyle = isTransparent ? { textShadow: '0 2px 4px rgba(0,0,0,0.5)' } : {};

  return (
    <header
      className={cn(
        'fixed left-0 right-0 top-0 z-50 transition-all duration-300',
        isTransparent
          ? 'bg-gradient-to-b from-black/40 to-transparent'
          : 'bg-white shadow-sm',
        variant === 'minimal' && 'bg-white shadow-sm'
      )}
    >
      <Container>
        <nav className="flex h-20 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0">
            <div
              className={cn(
                'font-heading font-bold tracking-tight leading-tight flex flex-col',
                isTransparent ? 'text-white' : 'text-primary'
              )}
              style={textShadowStyle}
            >
              <span className="text-xl sm:text-2xl">Fair Oaks</span>
              <span className="text-xl sm:text-2xl text-gold">Realty Group</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          {variant !== 'minimal' && (
            <div className="hidden items-center gap-5 lg:flex ml-8">
              {navLinks.map((link) => {
                const cls = cn(
                  'relative whitespace-nowrap text-body-sm font-semibold transition-colors',
                  isTransparent
                    ? 'text-white hover:text-gold-light'
                    : 'text-primary hover:text-gold',
                  pathname === link.href && 'text-gold'
                );
                if (link.external) {
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cls}
                      style={textShadowStyle}
                    >
                      {link.label}
                    </a>
                  );
                }
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cls}
                    style={textShadowStyle}
                  >
                    {link.label}
                    {pathname === link.href && (
                      <span className="absolute -bottom-1 left-0 h-0.5 w-full bg-gold" />
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {/* CTA Buttons */}
          <div className="flex items-center gap-2">
            {/* Call — desktop. Shown on every variant, minimal included: a
                stripped-down header is still a page someone might call from. */}
            <a
              href={`tel:${PHONE_E164}`}
              onClick={() => trackPhoneClick('header')}
              className={cn(
                'hidden lg:inline-flex items-center gap-1.5 whitespace-nowrap text-body-sm font-semibold transition-colors',
                isTransparent ? 'text-white hover:text-gold-light' : 'text-primary hover:text-gold'
              )}
              style={textShadowStyle}
            >
              <Phone className="h-4 w-4" />
              {PHONE_DISPLAY}
            </a>

            {/* Call — mobile and tablet. Sits left of the menu toggle as a
                44px tap target so the number is always one thumb away. */}
            <a
              href={`tel:${PHONE_E164}`}
              onClick={() => trackPhoneClick('header_mobile')}
              aria-label={`Call Fair Oaks Realty Group at ${PHONE_DISPLAY}`}
              className={cn(
                'inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors lg:hidden',
                isTransparent
                  ? 'text-white hover:bg-white/15'
                  : 'bg-gold/10 text-gold-dark hover:bg-gold hover:text-primary'
              )}
            >
              <Phone className="h-5 w-5" />
            </a>

            {/* Find My Home pill — desktop */}
            {variant !== 'minimal' && (
              <Link
                href="/quiz"
                onClick={() => trackCTA({ text: 'Find My Home', location: 'header', destination: '/quiz' })}
                className={cn(
                  'hidden lg:inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap',
                  isTransparent
                    ? 'bg-gold text-primary hover:bg-gold/90'
                    : 'bg-gold/10 text-gold-dark hover:bg-gold hover:text-primary border border-gold/30',
                  pathname === '/quiz' && 'bg-gold text-primary'
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Find My Home
              </Link>
            )}


            {/* Mobile Menu Toggle */}
            {variant !== 'minimal' && (
              <button
                className={cn(
                  'ml-2 p-2 lg:hidden',
                  isTransparent ? 'text-white' : 'text-primary'
                )}
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
              >
                {isMenuOpen ? (
                  <X className="h-6 w-6" />
                ) : (
                  <Menu className="h-6 w-6" />
                )}
              </button>
            )}
          </div>
        </nav>
      </Container>

      {/* Mobile Menu */}
      {isMenuOpen && variant !== 'minimal' && (
        <div className="fixed inset-0 top-20 z-40 bg-white lg:hidden">
          <Container>
            <nav className="flex flex-col py-8">
              {navLinks.map((link) => {
                const cls = cn(
                  'border-b border-border py-4 text-heading font-medium text-primary transition-colors',
                  'hover:text-gold',
                  pathname === link.href && 'text-gold'
                );
                if (link.external) {
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsMenuOpen(false)}
                      className={cls}
                    >
                      {link.label}
                    </a>
                  );
                }
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={cls}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <div className="mt-8 space-y-4">
                {/* Quiz CTA - Highlighted */}
                <Button
                  size="lg"
                  fullWidth
                  className="bg-gold hover:bg-gold-dark text-primary font-semibold"
                  asChild
                >
                  <Link href="/quiz" onClick={() => { setIsMenuOpen(false); trackCTA({ text: 'Find My Home', location: 'header', destination: '/quiz' }); }}>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Find My Perfect Home
                  </Link>
                </Button>

                {/* Call and text, side by side. Someone who opened the menu
                    looking for a way to reach us should not have to go to
                    /contact to find the number. */}
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href={`tel:${PHONE_E164}`}
                    onClick={() => { setIsMenuOpen(false); trackPhoneClick('mobile_menu'); }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3.5 text-body-sm font-semibold text-white"
                  >
                    <Phone className="h-4 w-4" />
                    Call
                  </a>
                  <a
                    href={`sms:${PHONE_E164}`}
                    onClick={() => setIsMenuOpen(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3.5 text-body-sm font-semibold text-primary"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Text
                  </a>
                </div>
                <p className="text-center text-caption text-foreground-muted">{PHONE_DISPLAY}</p>
              </div>
            </nav>
          </Container>
        </div>
      )}
    </header>
  );
}
