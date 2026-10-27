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
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/crm' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/crm', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin + '/crm') && 'focus' in c) return c.focus().then((w) => ('navigate' in w ? w.navigate(target) : w));
    }
    return self.clients.openWindow(target);
  }));
});
