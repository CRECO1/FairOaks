'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';

// Routes where analytics/tracking should NOT fire
const EXCLUDED_PREFIXES = ['/crm', '/manage'];

export default function AnalyticsScripts() {
  const pathname = usePathname();
  if (EXCLUDED_PREFIXES.some(prefix => pathname.startsWith(prefix))) return null;

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
          })(window, document, "clarity", "script", "wjbx7c74ra");
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
