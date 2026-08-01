const CACHE_VERSION = "v2.2.0"; // Bumped: added push notifications
const CACHE_NAME = `attrack-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
];

// ---------------------------------------------------------------------
// PUSH NOTIFICATIONS (Firebase Cloud Messaging)
// Merged into this file rather than a separate firebase-messaging-sw.js:
// only one service worker can control a given scope at a time, and this
// one already owns "/" for the PWA cache, so messaging has to live here.
// ---------------------------------------------------------------------
importScripts("https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAFZp4TtN46dygOwXdMYpIDN_nmZj9O35I",
  authDomain: "attrack-sync.firebaseapp.com",
  projectId: "attrack-sync",
  storageBucket: "attrack-sync.firebasestorage.app",
  messagingSenderId: "392011507811",
  appId: "1:392011507811:web:89c0b23e571c46b9647056"
});

const messaging = firebase.messaging();

// Fires when a push arrives and no Attrack tab is focused.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Attrack";
  self.registration.showNotification(title, {
    body: payload.notification?.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: payload.data || {}
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

// 1. Install & Cache Core Assets
// NOTE: cache.addAll() is all-or-nothing — if any single asset fails
// (e.g. a flaky fetch of the cross-origin pdf.js from cdnjs), the whole
// install rejects and the SW never activates. That silently breaks
// enableNotifications() too, since it awaits navigator.serviceWorker.ready,
// which never resolves without an active worker. Cache each asset
// individually instead so one failure doesn't take down the rest.
self.addEventListener("install", event => {
  self.skipWaiting(); // Force the waiting service worker to become the active service worker
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        CORE_ASSETS.map(asset =>
          cache.add(asset).catch(err => console.warn("SW: failed to cache", asset, err))
        )
      )
    )
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