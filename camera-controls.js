/* Capability-based resolution requests; report negotiated pixels rather than advertised sensor MP. */
(function (root) {
  "use strict";
  const profiles = new WeakMap(),
    MAX_PIXELS = 24000000;
  function fitPixels(
    pixels,
    maxWidth,
    maxHeight,
    ratio = maxWidth / maxHeight,
  ) {
    const width = Math.min(maxWidth, Math.sqrt(pixels * ratio)),
      height = Math.min(maxHeight, width / ratio),
      w = Math.min(maxWidth, height * ratio);
    return {
      width: Math.max(2, Math.floor(w / 2) * 2),
      height: Math.max(2, Math.floor(height / 2) * 2),
    };
  }
  function choices(width, height) {
    const max = Math.min(MAX_PIXELS, width * height),
      out = [
        {
          value: "auto",
          label: "Auto / balanced",
          pixels: Math.min(4000000, max),
        },
      ];
    for (const mp of [2, 4, 8, 12, 24])
      if (mp * 1000000 <= max * 1.005)
        out.push({
          value: String(mp),
          label: `Up to ${mp} MP`,
          pixels: mp * 1000000,
        });
    if (max > 0)
      out.push({
        value: "max",
        label: `Maximum available (up to ${(max / 1000000).toFixed(1)} MP)`,
        pixels: max,
      });
    return out;
  }
  const timed = (promise, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Camera capability request timed out.")),
        ms,
      );
      Promise.resolve(promise).then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  async function attach(track, select, status) {
    const settings = track.getSettings?.() || {},
      caps = track.getCapabilities?.() || {};
    let photo = null,
      camera = null;
    if ("ImageCapture" in root) {
      try {
        camera = new ImageCapture(track);
        photo = await timed(camera.getPhotoCapabilities(), 2500);
      } catch {
        camera = null;
      }
    }
    if (!photo?.imageWidth?.max || !photo?.imageHeight?.max) camera = null;
    if (track.readyState === "ended") return;
    const videoWidth = caps.width?.max || settings.width || 1280,
      videoHeight = caps.height?.max || settings.height || 720;
    const photoWidth = photo?.imageWidth?.max || 0,
      photoHeight = photo?.imageHeight?.max || 0,
      usePhoto = photoWidth * photoHeight > videoWidth * videoHeight;
    const profile = {
      camera,
      photo,
      settings,
      width: usePhoto ? photoWidth : videoWidth,
      height: usePhoto ? photoHeight : videoHeight,
      videoWidth,
      videoHeight,
    };
    profiles.set(track, profile);
    const selected = select.value,
      options = choices(profile.width, profile.height);
    select.replaceChildren(
      ...options.map((item) => {
        const o = document.createElement("option");
        o.value = item.value;
        o.textContent = item.label;
        return o;
      }),
    );
    select.value = options.some((o) => o.value === selected)
      ? selected
      : "auto";
    select.disabled = false;
    describe(track, status);
    return profile;
  }
  function target(track, value) {
    const p = profiles.get(track),
      s = track.getSettings?.() || {};
    if (!p) return Math.min(MAX_PIXELS, (s.width || 1280) * (s.height || 720));
    const max = Math.min(MAX_PIXELS, p.width * p.height);
    return value === "max"
      ? max
      : value === "auto"
        ? Math.min(4000000, max)
        : Math.min(max, Math.max(100000, Number(value) * 1000000));
  }
  function describe(track, status) {
    const s = track.getSettings?.() || {},
      p = profiles.get(track);
    status.textContent =
      s.width && s.height
        ? `Preview: ${s.width} × ${s.height} (${((s.width * s.height) / 1000000).toFixed(1)} MP). ${p?.camera ? "Still-photo capture is available; the actual captured size is reported after capture." : "This browser exposes camera preview resolution only."}`
        : "Camera resolution will be reported after the camera starts.";
  }
  async function apply(track, value, status) {
    const p = profiles.get(track);
    if (!p) return;
    const pixels = target(track, value);
    if (!p.camera || pixels <= p.videoWidth * p.videoHeight) {
      const s = track.getSettings?.() || {},
        size = fitPixels(
          pixels,
          p.videoWidth,
          p.videoHeight,
          (s.width || p.videoWidth) / (s.height || p.videoHeight),
        );
      try {
        await track.applyConstraints({
          width: { ideal: size.width },
          height: { ideal: size.height },
        });
      } catch {
        /* Keep the negotiated camera mode; the measured status remains authoritative. */
      }
    }
    describe(track, status);
    return pixels;
  }
  async function capture(track, video, value, limit) {
    const p = profiles.get(track),
      wanted = target(track, value);
    let image = null,
      kind = "preview",
      warning = "";
    if (
      p?.camera &&
      value !== "auto" &&
      p.photo.imageWidth.max * p.photo.imageHeight.max >=
        Math.min(wanted, video.videoWidth * video.videoHeight) * 0.95
    ) {
      try {
        const width = p.photo.imageWidth.max,
          height = p.photo.imageHeight.max,
          size = fitPixels(wanted, width, height);
        let blob;
        try {
          blob = await timed(
            p.camera.takePhoto({
              imageWidth: size.width,
              imageHeight: size.height,
            }),
            7000,
          );
        } catch (first) {
          if (track.readyState === "ended") throw first;
          blob = await timed(p.camera.takePhoto(), 7000);
        }
        if (track.readyState === "ended")
          throw new DOMException("Capture cancelled", "AbortError");
        const url = URL.createObjectURL(blob);
        try {
          image = new Image();
          image.src = url;
          await image.decode();
          kind = "photo";
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        if (track.readyState === "ended")
          throw new DOMException("Capture cancelled", "AbortError");
        warning =
          "High-resolution still capture was unavailable; the actual preview frame was used. ";
        image = null;
      }
    }
    if (track.readyState === "ended")
      throw new DOMException("Capture cancelled", "AbortError");
    const width = image?.naturalWidth || video.videoWidth,
      height = image?.naturalHeight || video.videoHeight;
    if (!width || !height)
      throw Error("Wait for a camera frame before capturing.");
    const scale = Math.min(
        1,
        Math.sqrt(Math.min(limit, MAX_PIXELS) / (width * height)),
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.floor(width * scale));
    canvas.height = Math.max(2, Math.floor(height * scale));
    canvas
      .getContext("2d")
      .drawImage(image || video, 0, 0, canvas.width, canvas.height);
    return {
      canvas,
      width,
      height,
      kind,
      description: `${warning}Captured ${width} × ${height} (${((width * height) / 1000000).toFixed(1)} MP).`,
    };
  }
  const api = {
    fitPixels,
    choices,
    attach,
    apply,
    capture,
    target,
    MAX_PIXELS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CameraControls = api;
})(globalThis);
