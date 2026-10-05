/**
 * What a /contact link says about why the visitor is writing.
 *
 * Pages across the site link to /contact with a context param — ?area=TheDominion
 * (neighborhood and area pages), ?service=military, ?district=boerne-isd,
 * ?topic=schools. The contact page uses this to preselect the reason, start the
 * message, and pass the context into the lead (property_interest), so the agent
 * sees where the inquiry came from without asking.
 *
 * Only known values are honoured; an ?area= is cleaned to plain words, so nothing
 * from the URL reaches the form or the lead unfiltered.
 */
import { DISTRICTS } from '@/lib/listing-filters';

export const CONTACT_REASONS = [
  'Schedule a Showing',
  'Help Me Search for Homes',
  'Home Valuation',
  'Buyer Consultation',
  'Seller Consultation',
  'Relocation Help',
  'Military / VA Homebuying',
  'Investment Properties',
  'School District Questions',
] as const;

export type ContactReason = (typeof CONTACT_REASONS)[number];

export interface ContactContext {
  reason: ContactReason;
  /** Starts the message box; the visitor can edit or replace it. */
  message: string;
  /** One line stored on the lead, e.g. "Area: The Dominion". */
  interest: string;
}

const SERVICES: Record<string, { reason: ContactReason; message: string }> = {
  military:   { reason: 'Military / VA Homebuying', message: "I'm relocating with the military and would like help buying a home (VA loan questions welcome)." },
  relocation: { reason: 'Relocation Help',          message: "I'm relocating to the area and would like help finding a home." },
  investment: { reason: 'Investment Properties',    message: "I'm interested in investment properties in the area." },
};

const TOPICS: Record<string, { reason: ContactReason; message: string; interest: string }> = {
  schools:       { reason: 'School District Questions', message: "I have questions about school districts and homes zoned for them.", interest: 'Topic: schools' },
  'home-search': { reason: 'Help Me Search for Homes',  message: "I'd like an agent to search the MLS for me.",                    interest: 'Topic: home search' },
};

/** "TheDominion" / "Fair+Oaks+Ranch" / "Spring Branch" → "The Dominion" / "Fair Oaks Ranch" / "Spring Branch". */
function areaName(raw: string): string | null {
  const words = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9 '&.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words && words.length <= 60 ? words : null;
}

export function contactContextFromUrl(search: string): ContactContext | null {
  const q = new URLSearchParams(search);

  const district = DISTRICTS[q.get('district') ?? ''];
  if (district) {
    return {
      reason: 'School District Questions',
      message: `I'm looking for homes zoned for ${district.label}.`,
      interest: `School district: ${district.label}`,
    };
  }

  const service = SERVICES[q.get('service') ?? ''];
  if (service) return { ...service, interest: `Service: ${service.reason}` };

  const topic = TOPICS[q.get('topic') ?? ''];
  if (topic) return topic;

  const area = areaName(q.get('area') ?? '');
  if (area) {
    return {
      reason: 'Buyer Consultation',
      message: `I'm interested in homes in ${area}.`,
      interest: `Area: ${area}`,
    };
  }

  return null;
}
