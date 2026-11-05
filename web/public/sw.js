/* GMS member app service worker: instant start and offline pass.
   Assets are cache-first (hashed names), pages network-first, API never cached
   except the member's own pass data for offline display. */
const CACHE = "gms-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); return r; })));
    return;
  }
  if (url.pathname.startsWith("/m/") || url.pathname === "/api/m/me" || url.pathname.startsWith("/api/public/gyms/")) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
  }
});
