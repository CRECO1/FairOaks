'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Phone, Calendar, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const navLinks = [
  { href: '/listings', label: 'Listings' },
  { href: '/sold', label: 'Sold' },
  { href: '/neighborhoods', label: 'Neighborhoods' },
  { href: '/team', label: 'Team' },
  { href: '/sell', label: 'Sell' },
  { href: '/quiz', label: 'Find My Home', isHighlight: true },
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
          <Link href="/" className="flex items-center">
            <span
              className={cn(
                'font-heading text-lg sm:text-2xl font-bold tracking-tight',
                isTransparent ? 'text-white' : 'text-primary'
              )}
              style={textShadowStyle}
            >
              Fair Oaks <span className="text-gold">Realty Group</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          {variant !== 'minimal' && (
            <div className="hidden items-center gap-6 lg:flex">
              {navLinks.map((link) => (
                'isHighlight' in link && link.isHighlight ? (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 rounded-full text-body-sm font-semibold transition-all',
                      isTransparent
                        ? 'bg-gold text-primary hover:bg-gold-light'
                        : 'bg-gold/10 text-gold-dark hover:bg-gold hover:text-primary',
                      pathname === link.href && 'bg-gold text-primary'
                    )}
                  >
                    <Sparkles className="h-4 w-4" />
                    {link.label}
                  </Link>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'relative text-body-sm font-medium transition-colors',
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
                )
              ))}
            </div>
          )}

          {/* CTA Buttons */}
          <div className="flex items-center gap-3">
            {/* Phone - Always Visible */}
            <a
              href={`tel:${phone.replace(/\D/g, '')}`}
              className={cn(
                'flex items-center gap-2 font-semibold transition-colors',
                isTransparent ? 'text-white' : 'text-primary',
                'hover:text-gold'
              )}
              style={textShadowStyle}
            >
              <Phone className="h-5 w-5" />
              <span className="hidden sm:inline">{phone}</span>
            </a>

            {/* Schedule Button - Desktop */}
            <Button
              variant="primary"
              size="sm"
              className="hidden sm:inline-flex"
              asChild
            >
              <Link href="/contact#schedule">
                <Calendar className="mr-2 h-4 w-4" />
                Schedule
              </Link>
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
              {navLinks.filter(link => !('isHighlight' in link && link.isHighlight)).map((link) => (
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
                  <Link href="/quiz" onClick={() => setIsMenuOpen(false)}>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Find My Perfect Home
                  </Link>
                </Button>
                <Button variant="primary" size="lg" fullWidth asChild>
                  <a href={`tel:${phone.replace(/\D/g, '')}`}>
                    <Phone className="mr-2 h-5 w-5" />
                    Call Now: {phone}
                  </a>
                </Button>
                <Button variant="outline" size="lg" fullWidth asChild>
                  <Link href="/contact#schedule">
                    <Calendar className="mr-2 h-5 w-5" />
                    Schedule a Consultation
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
