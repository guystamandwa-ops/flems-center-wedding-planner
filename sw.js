const CACHE_NAME = "flems-center-v5";
const APP_SHELL = [
  new URL("./index.html", self.registration.scope).href,
  new URL("./icons/flems-icon-192.png", self.registration.scope).href,
  new URL("./icons/flems-icon-512.png", self.registration.scope).href,
  new URL("./qrcode.min.js", self.registration.scope).href,
  new URL("./qr-scanner.legacy.min.js", self.registration.scope).href
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await cache.addAll(APP_SHELL);
        try {
          const sdkUrl = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
          const sdkResponse = await fetch(sdkUrl, { mode: "cors" });
          if (sdkResponse.ok) await cache.put(sdkUrl, sdkResponse);
        } catch (error) {
          // L'application peut toujours s'installer si le CDN est temporairement indisponible.
        }
      })
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

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const title = payload.title || "Rappel de votre mariage";
  const options = {
    body: payload.body || "Un rappel de votre mariage vous attend.",
    icon: new URL("./icons/flems-icon-192.png", self.registration.scope).href,
    badge: new URL("./icons/flems-icon-192.png", self.registration.scope).href,
    tag: payload.tag || "flems-wedding-reminder",
    data: { url: payload.url || "./" },
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === new URL(target).origin) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
