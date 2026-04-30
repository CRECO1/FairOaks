'use client';

import { useState } from 'react';
import { Phone, Mail, MapPin, Clock, CheckCircle, Calendar } from 'lucide-react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

const CONTACT_REASONS = [
  'Schedule a Showing',
  'Home Valuation',
  'Buyer Consultation',
  'Seller Consultation',
  'General Question',
  'Investment Inquiry',
  'Relocation Help',
];

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const data = new FormData(e.currentTarget);
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.get('name'),
        email: data.get('email'),
        phone: data.get('phone'),
        message: `Reason: ${data.get('reason')}\n\n${data.get('message')}`,
        source: 'contact',
      }),
    }).catch(() => {});
    setLoading(false);
    setSubmitted(true);
  }

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20">
        {/* Hero */}
        <div className="bg-primary py-14 text-white">
          <Container>
            <p className="overline mb-2 text-gold">We&apos;re Here to Help</p>
            <h1 className="font-heading text-display-sm font-bold">Contact Us</h1>
            <p className="mt-2 text-body text-white/60 max-w-lg">
              Whether you&apos;re buying, selling, or just have a question — we&apos;d love to hear from you.
            </p>
          </Container>
        </div>

        {/* Main Content */}
        <section className="section-luxury bg-background-cream">
          <Container>
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">

              {/* Info Column */}
              <div className="space-y-8">
                <div>
                  <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary gold-line pb-3">
                    Get in Touch
                  </h2>
                </div>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20">
                      <Phone className="h-5 w-5 text-gold-dark" />
                    </div>
                    <div>
                      <p className="font-semibold text-primary">Phone</p>
                      <a href="tel:+12103909997" className="text-body-sm text-foreground-muted hover:text-gold transition-colors">
                        (210) 390-9997
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20">
                      <Mail className="h-5 w-5 text-gold-dark" />
                    </div>
                    <div>
                      <p className="font-semibold text-primary">Email</p>
                      <a href="mailto:info@fairoaksrealtygroup.com" className="text-body-sm text-foreground-muted hover:text-gold transition-colors">
                        info@fairoaksrealtygroup.com
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20">
                      <MapPin className="h-5 w-5 text-gold-dark" />
                    </div>
                    <div>
                      <p className="font-semibold text-primary">Office</p>
                      <p className="text-body-sm text-foreground-muted">
                        7510 FM 1560 N, Ste 101<br />
                        Fair Oaks Ranch, TX 78015
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20">
                      <Clock className="h-5 w-5 text-gold-dark" />
                    </div>
                    <div>
                      <p className="font-semibold text-primary">Hours</p>
                      <p className="text-body-sm text-foreground-muted">
                        Mon–Fri: 9am – 6pm<br />
                        Sat: 10am – 4pm<br />
                        Sun: By Appointment
                      </p>
                    </div>
                  </div>
                </div>

                {/* Schedule CTA */}
                <div id="schedule" className="rounded-xl bg-gold p-6">
                  <Calendar className="mb-3 h-6 w-6 text-primary/70" />
                  <h3 className="mb-2 font-heading text-heading-sm font-bold text-primary">Schedule a Consultation</h3>
                  <p className="mb-4 text-body-sm text-primary/70">
                    Prefer to pick a time? Use the form to request your preferred date and time.
                  </p>
                  <Button variant="secondary" size="sm" asChild>
                    <a href="tel:+12103909997">Call to Schedule</a>
                  </Button>
                </div>
              </div>

              {/* Form */}
              <div className="lg:col-span-2">
                <div className="rounded-2xl bg-white p-8 shadow-card lg:p-10">
                  {submitted ? (
                    <div className="py-12 text-center">
                      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gold/20">
                        <CheckCircle className="h-8 w-8 text-gold-dark" />
                      </div>
                      <h2 className="mb-2 font-heading text-heading-xl font-bold text-primary">Message Sent!</h2>
                      <p className="text-body text-foreground-muted max-w-md mx-auto">
                        Thank you for reaching out. A member of our team will contact you within 1 business day.
                      </p>
                    </div>
                  ) : (
                    <>
                      <h2 className="mb-6 font-heading text-heading-xl font-bold text-primary">Send Us a Message</h2>
                      <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                          <div>
                            <label className="label-readable">Full Name *</label>
                            <input name="name" required placeholder="Jane Smith" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                          </div>
                          <div>
                            <label className="label-readable">Phone</label>
                            <input name="phone" type="tel" placeholder="(210) 555-0000" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                          </div>
                        </div>
                        <div>
                          <label className="label-readable">Email Address *</label>
                          <input name="email" type="email" required placeholder="you@example.com" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                        </div>
                        <div>
                          <label className="label-readable">How can we help?</label>
                          <select name="reason" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold">
                            <option value="">Select a reason…</option>
                            {CONTACT_REASONS.map(r => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label-readable">Message</label>
                          <textarea name="message" rows={5} placeholder="Tell us more about what you're looking for…" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold resize-none" />
                        </div>
                        <p className="text-caption text-foreground-muted">
                          By submitting, you agree to be contacted by Fair Oaks Realty Group regarding your inquiry.
                        </p>
                        <Button type="submit" size="lg" fullWidth loading={loading}>
                          Send Message
                        </Button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
