// JUO Legacy Scanner - Service Worker
// Provides offline support and caches essential files

const CACHE_NAME = "juo-legacy-scanner-v1";
const OFFLINE_URL = "offline.html";

// List of files to cache for offline use
const ASSETS_TO_CACHE = [
  "/JUO-Legacy-Scanner/",          // index.html
  "/JUO-Legacy-Scanner/index.html",
  "/JUO-Legacy-Scanner/style.css",
  "/JUO-Legacy-Scanner/script.js",
  "/JUO-Legacy-Scanner/icon-192.png",
  "/JUO-Legacy-Scanner/icon-512.png",
  "/JUO-Legacy-Scanner/offline.html"
];

// Install event: cache the offline page and essential assets
self.addEventListener("install", (event) => {
  console.log("[Service Worker] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching app shell and offline page");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate event: clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[Service Worker] Activating...");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch event: serve from cache first, fallback to network, fallback to offline page
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached asset
        return cachedResponse;
      }
      return fetch(event.request)
        .then((networkResponse) => {
          // Optionally cache new network responses (dynamic caching)
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // If network fails, show offline page for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
        });
    })
  );
});

// Listen for skip waiting message to immediately activate new service worker
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
