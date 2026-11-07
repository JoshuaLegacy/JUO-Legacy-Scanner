/* Explicit, integrity-checked OCR packs served locally by the service worker. */
(function (root) {
  "use strict";
  const CACHE = "juo-scanner-ocr-packs-v1";
  const base = new URL("./", document.baseURI),
    absolute = (p) => new URL(p, base).href;
  let manifestPromise;
  async function manifest() {
    return (manifestPromise ??= fetch(absolute("ocr-assets.json"))
      .then((r) => {
        if (!r.ok)
          throw Error(
            "OCR download list is unavailable. Reload the app online.",
          );
        return r.json();
      })
      .catch((e) => {
        manifestPromise = null;
        throw e;
      }));
  }
  function specs(m, language, quality = "fast") {
    const model = (
      quality === "accurate" ? m.accurateLanguages : m.languages
    )?.[language];
    if (!model)
      throw Error("Choose a supported language and recognition quality.");
    return [
      { ...m.core, path: "ocr-assets/v1/core.js" },
      {
        ...model,
        path:
          quality === "accurate"
            ? `ocr-assets/v2/accurate/lang/${language}.traineddata`
            : `ocr-assets/v1/lang/${language}.traineddata`,
      },
    ];
  }
  async function controller() {
    if (!("serviceWorker" in navigator) || !("caches" in root))
      throw Error(
        "Offline OCR needs a browser with service-worker storage over HTTPS.",
      );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error(
              "Offline setup did not finish. Reload the app online and retry.",
            ),
          ),
        15000,
      );
      navigator.serviceWorker.ready.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          changed,
        );
        reject(Error("Reload the app to activate offline OCR."));
      }, 15000);
      function changed() {
        if (navigator.serviceWorker.controller) {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener(
            "controllerchange",
            changed,
          );
          resolve();
        }
      }
      navigator.serviceWorker.addEventListener("controllerchange", changed);
    });
  }
  async function status(language, quality = "fast") {
    const m = await manifest(),
      items = specs(m, language, quality);
    if (!("caches" in root))
      return { ready: false, bytes: items.reduce((n, s) => n + s.bytes, 0) };
    const cache = await caches.open(CACHE),
      matches = await Promise.all(
        items.map((s) => cache.match(absolute(s.path))),
      );
    return {
      ready: matches.every(
        (r, i) =>
          r?.ok &&
          r.headers.get("X-Asset-SHA256") === items[i].sha256 &&
          Number(r.headers.get("Content-Length")) === items[i].bytes,
      ),
      bytes: items.reduce((n, s) => n + s.bytes, 0),
    };
  }
  async function prepare(
    language,
    { signal, onProgress = () => {}, quality = "fast" } = {},
  ) {
    await controller();
    const m = await manifest(),
      items = specs(m, language, quality),
      cache = await caches.open(CACHE);
    let completed = 0,
      total = items.reduce((n, s) => n + s.bytes, 0);
    for (const spec of items) {
      signal?.throwIfAborted();
      const old = await cache.match(absolute(spec.path));
      if (
        old?.headers.get("X-Asset-SHA256") === spec.sha256 &&
        Number(old.headers.get("Content-Length")) === spec.bytes
      ) {
        completed += spec.bytes;
        onProgress(completed, total);
        continue;
      }
      if (!navigator.onLine)
        throw Error(
          "This language is not downloaded. Connect to the internet and download it first.",
        );
      const response = await fetch(spec.url, {
        mode: "cors",
        cache: "no-store",
        signal,
      });
      if (!response.ok || response.type === "opaque")
        throw Error(
          `OCR download failed (${response.status}). Retry when connected.`,
        );
      const chunks = [];
      let length = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > spec.bytes)
            throw Error("OCR download size did not match. Please retry.");
          chunks.push(value);
          onProgress(completed + length, total);
        }
      } finally {
        reader.releaseLock();
      }
      if (length !== spec.bytes)
        throw Error("OCR download was incomplete. Please retry.");
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== spec.sha256)
        throw Error("OCR download integrity check failed. Please retry.");
      signal?.throwIfAborted();
      await cache.put(
        absolute(spec.path),
        new Response(bytes, {
          headers: {
            "Content-Type": spec.path.endsWith(".js")
              ? "application/javascript"
              : "application/octet-stream",
            "Content-Length": String(length),
            "X-Asset-SHA256": hash,
          },
        }),
      );
      completed += length;
    }
    if (!(await status(language, quality)).ready)
      throw Error(
        "The language pack could not be saved. Free some browser storage and retry.",
      );
    return {
      workerPath: absolute("vendor/tesseract-worker.min.js"),
      corePath: absolute("ocr-assets/v1/core.js"),
      langPath: absolute(
        quality === "accurate"
          ? "ocr-assets/v2/accurate/lang"
          : "ocr-assets/v1/lang",
      ),
      gzip: false,
      cacheMethod: "none",
      workerBlobURL: false,
    };
  }
  async function remove(language, quality = "fast") {
    const m = await manifest();
    if (!m.languages[language]) throw Error("Choose a supported language.");
    const cache = await caches.open(CACHE);
    await cache.delete(
      absolute(
        quality === "accurate"
          ? `ocr-assets/v2/accurate/lang/${language}.traineddata`
          : `ocr-assets/v1/lang/${language}.traineddata`,
      ),
    );
  }
  root.OfflineOCR = { status, prepare, remove, manifest, CACHE };
})(globalThis);
