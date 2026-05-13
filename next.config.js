import { withPayload } from '@payloadcms/next/withPayload';

// Security headers for production
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    // Content-Security-Policy — baseline policy. Adjust as integrations are added.
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Scripts: self + inline (Next.js hydration requires unsafe-inline) + GTM/GA/Maps
      // NOTE: 'unsafe-eval' removed — Next.js 14 production builds do not require it.
      // Re-add only if a specific dependency explicitly needs it (check browser console for CSP violations).
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://maps.googleapis.com https://maps.gstatic.com",
      // Styles: self + inline (Tailwind/CSS-in-JS)
      "style-src 'self' 'unsafe-inline'",
      // Images: allow any https source + data URIs (listing photos, Supabase storage)
      "img-src 'self' data: https: https://maps.googleapis.com https://maps.gstatic.com https://*.ggpht.com https://streetviewpixels-pa.googleapis.com",
      // Fonts: self only
      "font-src 'self'",
      // Connect: self + Supabase + Google APIs + Resend + ATTOM
      "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://www.googleapis.com https://gmail.googleapis.com https://oauth2.googleapis.com https://api.attomdata.com https://resend.com https://maps.googleapis.com https://maps.gstatic.com",
      // Frames: same origin only (CRM embeds)
      "frame-src 'self'",
      // Forms: self only
      "form-action 'self'",
      // Objects: none
      "object-src 'none'",
      // Base URI: self only
      "base-uri 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.vercel-storage.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        // Supabase Storage — agent photos, listing images, etc.
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.in',
      },
      {
        // SABOR / ConnectMLS listing photos
        protocol: 'https',
        hostname: '**.connectmls.com',
      },
      {
        // SABOR media CDN (alternate hostnames)
        protocol: 'https',
        hostname: '**.sabor.com',
      },
      {
        // Catch-all for any MLS media CDN served over HTTPS
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  reactStrictMode: true, // Enable for better security and debugging
  experimental: {
    reactCompiler: false,
  },
  serverExternalPackages: ['sharp', 'graphql'],

  // Add security headers to all routes
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withPayload(nextConfig);
