import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/social/done?social=connected&platform=facebook&count=2
 *
 * Landing page for popup-mode OAuth flows. Sends a postMessage to the opener
 * window with the result params, then closes itself.
 */
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();

  const html = `<!DOCTYPE html>
<html>
<head><title>Connecting…</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb;">
  <p style="color:#374151;font-size:15px;">Connecting account…</p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'social_oauth_done', qs: ${JSON.stringify(qs)} }, '*');
      }
    } catch(e) {}
    window.close();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
