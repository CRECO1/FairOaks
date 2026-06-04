import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/social/done?social=connected&platform=facebook&count=2
 *
 * Landing page for popup-mode OAuth flows. Sends a postMessage to the opener
 * window with the result params, then closes itself.
 */
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const isError = req.nextUrl.searchParams.get('social') === 'error';
  const platform = req.nextUrl.searchParams.get('platform') ?? '';

  const label = platform.charAt(0).toUpperCase() + platform.slice(1);
  const msg = isError ? `❌ Could not connect ${label}` : `✅ ${label} connected!`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>${isError ? 'Connection failed' : 'Connected!'}</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column;
           align-items: center; justify-content: center; height: 100vh; margin: 0;
           background: #f9fafb; gap: 12px; }
    p { color: #374151; font-size: 16px; font-weight: 600; margin: 0; }
    small { color: #9ca3af; font-size: 13px; }
    button { margin-top: 8px; padding: 8px 20px; border-radius: 8px; border: none;
             background: #C9A84C; color: #fff; font-weight: 700; cursor: pointer;
             font-size: 14px; }
  </style>
</head>
<body>
  <p id="msg">${msg}</p>
  <small id="sub">This window will close automatically…</small>
  <button id="btn" style="display:none" onclick="window.close()">Close this window</button>
  <script>
    (function() {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'social_oauth_done', qs: ${JSON.stringify(qs)} }, '*');
        }
      } catch(e) {}

      // Try closing immediately
      window.close();

      // If still open after 800ms, show manual close button
      setTimeout(function() {
        if (!window.closed) {
          document.getElementById('sub').textContent = 'You can close this window now.';
          document.getElementById('btn').style.display = 'inline-block';
        }
      }, 800);
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
