'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Third-party analytics for the PUBLIC marketing site only.
 *
 * /crm and /manage are nested inside the root layout, so this component renders
 * on those routes too — the prefix check below is the only thing keeping GTM,
 * GA and Clarity off the internal app. Without it, every agent's working session
 * would be recorded as visitor behaviour and would pollute the marketing data.
 *
 * The guard fails CLOSED: if usePathname() returns null (route not yet known)
 * we render nothing rather than assuming a public page. Skipping a moment of
 * marketing analytics is cheap; recording the CRM is not.
 *
 * Not rendering the tag is only half the job. This is a single-page app: an
 * agent who lands on the homepage and then clicks into /crm already has Clarity
 * running in memory, and it would happily keep recording their session through
 * the whole internal app. So on entering an excluded route we also tell Clarity
 * to stop.
 */

// Routes where analytics/tracking must NOT fire.
const EXCLUDED_PREFIXES = ['/crm', '/manage'];

/**
 * Microsoft Clarity project. One project per page: Clarity's loader installs a
 * single window.clarity global with a shared queue, so a second tag on the same
 * page does not give you two recordings — the projects fight over one global.
 * Overridable by env so the project can be switched without a code change.
 */
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID || 'ynv21imdze';

export default function AnalyticsScripts() {
  const pathname = usePathname();
  const excluded = !pathname || EXCLUDED_PREFIXES.some(prefix => pathname.startsWith(prefix));

  // Halt an already-running Clarity session when the user moves into the CRM.
  // Hook runs unconditionally — it must sit above the early return.
  useEffect(() => {
    if (!excluded) return;
    try {
      (window as unknown as { clarity?: (cmd: string) => void }).clarity?.('stop');
    } catch {
      // Never let analytics teardown break the app.
    }
  }, [excluded]);

  if (excluded) return null;

  return (
    <>
      {/* Google Tag Manager */}
      <Script id="google-tag-manager" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-K45G8PR6');`}
      </Script>

      {/* Microsoft Clarity Heatmap */}
      <Script id="microsoft-clarity" strategy="afterInteractive">
        {`
          (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", "${CLARITY_ID}");
        `}
      </Script>

      {/* Google Analytics */}
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-SYPXDGGWQS"
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          window.gtag = window.gtag || function(){window.dataLayer.push(arguments);}
          window.gtag('js', new Date());
          window.gtag('config', 'G-SYPXDGGWQS');
        `}
      </Script>
    </>
  );
}
