const CACHE_VERSION = "v2.1.1"; // Bumped for the Play Store fix
const CACHE_NAME = `attrack-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
];

// 1. Install & Cache Core Assets
self.addEventListener("install", event => {
  self.skipWaiting(); // Force the waiting service worker to become the active service worker
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

// 2. Activate & Clean Up Old Caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // Take control of all clients immediately
});

// 3. Network Fetch Intercept
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Ignore off-origin, non-GET, and specific embeds
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (url.pathname.includes("/embed/")) return;

  // SPA Navigation Fallback (Network First, falling back to Cache)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async networkRes => {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", networkRes.clone());
          return networkRes;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Standard Assets (Cache First, falling back to Network)
  event.respondWith(
    caches.match(event.request).then(cachedRes => {
      return cachedRes || fetch(event.request).then(async networkRes => {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, networkRes.clone());
        return networkRes;
      });
    })
  );
});
