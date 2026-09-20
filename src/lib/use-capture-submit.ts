'use client';

import { useState } from 'react';
import { getRecaptchaToken } from '@/lib/recaptcha-client';

/**
 * The submit engine every Fair Oaks capture shares.
 *
 * Four components had each written the same sequence by hand — fetch a
 * reCAPTCHA token, POST, decide what counts as failure, show an error, flip to
 * success. They had drifted: two surfaced the API's error message, one showed a
 * generic string, and one treated any non-2xx as a silent failure. A fix in one
 * never reached the others.
 *
 * The endpoint, the payload and the markup stay with the caller. A listing
 * inquiry is not a footer alert signup, and flattening them would change what
 * they do. This owns the mechanics only.
 *
 * The CRECO repo has its counterpart at src/lib/use-capture-submit.ts. That one
 * also reads a honeypot field, which this site's forms do not carry.
 */
export interface CaptureSubmitOptions {
  endpoint: string;
  /** reCAPTCHA v3 action — keep each surface's existing name. */
  recaptchaAction: string;
  buildPayload: (extras: { recaptchaToken: string | undefined }) => Record<string, unknown>;
  /** Shown when the request fails; falls back to the API's own message. */
  errorFallback?: string;
  /** Runs after a successful submit — clearing a field, firing analytics. */
  onSuccess?: () => void | Promise<void>;
}

export interface CaptureSubmitState {
  submitting: boolean;
  submitted: boolean;
  error: string | null;
  submit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  reset: () => void;
}

export function useCaptureSubmit(opts: CaptureSubmitOptions): CaptureSubmitState {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const recaptchaToken = await getRecaptchaToken(opts.recaptchaAction);
      const res = await fetch(opts.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.buildPayload({ recaptchaToken })),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || opts.errorFallback || `HTTP ${res.status}`);
      }
      setSubmitted(true);
      await opts.onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(opts.errorFallback ?? message);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    submitting,
    submitted,
    error,
    submit,
    reset: () => { setSubmitted(false); setError(null); },
  };
}
