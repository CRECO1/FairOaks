import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/social/done?social=connected&platform=facebook&count=2
 *
 * Final landing page after OAuth. Broadcasts the result to the originating tab
 * via localStorage (works for both popup and new-tab flows), then closes itself.
 */
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const isError = req.nextUrl.searchParams.get('social') === 'error';
  const platform = req.nextUrl.searchParams.get('platform') ?? '';
  const label = platform.charAt(0).toUpperCase() + platform.slice(1);

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>${isError ? 'Connection failed' : `${label} connected`}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
           display: flex; flex-direction: column; align-items: center;
           justify-content: center; height: 100vh; margin: 0; background: #f9fafb; gap: 10px; }
    .icon { font-size: 40px; }
    p { color: #111827; font-size: 16px; font-weight: 600; margin: 0; }
    small { color: #6b7280; font-size: 13px; }
    button { margin-top: 12px; padding: 9px 22px; border-radius: 8px; border: none;
             background: #C9A84C; color: #fff; font-weight: 700; cursor: pointer; font-size: 14px; }
  </style>
</head>
<body>
  <div class="icon">${isError ? '❌' : '✅'}</div>
  <p id="msg">${isError ? `Could not connect ${label}` : `${label} connected!`}</p>
  <small id="sub">Closing window…</small>
  <button id="btn" style="display:none" onclick="window.close()">Close this window</button>

  <script>
    (function() {
      var qs = ${JSON.stringify(qs)};

      // Broadcast via localStorage so any open CRM tab picks it up
      try {
        localStorage.setItem('_social_oauth', JSON.stringify({ qs: qs, ts: Date.now() }));
      } catch(e) {}

      // Also try postMessage in case this is a popup
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'social_oauth_done', qs: qs }, '*');
        }
      } catch(e) {}

      // Try to close
      window.close();

      // If still open after 1s, show manual button
      setTimeout(function() {
        document.getElementById('sub').textContent = 'You can close this window.';
        document.getElementById('btn').style.display = 'inline-block';
      }, 1000);
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
}
