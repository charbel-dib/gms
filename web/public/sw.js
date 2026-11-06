/* GMS member app service worker: instant start, offline pass, push notifications.
   Assets are cache-first (hashed names), pages network-first, API never cached
   except the member's own pass data for offline display. */
const CACHE = "gms-v2";
self.addEventListener("install", () => self.skipWaiting());
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

// ---- push notifications ----
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Notification", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Your gym", {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/" },
    lang: "",
    dir: "auto",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin + "/m/") && "focus" in w) {
        await w.focus();
        if ("navigate" in w) await w.navigate(target).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// The browser rotated the subscription: re-register it with the server.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const key = await fetch("/api/m/push/key", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
    if (!key) return;
    const raw = atob(key.publicKey.replace(/-/g, "+").replace(/_/g, "/"));
    const appKey = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    await fetch("/api/m/push/subscribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  })());
});
