/* Keep the app shell offline; optional engines are cached only after successful downloads. */
"use strict";
const CACHE_PREFIX = "juo-legacy-scanner-";
const CACHE_NAME = CACHE_PREFIX + "v3";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./scan-core.js",
  "./vendor/jspdf.umd.min.js",
  "./manifest.json",
  "./offline.html",
  "./icon-192.png",
  "./icon-512.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || !["https:", "http:"].includes(url.protocol))
    return;
  const local = url.origin === self.location.origin;
  const engine = [
    "cdnjs.cloudflare.com",
    "cdn.jsdelivr.net",
    "tessdata.projectnaptha.com",
  ].includes(url.hostname);
  if (!local && !engine) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Serve HTML and scripts from one installed shell version; the browser checks worker updates.
      if (request.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
        try {
          return await fetch(request);
        } catch {
          return (await cache.match("./offline.html")) || Response.error();
        }
      }
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type !== "opaque")
          await cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});
