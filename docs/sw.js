// Service Worker minimal pour Rise PWA Supabase.
// Stratégie : cache-first pour le shell statique (index.html, config.js, api.js),
// network-first pour les Edge Functions (toujours fraîches).

const CACHE = "rise-shell-v1";
const SHELL = ["./", "./index.html", "./config.js", "./api.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Network-first pour API (Edge Functions Supabase)
  if (url.pathname.includes("/functions/v1/") || url.pathname.includes("/storage/v1/")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Cache-first pour le shell statique
  e.respondWith(
    caches.match(e.request).then((c) => c || fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((cc) => cc.put(e.request, copy)).catch(() => {});
      return r;
    }))
  );
});

// Web Push notifications (Sprint TS-14 viendra brancher push-send côté serveur)
self.addEventListener("push", (e) => {
  if (!e.data) return;
  let payload = {};
  try { payload = e.data.json(); } catch { payload = { title: "Rise", body: e.data.text() }; }
  const opts = {
    body: payload.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: payload.tag || "rise-notif",
    data: payload,
  };
  e.waitUntil(self.registration.showNotification(payload.title || "Rise", opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./";
  e.waitUntil(clients.openWindow(url));
});
