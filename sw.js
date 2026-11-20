const CACHE_NAME = "flems-center-v4";
const APP_SHELL = [
  new URL("./index.html", self.registration.scope).href,
  new URL("./icons/flems-icon-192.png", self.registration.scope).href,
  new URL("./icons/flems-icon-512.png", self.registration.scope).href,
  new URL("./qrcode.min.js", self.registration.scope).href,
  new URL("./qr-scanner.legacy.min.js", self.registration.scope).href,
  new URL("./qr-scanner.umd.min.js", self.registration.scope).href
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("flems-center-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const supabaseSdk = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  const isSupabaseSdk = request.url === supabaseSdk;
  if (url.origin !== self.location.origin && !isSupabaseSdk) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(APP_SHELL[0], copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(APP_SHELL[0])) || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const refresh = fetch(request).then(response => {
        if (response && response.ok && (response.type === "basic" || isSupabaseSdk && response.type === "cors")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached || Response.error());
      return cached || refresh;
    })
  );
});
