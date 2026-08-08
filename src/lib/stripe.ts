import Stripe from 'stripe';

// Server-side Stripe client for the CRM app (webhook + billing).
// Pinned to the SDK's bundled API version to match the marketing site.
const key = process.env.STRIPE_SECRET_KEY;

export const stripe = key
  ? new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
  : null;

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
