// `next dev` compiles modules through eval() for hot-module replacement, so the
// dev server renders a blank page under a CSP without 'unsafe-eval'. This is
// gated on NODE_ENV so it can never reach a built artifact: `next build` and
// `next start` both run with NODE_ENV=production, as does Vercel.
const isDev = process.env.NODE_ENV === 'development';
const devScriptSrc = isDev ? " 'unsafe-eval'" : '';

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
      // NOTE: 'unsafe-eval' stays out of every built artifact — Next.js production
      // builds do not require it. It is appended for `next dev` only (see devScriptSrc
      // above), because HMR evaluates modules through eval(). Do not add it here
      // unconditionally; if a dependency needs it in production, justify it explicitly.
      `script-src 'self' 'unsafe-inline'${devScriptSrc} https://www.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://www.clarity.ms https://maps.googleapis.com https://maps.gstatic.com https://www.recaptcha.net https://www.gstatic.com https://recaptcha.google.com`,
      // Styles: self + inline (Tailwind/CSS-in-JS) + Google Fonts
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Images: allow any https source + data URIs (listing photos, Supabase storage) +
      // blob: URLs (the off-main-thread PDF renderer paints pages to blob-backed <img> —
      // e.g. the public /sign page, which falls through to this baseline CSP, not the
      // middleware one). blob: refs point only to in-memory data the page itself created.
      "img-src 'self' data: blob: https: https://maps.googleapis.com https://maps.gstatic.com https://*.ggpht.com https://streetviewpixels-pa.googleapis.com",
      // Fonts: self + Google Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Connect: self + Supabase + Google APIs + Resend + ATTOM + Analytics
      "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://www.googleapis.com https://gmail.googleapis.com https://oauth2.googleapis.com https://api.attomdata.com https://resend.com https://maps.googleapis.com https://maps.gstatic.com https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://www.googletagmanager.com https://*.clarity.ms https://api-sabor.connectmls.com https://api.resend.com https://graph.facebook.com https://api.linkedin.com https://api.twitter.com https://accounts.google.com",
      // Frames: same origin only (CRM embeds) + reCAPTCHA v3 challenge/badge iframe
      "frame-src 'self' https://www.recaptcha.net https://www.google.com https://recaptcha.google.com",
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
    const NOINDEX = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // Private surfaces: never indexed, even when a URL is linked from elsewhere
      // (robots.txt only stops crawling, not indexing of a linked URL).
      { source: '/crm', headers: NOINDEX },
      { source: '/crm/:path*', headers: NOINDEX },
      { source: '/sign/:path*', headers: NOINDEX },
      { source: '/signup', headers: NOINDEX },
      { source: '/signup/:path*', headers: NOINDEX },
      { source: '/admin', headers: NOINDEX },
      { source: '/admin/:path*', headers: NOINDEX },
      { source: '/manage', headers: NOINDEX },
      { source: '/manage/:path*', headers: NOINDEX },
      { source: '/api/:path*', headers: NOINDEX },
      { source: '/billing/:path*', headers: NOINDEX },
      { source: '/client/:path*', headers: NOINDEX },
    ];
  },
};

export default nextConfig;
