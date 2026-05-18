'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Phone, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { trackPhoneClick, trackCTA } from '@/lib/analytics';

const navLinks = [
  { href: '/listings', label: 'Listings' },
  { href: '/neighborhoods', label: 'Neighborhoods' },
  { href: '/blog', label: 'Blog' },
  { href: '/services', label: 'Services' },
  { href: '/team', label: 'Team' },
  { href: '/sell', label: 'Sell' },
];

interface HeaderProps {
  variant?: 'default' | 'minimal' | 'transparent';
  phone?: string;
}

export function Header({ variant = 'default', phone = '(210) 390-9997' }: HeaderProps) {
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
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'relative whitespace-nowrap text-body-sm font-medium transition-colors',
                    isTransparent
                      ? 'text-white hover:text-gold-light'
                      : 'text-primary hover:text-gold',
                    pathname === link.href && 'text-gold'
                  )}
                  style={textShadowStyle}
                >
                  {link.label}
                  {pathname === link.href && (
                    <span className="absolute -bottom-1 left-0 h-0.5 w-full bg-gold" />
                  )}
                </Link>
              ))}
            </div>
          )}

          {/* CTA Buttons */}
          <div className="flex items-center gap-2">
            {/* Phone - Desktop only */}
            <a
              href={`tel:${phone.replace(/\D/g, '')}`}
              onClick={() => trackPhoneClick('header')}
              className={cn(
                'hidden lg:flex items-center gap-1.5 text-body-sm font-semibold transition-colors',
                isTransparent ? 'text-white' : 'text-primary',
                'hover:text-gold'
              )}
              style={textShadowStyle}
            >
              <Phone className="h-4 w-4" />
              <span>{phone}</span>
            </a>

            {/* Phone icon only — mobile/tablet */}
            <a
              href={`tel:${phone.replace(/\D/g, '')}`}
              onClick={() => trackPhoneClick('header')}
              className={cn(
                'lg:hidden p-2 transition-colors',
                isTransparent ? 'text-white' : 'text-primary',
                'hover:text-gold'
              )}
              aria-label="Call us"
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

            {/* Contact Button — desktop */}
            <Button
              variant="primary"
              size="sm"
              className="hidden sm:inline-flex"
              asChild
            >
              <Link href="/contact" onClick={() => trackCTA({ text: 'Contact Us', location: 'header', destination: '/contact' })}>Contact Us</Link>
            </Button>

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
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={cn(
                    'border-b border-border py-4 text-heading font-medium text-primary transition-colors',
                    'hover:text-gold',
                    pathname === link.href && 'text-gold'
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/contact"
                onClick={() => setIsMenuOpen(false)}
                className="border-b border-border py-4 text-heading font-medium text-primary transition-colors hover:text-gold"
              >
                Contact
              </Link>

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
                <Button variant="primary" size="lg" fullWidth asChild>
                  <a href={`tel:${phone.replace(/\D/g, '')}`} onClick={() => trackPhoneClick('header')}>
                    <Phone className="mr-2 h-5 w-5" />
                    Call Now: {phone}
                  </a>
                </Button>
                <Button variant="outline" size="lg" fullWidth asChild>
                  <Link href="/contact" onClick={() => trackCTA({ text: 'Contact Us', location: 'header', destination: '/contact' })}>
                    Contact Us
                  </Link>
                </Button>
              </div>
            </nav>
          </Container>
        </div>
      )}
    </header>
  );
}
