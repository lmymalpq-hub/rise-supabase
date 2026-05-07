// Service Worker minimal pour Rise PWA Supabase.
// Stratégie : network-first pour le shell statique aussi (sinon le cache
// retient l'ancien api.js après chaque release), fallback cache offline.
//
// ⚠️ Bump CACHE à chaque release frontend pour forcer l'invalidation
// (sinon les anciens clients gardent l'ancien api.js et ratent les
// nouvelles fonctions API ajoutées).
const CACHE = "rise-shell-v4-zones";
const SHELL = ["./", "./index.html", "./config.js", "./api.js", "./manifest.json", "./dashboard.html"];

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
  // Network-first pour API (Edge Functions Supabase) + assets shell
  // (config.js, api.js, index.html, dashboard.html) pour ne pas rater
  // les releases. Cache offline en fallback uniquement.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        // Update cache opportunistically pour offline
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then((cc) => cc.put(e.request, copy)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request))
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
