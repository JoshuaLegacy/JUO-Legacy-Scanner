/* JUO Legacy Scanner – Service Worker */

const CACHE_NAME = "juo-legacy-scanner-v1";
const OFFLINE_URL = "offline.html";

/* Files required for app to work offline */
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  OFFLINE_URL,

  /* Icons */
  "./icons/icon-192.png",
  "./icons/icon-512.png",

  /* External libraries (CDN cached safely) */
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css"
];

/* INSTALL */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

/* ACTIVATE */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

/* FETCH */
self.addEventListener("fetch", event => {
  const request = event.request;

  /* Ignore camera, media streams, and non-GET requests */
  if (request.method !== "GET" || request.url.startsWith("blob:")) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          if (request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
        });
    })
  );
});
