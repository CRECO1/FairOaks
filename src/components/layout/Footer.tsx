'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Phone, Mail, MapPin, Facebook, Instagram, Youtube } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { supabase } from '@/lib/supabase';

const footerLinks = {
  listings: [
    { href: '/listings?status=active', label: 'Homes for Sale' },
    { href: '/listings?type=new-construction', label: 'New Construction' },
    { href: '/listings?price=luxury', label: 'Luxury Homes' },
    { href: '/sold', label: 'Recently Sold' },
  ],
  areas: [
    { href: '/neighborhoods/fair-oaks-ranch', label: 'Fair Oaks Ranch' },
    { href: '/neighborhoods/boerne', label: 'Boerne' },
    { href: '/neighborhoods/helotes', label: 'Helotes' },
    { href: '/neighborhoods/leon-springs', label: 'Leon Springs' },
  ],
};

const DEFAULTS = {
  phone: '(210) 390-9997',
  email: 'info@fairoaksrealtygroup.com',
  address: '8000 Fair Oaks Pkwy Suite 102\nFair Oaks Ranch, TX 78015',
};

export function Footer() {
  const [contact, setContact] = useState(DEFAULTS);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    supabase
      .from('site_settings')
      .select('phone, email, address')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) setContact({
          phone: data.phone ?? DEFAULTS.phone,
          email: data.email ?? DEFAULTS.email,
          address: data.address ?? DEFAULTS.address,
        });
      });
  }, []);

  const telHref = `tel:+1${contact.phone.replace(/\D/g, '')}`;
  const addressLines = contact.address.split('\n');

  return (
    <footer className="bg-primary text-white">
      {/* Main Footer */}
      <div className="py-16 md:py-20">
        <Container>
          <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-4">
            {/* Brand Column */}
            <div className="lg:col-span-1">
              <Link href="/" className="inline-block mb-6">
                <span className="font-heading text-2xl font-bold tracking-tight">
                  Fair Oaks <span className="text-gold">Realty Group</span>
                </span>
              </Link>
              <p className="text-foreground-light text-body-sm leading-relaxed mb-6 max-w-xs">
                Trusted local experts helping families find their perfect home in the Texas Hill Country since 2004.
              </p>
              <div className="flex gap-4">
                <a href="https://facebook.com/fairoaksrealtygroup" target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors hover:border-gold hover:text-gold">
                  <Facebook className="h-4 w-4" />
                </a>
                <a href="https://instagram.com/fairoaksrealtygroup" target="_blank" rel="noopener noreferrer" aria-label="Instagram"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors hover:border-gold hover:text-gold">
                  <Instagram className="h-4 w-4" />
                </a>
                <a href="https://www.youtube.com/@FairOaksRealtyGroupTX" target="_blank" rel="noopener noreferrer" aria-label="YouTube"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors hover:border-gold hover:text-gold">
                  <Youtube className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* Listings Links */}
            <div>
              <h3 className="mb-5 text-body-sm font-semibold uppercase tracking-widest text-gold">Listings</h3>
              <ul className="space-y-3">
                {footerLinks.listings.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-body-sm text-white/60 transition-colors hover:text-gold">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Areas Links */}
            <div>
              <h3 className="mb-5 text-body-sm font-semibold uppercase tracking-widest text-gold">Areas We Serve</h3>
              <ul className="space-y-3">
                {footerLinks.areas.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-body-sm text-white/60 transition-colors hover:text-gold">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact Info */}
            <div>
              <h3 className="mb-5 text-body-sm font-semibold uppercase tracking-widest text-gold">Get in Touch</h3>
              <ul className="space-y-4">
                <li>
                  <a href={telHref}
                    className="flex items-start gap-3 text-body-sm text-white/60 transition-colors hover:text-gold">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                    {contact.phone}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${contact.email}`}
                    className="flex items-start gap-3 text-body-sm text-white/60 transition-colors hover:text-gold">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                    {contact.email}
                  </a>
                </li>
                <li>
                  <div className="flex items-start gap-3 text-body-sm text-white/60">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                    <span>
                      {addressLines.map((line, i) => (
                        <span key={i}>{line}{i < addressLines.length - 1 && <br />}</span>
                      ))}
                    </span>
                  </div>
                </li>
              </ul>
              <div className="mt-6 flex flex-col gap-3">
                <Link href="/contact#schedule"
                  className="inline-flex items-center gap-2 rounded-lg border border-gold/50 px-5 py-2.5 text-body-sm font-semibold text-gold transition-all hover:bg-gold hover:text-primary">
                  Schedule a Consultation
                </Link>
                <a href="/crm" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-body-sm font-semibold text-white/50 transition-all hover:border-white/40 hover:text-white/80">
                  Agent Login
                </a>
              </div>
            </div>
          </div>
        </Container>
      </div>

      {/* Disclosure Notices */}
      <div className="border-t border-white/10 py-5 bg-primary/80">
        <Container>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <span className="text-caption font-semibold uppercase tracking-widest text-white/40">Disclosure Notices:</span>
            <a
              href="https://www.dropbox.com/scl/fi/f2mtiupgx22xhzx81vnwn/IABSCRECOTX.pdf?rlkey=7fs8jtl92j3pq97he11blehwm&e=1&dl=0"
              target="_blank" rel="noopener noreferrer"
              className="text-caption text-gold/70 transition-colors hover:text-gold">
              TREC Information About Brokerage Services
            </a>
            <a
              href="https://www.dropbox.com/scl/fi/2n75lzyn066n3rj46h9ot/CN-1-5_0.pdf?rlkey=4qbweqe2x7y5scl8zhn4ut211&e=1&dl=0"
              target="_blank" rel="noopener noreferrer"
              className="text-caption text-gold/70 transition-colors hover:text-gold">
              Consumer Protection Notice
            </a>
            <a
              href="https://www.dropbox.com/scl/fi/crqxkops3pxzk6oi9k8og/Privacy-Policy.pdf?rlkey=4rprpu2t86y4xf83iatceszez&e=1&st=1ctnq1ov&dl=0"
              target="_blank" rel="noopener noreferrer"
              className="text-caption text-gold/70 transition-colors hover:text-gold">
              Privacy Policy
            </a>
          </div>
        </Container>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/10 py-6">
        <Container>
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-caption text-white/40">
              © {currentYear} Fair Oaks Realty Group. All rights reserved.
            </p>
            <div className="flex flex-wrap items-center gap-6">
              <Link href="/terms" className="text-caption text-white/40 transition-colors hover:text-white/70">
                Terms of Service
              </Link>
              <span className="text-caption text-white/40">TREC License #9014367</span>
            </div>
          </div>
        </Container>
      </div>
    </footer>
  );
}
