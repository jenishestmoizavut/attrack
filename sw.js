const CACHE_VERSION = "v1.1.3"; // Bumped version to force update
const CACHE_NAME = `attrack-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png.png",
  "./icon-512.png.png",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
];

// Force immediate activation
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

// Clean up ALL old versions (v1.0.0, v1.0.2, etc.)
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // 🚫 1. Don't intercept OFF-origin requests (JSONBlob / CDNs / anything else)
  if (url.origin !== self.location.origin) {
    return; // allow browser to reach network directly
  }

  // 🚫 2. Don't cache non-GET requests (POST, PUT, DELETE)
  if (event.request.method !== "GET") {
    return;
  }

  // 🚫 3. Don't mess with embeds
  if (url.pathname.includes("/embed/")) {
    return;
  }

  // 🧭 4. Navigation requests (SPA fallback)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          caches.open(CACHE_NAME).then(cache => {
            cache.put("./index.html", res.clone());
          });
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // 📦 5. Cache static same-origin GET requests
  event.respondWith(
    caches.match(event.request).then(res => {
      return (
        res ||
        fetch(event.request).then(networkRes => {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkRes.clone());
          });
          return networkRes;
        })
      );
    })
  );
});

