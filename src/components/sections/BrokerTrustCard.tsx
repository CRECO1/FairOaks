'use client';

// A compact "who you're writing to" card beside lead forms: the broker's headshot,
// name, title and individual TREC licence, with call and text buttons. Identity comes
// from BROKER_CARD (site-identity), the same facts the /team roster publishes.

import Image from 'next/image';
import { Phone, MessageSquare } from 'lucide-react';
import { BROKER_CARD, FORG } from '@/lib/site-identity';
import { trackPhoneClick } from '@/lib/analytics';

export function BrokerTrustCard({ surface, className = '' }: { surface: string; className?: string }) {
  return (
    <div className={`flex items-center gap-4 rounded-xl border border-border bg-white p-4 ${className}`}>
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-background-warm">
        <Image src={BROKER_CARD.photo} alt={BROKER_CARD.name} fill sizes="56px" className="object-cover object-top" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-body font-semibold text-primary leading-tight">{BROKER_CARD.name}</p>
        <p className="text-caption text-foreground-muted">
          {BROKER_CARD.jobTitle} · TREC #{BROKER_CARD.trecLicense}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={`tel:${FORG.telephone}`}
            onClick={() => trackPhoneClick(`${surface}_trust_card`)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-caption font-semibold text-primary transition-colors hover:border-gold hover:text-gold-dark"
          >
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
          <a
            href={`sms:${FORG.telephone}`}
            onClick={() => trackPhoneClick(`${surface}_trust_card_text`)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-caption font-semibold text-primary transition-colors hover:border-gold hover:text-gold-dark"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Text
          </a>
          <span className="self-center text-caption text-foreground-muted">{FORG.phoneDisplay}</span>
        </div>
      </div>
    </div>
  );
}
