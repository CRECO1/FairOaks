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

export function trackPhoneClick(location: string) {
  gtag('phone_call', {
    event_category: 'Contact',
    event_label: location,
  });
}

export function trackEmailClick(location: string) {
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

export function trackQuizStart() {
  gtag('quiz_start', { event_category: 'Quiz' });
}

export function trackQuizStep(step: number, answer?: string) {
  gtag('quiz_step', {
    event_category: 'Quiz',
    step_number: step,
    answer: answer ?? '',
  });
}

export function trackQuizComplete() {
  gtag('quiz_complete', { event_category: 'Quiz' });
}

// ─── CTA Clicks ───────────────────────────────────────────────────────────────

export function trackCTA(params: {
  text: string;
  location: string;
  destination?: string;
}) {
  gtag('cta_click', {
    event_category: 'CTA',
    event_label: params.text,
    cta_location: params.location,
    destination: params.destination ?? '',
  });
}

// ─── Blog / Content ───────────────────────────────────────────────────────────

export function trackBlogView(params: {
  title: string;
  category: string;
  slug: string;
}) {
  gtag('view_article', {
    event_category: 'Blog',
    item_name: params.title,
    item_category: params.category,
    item_id: params.slug,
  });
}

export function trackBlogSelect(params: {
  title: string;
  category: string;
  slug: string;
}) {
  gtag('select_content', {
    event_category: 'Blog',
    content_type: 'article',
    item_id: params.slug,
    content_id: params.title,
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export function trackExternalLink(url: string, label: string) {
  gtag('external_link', {
    event_category: 'Navigation',
    event_label: label,
    outbound_url: url,
  });
}
