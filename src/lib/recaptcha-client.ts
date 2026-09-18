'use client';

/**
 * Browser half of the reCAPTCHA v3 check (server half: lib/recaptcha.ts).
 *
 * Returns undefined when NEXT_PUBLIC_RECAPTCHA_SITE_KEY is unset, which is the
 * case in production today — the server then skips verification too, so forms
 * keep working exactly as before until the key pair is provisioned.
 *
 * Loads from recaptcha.net rather than google.com because that host is already
 * allowed by the script-src and frame-src directives in middleware.ts.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
const SRC = `https://www.recaptcha.net/recaptcha/api.js?render=${SITE_KEY ?? ''}`;

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

let loader: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'));
    if (window.grecaptcha) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="https://www.recaptcha.net/recaptcha/api.js"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('recaptcha failed to load')));
      return;
    }
    const el = document.createElement('script');
    el.src = SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('recaptcha failed to load'));
    document.head.appendChild(el);
  });
  return loader;
}

/**
 * Mint a token for `action`. Never throws: on any failure it resolves to
 * undefined and the submission proceeds, leaving the decision to the server
 * (which treats a missing token as a rejection only once a secret is set).
 */
export async function getRecaptchaToken(action: string): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  try {
    await loadScript();
    const g = window.grecaptcha;
    if (!g) return undefined;
    await new Promise<void>(resolve => g.ready(resolve));
    return await g.execute(SITE_KEY, { action });
  } catch (e) {
    console.error('[recaptcha] could not mint a token', e);
    return undefined;
  }
}
