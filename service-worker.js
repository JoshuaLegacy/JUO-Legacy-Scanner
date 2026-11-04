/* Keep the app shell offline; optional engines are cached only after successful downloads. */
"use strict";
const CACHE_PREFIX = "juo-legacy-scanner-";
const CACHE_NAME = CACHE_PREFIX + "v6";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./scan-core.js",
  "./page-model.js",
  "./page-editor.js",
  "./offline-ocr.js",
  "./pdf-text.js",
  "./ocr-assets.json",
  "./vendor/tesseract.min.js",
  "./vendor/tesseract-worker.min.js",
  "./vendor/zxing.min.js",
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
  if (url.origin !== self.location.origin) return;
  const packRoot = new URL("ocr-assets/v1/", self.registration.scope).href;
  if (url.href.startsWith(packRoot)) {
    event.respondWith(
      caches
        .open("juo-scanner-ocr-packs-v1")
        .then((cache) => cache.match(request))
        .then(
          (response) =>
            response ||
            new Response("Download this OCR language before use.", {
              status: 503,
            }),
        ),
    );
    return;
  }
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
