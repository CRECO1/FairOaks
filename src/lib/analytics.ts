/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fair Oaks Realty Group — GA4 Analytics
 * Central event tracking utility. Safe to call from any client component.
 * All functions are no-ops if gtag is not loaded (e.g. on /crm, /manage).
 */

declare global {
  interface Window {
    gtag: (...args: any[]) => void;
    dataLayer: any[];
  }
}

const GA4_ID = 'G-SYPXDGGWQS';

function gtag(event: string, params?: Record<string, any>) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag === 'function') {
    window.gtag('event', event, { ...(params ?? {}), send_to: GA4_ID });
  } else {
    // Fallback: push to dataLayer for GTM to forward to GA4
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...params });
  }

  // Mirror the event NAME into Clarity, matching what attribution.ts#trackEvent
  // already does. Without this, half the site's events could be used to filter
  // session replays and half could not, purely depending on which helper a
  // component happened to call — which is the kind of inconsistency nobody
  // discovers until they are staring at an empty Clarity segment. Clarity takes
  // a bare string, so the parameters stay in GA. Its own try/catch: a Clarity
  // failure must not swallow a GA event that already succeeded.
  try {
    const c = (window as unknown as { clarity?: (cmd: string, ...a: unknown[]) => void }).clarity;
    if (typeof c === 'function') c('event', event);
  } catch {
    // Analytics must never break the page.
  }
}

// ─── Lead Generation ──────────────────────────────────────────────────────────

export function trackLead(params: {
  form_type: 'contact' | 'valuation' | 'listing_inquiry' | 'quiz' | 'agent_apply' | 'showing_request';
  page_location?: string;
  value?: number;
}) {
  gtag('generate_lead', {
    event_category: 'Lead',
    form_type: params.form_type,
    page_location: params.page_location ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
    value: params.value ?? 1,
    currency: 'USD',
  });
}

// ─── Contact Interactions ────────────────────────────────────────────────────

/**
 * Set whenever a component reports a contact click itself. ContactLinkTracker
 * watches this so the ~11 links with their own onClick handler are not counted
 * twice — it covers the other ~80 that have none.
 */
let lastManualContactClick = 0;
export function contactClickWasManual(withinMs = 400): boolean {
  return Date.now() - lastManualContactClick < withinMs;
}

export function trackPhoneClick(location: string) {
  lastManualContactClick = Date.now();
  gtag('phone_call', {
    event_category: 'Contact',
    event_label: location,
  });
}

export function trackEmailClick(location: string) {
  lastManualContactClick = Date.now();
  gtag('email_click', {
    event_category: 'Contact',
    event_label: location,
  });
}

// ─── Listing Events ───────────────────────────────────────────────────────────

export function trackViewItem(params: {
  id: string;
  name: string;
  price?: number;
  city?: string;
  beds?: number;
  baths?: number;
  property_type?: string;
}) {
  gtag('view_item', {
    event_category: 'Listing',
    currency: 'USD',
    value: params.price ?? 0,
    items: [{
      item_id: params.id,
      item_name: params.name,
      price: params.price ?? 0,
      item_category: params.city ?? '',
      item_category2: params.property_type ?? '',
      item_variant: params.beds ? `${params.beds}bd/${params.baths}ba` : '',
    }],
  });
}

export function trackSelectItem(params: {
  id: string;
  name: string;
  price?: number;
  list_name?: string;
  index?: number;
}) {
  gtag('select_item', {
    event_category: 'Listing',
    item_list_name: params.list_name ?? 'Listings',
    items: [{
      item_id: params.id,
      item_name: params.name,
      price: params.price ?? 0,
      index: params.index ?? 0,
    }],
  });
}

export function trackViewItemList(params: {
  list_name: string;
  city?: string;
  price_min?: number;
  price_max?: number;
  beds?: string;
  results_count?: number;
}) {
  gtag('view_item_list', {
    event_category: 'Listing',
    item_list_name: params.list_name,
    city: params.city ?? '',
    price_min: params.price_min ?? 0,
    price_max: params.price_max ?? 0,
    beds: params.beds ?? '',
    results_count: params.results_count ?? 0,
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function trackSearch(params: {
  term?: string;
  city?: string;
  price_min?: number;
  price_max?: number;
  beds?: string;
}) {
  gtag('search', {
    event_category: 'Search',
    search_term: params.term ?? '',
    city: params.city ?? '',
    price_min: params.price_min ?? 0,
    price_max: params.price_max ?? 0,
    beds: params.beds ?? '',
  });
}

// ─── Quiz ─────────────────────────────────────────────────────────────────────

export function trackQuizStart(totalSteps?: number) {
  gtag('quiz_start', {
    event_category: 'Quiz',
    // Lets the funnel be read as "reached step N of M" without the total being
    // hardcoded in a GA report that then rots when the quiz changes length.
    total_steps: totalSteps ?? 0,
  });
}

export function trackQuizStep(step: number, answer?: string, stepId?: string) {
  gtag('quiz_step', {
    event_category: 'Quiz',
    step_number: step,
    // A fixed option slug ('first-time', 'upsize'), never free text — the quiz
    // only takes free input on its final contact step, which is not tracked.
    answer: answer ?? '',
    // The index alone says people leave at "step 3"; the id says which question
    // that was, and survives the quiz being re-ordered.
    step_id: stepId ?? '',
  });
}

export function trackQuizComplete() {
  gtag('quiz_complete', { event_category: 'Quiz' });
}

// ─── CTA Clicks ───────────────────────────────────────────────────────────────

/**
 * Set whenever a component reports a CTA click itself, so CtaClickTracker can
 * stand down rather than counting the same click twice.
 */
let lastManualCta = 0;
export function ctaClickWasManual(withinMs = 400): boolean {
  return Date.now() - lastManualCta < withinMs;
}

export function trackCTA(params: {
  text: string;
  location: string;
  destination?: string;
}) {
  lastManualCta = Date.now();
  gtag('cta_click', {
    event_category: 'CTA',
    event_label: params.text,
    cta_location: params.location,
    destination: params.destination ?? '',
    // Which page the CTA was clicked FROM — without it every CTA of the same
    // name across the site collapses into one undifferentiated row.
    page_path: typeof window !== 'undefined' ? window.location.pathname : '',
  });
}
