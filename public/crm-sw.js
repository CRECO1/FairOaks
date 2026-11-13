/* CRM service worker: phone alerts only. It shows a notification when the server pushes one and opens the CRM
 * page it points at when tapped. It deliberately caches and intercepts NOTHING — the CRM shows live data and a
 * stale screen is worse than a slow one. Registered with scope /crm (see PhoneAlerts.tsx). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'CRM', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'CRM', {
    body: d.body || '',
    icon: '/icon-192.png?v=2',
    badge: '/crm-badge.png?v=2',
    tag: d.tag || undefined,
    data: { url: d.url || '/crm' },
  }));
});

// Tapping an alert has to land on the thing it was about. A phone does not always honour the URL we ask to open (an installed home-screen app can launch at its
// start page, or just come to the front with no navigation), so the tap is delivered three ways: (1) a note left in the Cache API that the app reads when it
// starts or comes back to the front, (2) a message to an app window that is already open, (3) the URL itself (navigate / openWindow) as the fallback.
// The app clears the note once it has acted on it, and ignores one older than two minutes.
async function stashTarget(url) {
  try {
    const cache = await caches.open('crm-pending-open');
    await cache.put('/__pending', new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { /* no Cache API: the message and the URL still work */ }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/crm', self.location.origin).href;
  event.waitUntil((async () => {
    await stashTarget(target);
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (!c.url.startsWith(self.location.origin + '/crm')) continue;
      let messaged = false;
      try { c.postMessage({ type: 'crm-open', url: target }); messaged = true; } catch (e) { /* the note is still there */ }
      let w = c;
      try { if ('focus' in c) w = (await c.focus()) || c; } catch (e) { /* ignore */ }
      // An app window that could not be messaged is reloaded onto the link instead; one that was messaged opens the item in place (no reload).
      if (!messaged) { try { if (w && 'navigate' in w) await w.navigate(target); } catch (e) { /* the note is read when the app next shows */ } }
      return;
    }
    return self.clients.openWindow(target);
  })());
});
