// ── Centralized brand configuration ────────────────────────────────────────────
// Single source of truth for all brand-specific strings across the CRM.
// Safe to import from both client components and server/API routes:
// pure data + functions, no client-only imports, no runtime side effects.

export type BusinessUnit = 'residential' | 'commercial';

export interface Brand {
  /** Full display name */
  name: string;
  /** Short label (sidebar, switcher) */
  shortName: string;
  /** Legal / signature name used for {{brokerage}} */
  legalName: string;
  /** Workspace tagline */
  tagline: string;
  /** From-line display name for outbound email */
  fromName: string;
  /** From-line email address for outbound email */
  fromEmail: string;
  /** Default contact phone */
  phone: string;
  /** Office mailing address */
  address: string;
  /** Public website */
  website: string;
  /** Base URL used to build unsubscribe links */
  unsubscribeBaseUrl: string;
  /** Name of the env var holding the Resend API key for this unit */
  resendKeyEnv: string;
}

export const BRANDING: Record<BusinessUnit, Brand> = {
  residential: {
    name: 'Fair Oaks Realty Group',
    shortName: 'Fair Oaks',
    legalName: 'Fair Oaks Realty Group',
    tagline: 'Residential CRM',
    fromName: 'Fair Oaks Realty Group',
    fromEmail: 'info@fairoaksrealtygroup.com',
    phone: '210-390-9997',
    address: '8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015',
    website: 'https://www.fairoaksrealtygroup.com',
    unsubscribeBaseUrl: 'https://www.fairoaksrealtygroup.com',
    resendKeyEnv: 'RESEND_API_KEY',
  },
  commercial: {
    name: 'CRECO',
    shortName: 'CRECO',
    legalName: 'CRECO',
    tagline: 'Commercial CRM',
    fromName: 'CRECO',
    fromEmail: 'info@crecotx.com',
    phone: '210-817-3443',
    address: '8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015',
    website: 'https://www.crecotx.com',
    unsubscribeBaseUrl: 'https://www.crecotx.com',
    resendKeyEnv: 'RESEND_API_KEY_COMMERCIAL',
  },
};

/** Normalize an unknown/optional unit string to a valid BusinessUnit (defaults to residential). */
export function normalizeUnit(unit?: string | null): BusinessUnit {
  return unit === 'commercial' ? 'commercial' : 'residential';
}

/** Return the Brand config for a given business unit. */
export function getBrand(unit?: string | null): Brand {
  return BRANDING[normalizeUnit(unit)];
}

/** Build the email From header, e.g. "Fair Oaks Realty Group <info@fairoaksrealtygroup.com>". */
export function fromLine(unit?: string | null): string {
  const b = getBrand(unit);
  return `${b.fromName} <${b.fromEmail}>`;
}
