const CACHE_VERSION = "v1.0.8"; // Bumped version to force update
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

  // 🚫 Never touch embed pages
  if (url.pathname.includes("/embed/")) {
    return;
  }

  // 🧭 Navigation requests (SPA)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the latest index.html
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put("./index.html", clone);
          });
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // 📦 Static assets
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
