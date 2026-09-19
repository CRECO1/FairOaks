'use client';

// The agent cards and bio modal for /team. The roster itself is fetched on the
// server (page.tsx) and passed in, so names, titles and TREC licence numbers are in
// the initial HTML; this component only adds the click-to-open profile.

import { useState } from 'react';
import Image from 'next/image';
import { Phone, Mail, Award, User, X } from 'lucide-react';
import { RevealOnScroll } from '@/hooks/useScrollReveal';

export interface TeamAgent {
  id: string; name: string; slug: string; title: string; email: string; phone: string;
  image_url: string | null; license_number: string | null; years_experience: number | null;
  featured: boolean; order: number; specialties: string[] | null; bio: string | null;
}

export function TeamRoster({ agents }: { agents: TeamAgent[] }) {
  const [selected, setSelected] = useState<TeamAgent | null>(null);

  return (
    <>
            {agents.length === 0 && (
              <p className="text-center text-body text-foreground-muted">
                Please <a href="/contact" className="text-gold underline">contact us</a> and we&apos;ll connect you with the right agent.
              </p>
            )}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {agents.map((agent, i) => (
                <RevealOnScroll key={agent.id} delay={i * 80}>
                  <button
                    onClick={() => setSelected(agent)}
                    className="card-luxury group p-6 text-center w-full text-left focus:outline-none focus:ring-2 focus:ring-gold rounded-2xl transition-all hover:-translate-y-1"
                  >
                    <div className="mx-auto mb-5 h-28 w-28 rounded-full bg-background-warm overflow-hidden">
                      {agent.image_url ? (
                        <Image src={agent.image_url as string} alt={agent.name} width={112} height={112} className="object-cover w-full h-full" />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <User className="h-12 w-12 text-foreground-subtle" />
                        </div>
                      )}
                    </div>
                    <h3 className="font-heading text-heading font-semibold text-primary">{agent.name}</h3>
                    <p className="text-body-sm text-foreground-muted mt-1">{agent.title}</p>
                    {agent.license_number && (
                      <p className="text-caption text-foreground-subtle mt-1 mb-4">TREC License #{agent.license_number}</p>
                    )}
                    {!agent.license_number && <div className="mb-4" />}
                    {agent.specialties && (
                      <div className="flex flex-wrap justify-center gap-2 mb-5">
                        {(agent.specialties as string[]).slice(0, 3).map(s => (
                          <span key={s} className="rounded-full border border-border px-3 py-1 text-caption text-foreground-muted">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="text-caption font-semibold text-gold group-hover:underline">View Profile →</span>
                  </button>
                </RevealOnScroll>
              ))}
            </div>

      {/* Bio Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setSelected(null)}
              className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-foreground-muted hover:text-primary shadow-sm transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Photo — portrait aspect ratio so full headshot shows */}
            <div className="relative w-full bg-background-warm" style={{ aspectRatio: '4/5', maxHeight: '420px' }}>
              {selected.image_url ? (
                <Image src={selected.image_url as string} alt={selected.name} fill className="object-cover object-top" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <User className="h-24 w-24 text-foreground-subtle" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto">
              <p className="text-caption font-semibold uppercase tracking-widest text-gold mb-0.5">{selected.title}</p>
              <h2 className="font-heading text-heading-xl font-bold text-primary mb-1">{selected.name}</h2>
              {selected.license_number && (
                <p className="text-caption text-foreground-subtle mb-2">
                  TREC License #{selected.license_number}
                </p>
              )}

              {selected.years_experience && (
                <div className="flex items-center gap-1.5 mb-3">
                  <Award className="h-3.5 w-3.5 text-gold" />
                  <span className="text-caption text-foreground-muted">{selected.years_experience}+ years of experience</span>
                </div>
              )}

              {selected.bio && (
                <p className="text-body-sm text-foreground-muted leading-relaxed mb-4">{selected.bio as string}</p>
              )}

              {selected.specialties && (
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {(selected.specialties as string[]).map(s => (
                    <span key={s} className="rounded-full bg-background-cream border border-border px-2.5 py-0.5 text-caption text-foreground-muted">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                {selected.phone && (
                  <a
                    href={`tel:${(selected.phone as string).replace(/\D/g, '')}`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-caption font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    <Phone className="h-3.5 w-3.5" /> {selected.phone as string}
                  </a>
                )}
                <a
                  href={`mailto:${selected.email}`}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-caption font-semibold text-primary hover:border-gold hover:text-gold transition-colors"
                >
                  <Mail className="h-3.5 w-3.5" /> Email {(selected.name as string).split(' ')[0]}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
