const CACHE_NAME = "expense-tracker-v1";
const APP_SHELL = ["/", "/home", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "You have a new reminder." }; }
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title || "Expense reminder", {
      body: data.body || "Open the app to review your reminder.",
      icon: data.icon || "/icons/icon.svg",
      badge: data.badge || "/icons/icon.svg",
      tag: data.tag || data.notificationId || undefined,
      renotify: false,
      data: {
        url: data.deepLink || data.url || "/home",
        notificationId: data.notificationId || "",
        type: data.type || "",
        obligationId: data.obligationId || "",
        sourceTransactionId: data.sourceTransactionId || ""
      }
    }),
    self.registration.setAppBadge ? self.registration.setAppBadge(1).catch(() => undefined) : Promise.resolve()
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationId = event.notification.data?.notificationId;
  const targetUrl = new URL(event.notification.data?.url || "/home", self.location.origin);
  if (notificationId) targetUrl.searchParams.set("notificationId", notificationId);
  const url = targetUrl.href;
  event.waitUntil(Promise.all([
    notificationId ? fetch(`/api/notifications/${notificationId}/read`, { method: "PATCH", credentials: "include" }).catch(() => undefined) : Promise.resolve(),
    self.registration.clearAppBadge ? self.registration.clearAppBadge().catch(() => undefined) : Promise.resolve(),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) return existing.navigate(url).then((client) => client?.focus());
      return self.clients.openWindow(url);
    })
  ]));
});
