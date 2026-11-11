/* GMS back-office service worker: lets the desk reopen the app without internet.
   - built assets (hashed names): cache first
   - the app page: network first, the last good copy when offline
   - "who am I": network first, last copy when offline, so the app can start
   Nothing else from the API is cached: numbers and money always come from the server. */
const CACHE = "gms-staff-v1";
const SHELL = "/login";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("gms-staff-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/m/")) return;
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; })));
    return;
  }
  if (e.request.mode === "navigate" && !url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(SHELL).then((hit) => hit || Response.error())));
    return;
  }
  if (url.pathname === "/api/auth/me") {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then((hit) => hit || Response.error())));
  }
});
