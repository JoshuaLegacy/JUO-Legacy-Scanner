/* JUO Legacy Scanner — camera, review, local recovery, recognition and export. */
"use strict";
const $ = (id) => document.getElementById(id),
  C = ScanCore;
const state = {
  stream: null,
  starting: false,
  busy: false,
  pages: [],
  source: null,
  corners: null,
  editing: null,
  ocrBusy: false,
  liveTimer: null,
  lastCorners: null,
  steady: 0,
  lastAuto: 0,
  db: null,
  persist: Promise.resolve(),
  restoring: true,
};
const engines = {
  pdf: "vendor/jspdf.umd.min.js",
  ocr: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
};
const scripts = new Map();
function message(text) {
  $("status").textContent = text;
}
function error(err) {
  console.error(err);
  message(err.message || String(err));
}
function loadScript(url) {
  if (scripts.has(url)) return scripts.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.crossOrigin = "anonymous";
    let done = false;
    const timer = setTimeout(
      () =>
        finish(
          Error("Engine download timed out. Check your connection and retry."),
        ),
      60000,
    );
    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        script.remove();
        reject(err);
      } else resolve();
    }
    script.onload = () => finish();
    script.onerror = () =>
      finish(
        Error(
          "Could not download the engine. Connect to the internet and retry.",
        ),
      );
    document.head.append(script);
  });
  scripts.set(url, promise);
  promise.catch(() => scripts.delete(url));
  return promise;
}
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function imageCanvas(image, maxPixels = 4000000) {
  const s = Math.min(1, Math.sqrt(maxPixels / (image.width * image.height))),
    c = makeCanvas(
      Math.max(2, Math.floor(image.width * s)),
      Math.max(2, Math.floor(image.height * s)),
    );
  c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
  return c;
}
function sample(canvas, maxSide = 360) {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height)),
    c = makeCanvas(
      Math.max(2, Math.round(canvas.width * s)),
      Math.max(2, Math.round(canvas.height * s)),
    );
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  const data = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  return { data, scale: 1 / s };
}
function rotate(canvas, degrees) {
  const rad = (degrees * Math.PI) / 180,
    s = Math.abs(Math.sin(rad)),
    c = Math.abs(Math.cos(rad)),
    out = makeCanvas(
      Math.round(canvas.width * c + canvas.height * s),
      Math.round(canvas.height * c + canvas.width * s),
    ),
    ctx = out.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}
function updateControls() {
  const blocked = state.busy || state.restoring;
  $("startCameraBtn").disabled =
    blocked || state.starting || !!state.stream || $("cropModal").open;
  $("stopCameraBtn").disabled = !state.stream && !state.starting;
  $("captureBtn").disabled =
    blocked ||
    !state.stream ||
    $("preview").readyState < 2 ||
    $("cropModal").open;
  $("importFile").disabled = blocked || $("cropModal").open;
  $("downloadPdfBtn").disabled = blocked || !state.pages.length;
  $("downloadTextBtn").disabled = blocked || !state.pages.some((p) => p.text);
  $("clearBtn").disabled = blocked || !state.pages.length;
  $("confirmCropBtn").disabled =
    state.busy || !state.source || !C.validQuad(state.corners || []);
  $("recognizeBtn").disabled = state.ocrBusy || state.busy;
  $("saveTextBtn").disabled = state.ocrBusy;
  $("pageCount").textContent = state.pages.length;
}
let cameraGeneration = 0;
function stopCamera() {
  cameraGeneration++;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  state.starting = false;
  $("preview").srcObject = null;
  clearTimeout(state.liveTimer);
  state.lastCorners = null;
  state.steady = 0;
  const c = $("liveOverlay");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  updateControls();
}
async function startCamera() {
  if (state.starting || state.stream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    message(
      "Camera access requires HTTPS and a supported browser. You can still import an image.",
    );
    return;
  }
  const generation = ++cameraGeneration;
  state.starting = true;
  updateControls();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
    if (generation !== cameraGeneration) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    state.stream = stream;
    const track = stream.getVideoTracks()[0],
      caps = track.getCapabilities?.();
    if (caps?.focusMode?.includes("continuous"))
      await track
        .applyConstraints({ advanced: [{ focusMode: "continuous" }] })
        .catch(() => {});
    if (generation !== cameraGeneration) return;
    $("preview").srcObject = stream;
    await $("preview").play();
    if (generation !== cameraGeneration) return;
    message("Camera ready. Keep all four page edges inside the preview.");
    liveCheck();
  } catch (err) {
    if (generation === cameraGeneration) {
      stopCamera();
      message(
        `Camera unavailable: ${err.message}. Check browser permissions or import an image.`,
      );
    }
  } finally {
    if (generation === cameraGeneration) {
      state.starting = false;
      updateControls();
    }
  }
}
$("preview").addEventListener("loadeddata", updateControls);
function liveCheck() {
  if (!state.stream) return;
  try {
    const v = $("preview");
    if (
      v.videoWidth &&
      v.readyState >= 2 &&
      !state.busy &&
      !$("cropModal").open
    ) {
      const s = Math.min(1, 360 / Math.max(v.videoWidth, v.videoHeight)),
        c = makeCanvas(
          Math.round(v.videoWidth * s),
          Math.round(v.videoHeight * s),
        );
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      const im = c.getContext("2d").getImageData(0, 0, c.width, c.height),
        q = C.quality(im),
        corners = C.detectDocument(im),
        overlay = $("liveOverlay");
      overlay.width = c.width;
      overlay.height = c.height;
      const ctx = overlay.getContext("2d");
      if (corners) {
        ctx.strokeStyle = q.good ? "#7bf7ac" : "#ffd06d";
        ctx.lineWidth = 3;
        ctx.beginPath();
        corners.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.closePath();
        ctx.stroke();
      }
      $("cameraAdvice").textContent =
        q.warnings[0] ||
        (corners
          ? "Document detected. Hold steady."
          : "Fit the page against a contrasting background, or capture manually.");
      const stable =
        corners &&
        state.lastCorners &&
        corners.every((p, i) => C.distance(p, state.lastCorners[i]) < 5);
      state.steady = stable && q.good ? state.steady + 1 : 0;
      state.lastCorners = corners;
      if (
        $("autoCapture").checked &&
        state.steady >= 4 &&
        Date.now() - state.lastAuto > 6000
      ) {
        state.lastAuto = Date.now();
        state.steady = 0;
        capturePage();
      }
    }
  } catch (err) {
    console.warn("Preview analysis unavailable", err);
  }
  if (state.stream) state.liveTimer = setTimeout(liveCheck, 450);
}
async function capturePage() {
  if (state.busy || !state.stream || $("preview").readyState < 2) return;
  state.busy = true;
  updateControls();
  try {
    // Use the displayed frame so captured composition matches the preview. Higher resolution is requested at camera start.
    const v = $("preview"),
      c = makeCanvas(v.videoWidth, v.videoHeight);
    c.getContext("2d").drawImage(v, 0, 0);
    stopCamera();
    openCrop(imageCanvas(c));
  } catch (err) {
    error(err);
  } finally {
    state.busy = false;
    updateControls();
  }
}
function detectCorners() {
  const { data, scale } = sample(state.source, 480),
    q = C.detectDocument(data);
  state.corners = q
    ? q.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    : C.fullCorners(state.source.width, state.source.height);
  $("cropAdvice").textContent = q
    ? "Page detected. Check and adjust every corner."
    : "Could not confidently detect the page. Adjust the corners manually.";
  drawCrop();
}
function openCrop(canvas) {
  state.source = canvas;
  $("cropModal").showModal();
  detectCorners();
  const { data } = sample(canvas);
  const warnings = C.quality(data).warnings;
  if (warnings.length) $("cropAdvice").textContent += " " + warnings.join(" ");
  updateControls();
}
function drawCrop() {
  if (!state.source) return;
  const canvas = $("cropCanvas"),
    s = Math.min(1, 1000 / Math.max(state.source.width, state.source.height));
  canvas.width = Math.round(state.source.width * s);
  canvas.height = Math.round(state.source.height * s);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(state.source, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#33ef99";
  ctx.lineWidth = 3;
  ctx.beginPath();
  state.corners.forEach((p, i) =>
    i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s),
  );
  ctx.closePath();
  ctx.stroke();
  state.corners.forEach((p, i) => {
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(p.x * s, p.y * s, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#103a28";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(i + 1, p.x * s - 4, p.y * s + 4);
  });
  syncCornerControls();
  updateControls();
}
function syncCornerControls() {
  const p = state.corners[Number($("cornerSelect").value)];
  $("cornerX").value = (p.x / (state.source.width - 1)) * 100;
  $("cornerY").value = (p.y / (state.source.height - 1)) * 100;
}
function canvasPoint(event) {
  const c = $("cropCanvas"),
    rect = c.getBoundingClientRect(),
    scale = Math.min(rect.width / c.width, rect.height / c.height),
    w = c.width * scale,
    h = c.height * scale;
  return {
    x: C.clamp(
      ((event.clientX - rect.left - (rect.width - w) / 2) / w) *
        (state.source.width - 1),
      0,
      state.source.width - 1,
    ),
    y: C.clamp(
      ((event.clientY - rect.top - (rect.height - h) / 2) / h) *
        (state.source.height - 1),
      0,
      state.source.height - 1,
    ),
  };
}
let dragging = -1;
$("cropCanvas").addEventListener("pointerdown", (e) => {
  if (state.busy) return;
  const p = canvasPoint(e);
  dragging = state.corners.reduce(
    (best, q, i) =>
      C.distance(p, q) < C.distance(p, state.corners[best]) ? i : best,
    0,
  );
  $("cornerSelect").value = String(dragging);
  $("cropCanvas").setPointerCapture(e.pointerId);
  state.corners[dragging] = p;
  drawCrop();
});
$("cropCanvas").addEventListener("pointermove", (e) => {
  if (dragging < 0 || state.busy) return;
  state.corners[dragging] = canvasPoint(e);
  drawCrop();
});
for (const type of ["pointerup", "pointercancel"])
  $("cropCanvas").addEventListener(type, () => (dragging = -1));
$("cornerSelect").onchange = syncCornerControls;
for (const axis of ["X", "Y"])
  $("corner" + axis).oninput = () => {
    state.corners[Number($("cornerSelect").value)][axis.toLowerCase()] =
      (Number($("corner" + axis).value) / 100) *
      (axis === "X" ? state.source.width - 1 : state.source.height - 1);
    drawCrop();
  };
function closeCrop() {
  if (state.busy) return;
  $("cropModal").close();
  state.source = null;
  state.corners = null;
  updateControls();
}
$("cropModal").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeCrop();
});
$("detectBtn").onclick = () => {
  if (!state.busy) detectCorners();
};
$("resetCropBtn").onclick = () => {
  if (state.busy) return;
  state.corners = C.fullCorners(state.source.width, state.source.height);
  drawCrop();
};
$("rotateCropBtn").onclick = () => {
  if (state.busy) return;
  state.source = rotate(state.source, 90);
  state.corners = C.fullCorners(state.source.width, state.source.height);
  drawCrop();
};
$("cancelCropBtn").onclick = closeCrop;
$("confirmCropBtn").onclick = async () => {
  if (state.busy || !state.source || !C.validQuad(state.corners)) return;
  state.busy = true;
  updateControls();
  message("Correcting perspective and enhancing page…");
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  try {
    let im = C.warp(
      state.source
        .getContext("2d")
        .getImageData(0, 0, state.source.width, state.source.height),
      state.corners,
    );
    im = C.enhance(im, $("enhancement").value);
    let canvas = makeCanvas(im.width, im.height);
    canvas
      .getContext("2d")
      .putImageData(new ImageData(im.data, im.width, im.height), 0, 0);
    if ($("deskew").checked) {
      const angle = C.skewAngle(sample(canvas, 600).data);
      if (angle) canvas = rotate(canvas, angle);
    }
    canvas = imageCanvas(canvas);
    const size = C.outputSize(
      canvas.width,
      canvas.height,
      $("pageFormat").value,
      Number($("dpiSelect").value),
    );
    const out = makeCanvas(size.width, size.height);
    out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
    const page = {
      id: crypto.randomUUID(),
      image: out.toDataURL("image/jpeg", Number($("qualitySlider").value)),
      width: out.width,
      height: out.height,
      paper: size.paper,
      text: "",
      words: [],
      type: "Document",
      fields: "",
      confidence: null,
    };
    state.pages.push(page);
    state.busy = false;
    closeCrop();
    renderPages();
    await persistDraft();
    message(
      `Page ${state.pages.length} added. Start the camera for another page.`,
    );
  } catch (err) {
    error(err);
  } finally {
    state.busy = false;
    updateControls();
  }
};
$("importFile").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || state.busy) return;
  if (file.size > 30 * 1024 * 1024) {
    message("Choose an image smaller than 30 MB.");
    return;
  }
  stopCamera();
  state.busy = true;
  updateControls();
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.width * img.height > 40000000)
      throw Error(
        "This image is too large. Resize it below 40 megapixels first.",
      );
    openCrop(imageCanvas(img));
  } catch (err) {
    message(`Could not open the image: ${err.message}`);
  } finally {
    URL.revokeObjectURL(url);
    state.busy = false;
    updateControls();
  }
};
function renderPages() {
  const container = $("pages");
  container.replaceChildren();
  state.pages.forEach((page, index) => {
    const card = document.createElement("article");
    card.className = "page";
    const img = new Image();
    img.src = page.image;
    img.alt = `Scanned page ${index + 1}`;
    const title = document.createElement("p");
    title.textContent = `Page ${index + 1} · ${page.type}${page.text ? " · text recognized" : ""}`;
    const controls = document.createElement("div");
    controls.className = "controls";
    function button(label, fn, disabled = false) {
      const b = document.createElement("button");
      b.className = "secondary";
      b.textContent = label;
      b.disabled = disabled || state.busy;
      b.onclick = fn;
      controls.append(b);
    }
    button("Text / identify", () => openText(page));
    button(
      "Move earlier",
      () => {
        if (state.busy) return;
        [state.pages[index - 1], state.pages[index]] = [
          state.pages[index],
          state.pages[index - 1],
        ];
        renderPages();
        persistDraft();
      },
      index === 0,
    );
    button(
      "Move later",
      () => {
        if (state.busy) return;
        [state.pages[index + 1], state.pages[index]] = [
          state.pages[index],
          state.pages[index + 1],
        ];
        renderPages();
        persistDraft();
      },
      index === state.pages.length - 1,
    );
    button("Rotate", async () => {
      if (state.busy) return;
      state.busy = true;
      updateControls();
      try {
        const img = new Image();
        img.src = page.image;
        await img.decode();
        const c = rotate(imageCanvas(img), 90);
        page.image = c.toDataURL("image/jpeg", 0.95);
        [page.width, page.height] = [page.height, page.width];
        page.paper = [page.paper[1], page.paper[0]];
        page.words = [];
        page.text = "";
        page.type = "Document";
        page.fields = "";
        page.confidence = null;
        await persistDraft();
        message("Page rotated. Recognize text again for the new orientation.");
      } catch (err) {
        error(err);
      } finally {
        state.busy = false;
        renderPages();
      }
    });
    button("Delete", () => {
      if (state.busy) return;
      if (!confirm(`Delete page ${index + 1}?`)) return;
      state.pages.splice(index, 1);
      renderPages();
      persistDraft();
    });
    card.append(img, title, controls);
    container.append(card);
  });
  updateControls();
}
function openText(page) {
  if (state.busy) return;
  state.editing = page;
  $("recognizedText").value = page.text;
  $("documentType").value = page.type;
  $("identifiedFields").value = page.fields;
  $("ocrStatus").textContent =
    page.confidence === null
      ? "Review recognition before relying on it."
      : `Average OCR confidence: ${Math.round(page.confidence)}%. Check names, dates and amounts.`;
  $("barcodeBtn").disabled = !("BarcodeDetector" in window);
  $("barcodeBtn").title =
    "BarcodeDetector" in window
      ? "Read a barcode on this page"
      : "Barcode recognition is unavailable in this browser.";
  $("textModal").showModal();
}
function closeText() {
  if (state.ocrBusy) return;
  if (state.editing) {
    delete state.editing.pendingWords;
    delete state.editing.pendingText;
    delete state.editing.pendingConfidence;
    delete state.editing.pendingImage;
  }
  $("textModal").close();
  state.editing = null;
}
$("closeTextBtn").onclick = closeText;
$("textModal").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeText();
});
$("recognizeBtn").onclick = async () => {
  if (state.ocrBusy || !state.editing) return;
  for (const key of [
    "pendingText",
    "pendingWords",
    "pendingConfidence",
    "pendingImage",
  ])
    delete state.editing[key];
  state.ocrBusy = true;
  updateControls();
  $("closeTextBtn").disabled = true;
  $("barcodeBtn").disabled = true;
  $("ocrStatus").textContent = "Downloading text recognition engine…";
  let worker;
  try {
    await loadScript(engines.ocr);
    worker = await Tesseract.createWorker($("ocrLanguage").value, 1, {
      workerPath:
        "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (m) => {
        $("ocrStatus").textContent =
          `${m.status}${m.progress === undefined ? "" : ` ${Math.round(m.progress * 100)}%`}`;
      },
    });
    let recognitionImage = state.editing.image;
    state.editing.pendingImage = null;
    if ($("autoOrient").checked) {
      const img = new Image();
      img.src = recognitionImage;
      await img.decode();
      const preview = imageCanvas(img, 900000);
      let best = { angle: 0, score: -1 },
        baseline = 0;
      for (const angle of [0, 90, 180, 270]) {
        $("ocrStatus").textContent = `Checking text orientation: ${angle}°…`;
        const { data: probe } = await worker.recognize(
          angle ? rotate(preview, angle) : preview,
        );
        const count = probe.text.replace(/\s/g, "").length,
          score = count >= 8 ? probe.confidence * Math.min(1, count / 30) : 0;
        if (angle === 0) baseline = score;
        if (score > best.score) best = { angle, score };
      }
      if (best.angle && best.score > baseline + 5) {
        const corrected = rotate(imageCanvas(img), best.angle);
        recognitionImage = corrected.toDataURL("image/jpeg", 0.95);
        state.editing.pendingImage = {
          image: recognitionImage,
          width: corrected.width,
          height: corrected.height,
          paper:
            best.angle % 180
              ? [state.editing.paper[1], state.editing.paper[0]]
              : state.editing.paper,
        };
      }
    }
    const { data } = await worker.recognize(recognitionImage);
    const proposed = C.identify(data.text);
    state.editing.pendingWords = (data.words || []).map((w) => ({
      text: w.text,
      bbox: w.bbox,
      confidence: w.confidence,
    }));
    state.editing.pendingText = data.text;
    state.editing.pendingConfidence = data.confidence;
    $("recognizedText").value = data.text;
    $("documentType").value = proposed.type;
    $("identifiedFields").value = proposed.fields;
    $("ocrStatus").textContent =
      `Average confidence: ${Math.round(data.confidence)}%. Review all text and suggested fields, then save.`;
  } catch (err) {
    for (const key of [
      "pendingText",
      "pendingWords",
      "pendingConfidence",
      "pendingImage",
    ])
      delete state.editing[key];
    $("ocrStatus").textContent =
      `Recognition failed: ${err.message}. Check your connection for engine/language downloads, then retry.`;
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    state.ocrBusy = false;
    $("closeTextBtn").disabled = false;
    $("barcodeBtn").disabled = !("BarcodeDetector" in window);
    updateControls();
  }
};
$("saveTextBtn").onclick = async () => {
  const p = state.editing;
  if (!p || state.ocrBusy) return;
  const text = $("recognizedText").value;
  // Do not place stale OCR word boxes into the searchable layer after manual corrections.
  if (p.pendingImage) Object.assign(p, p.pendingImage);
  delete p.pendingImage;
  p.words =
    p.pendingText === text ? p.pendingWords : p.text === text ? p.words : [];
  p.confidence = p.pendingConfidence ?? p.confidence;
  p.text = text;
  p.type = $("documentType").value;
  p.fields = $("identifiedFields").value;
  delete p.pendingText;
  delete p.pendingWords;
  delete p.pendingConfidence;
  if ($("filename").value === "JUO_Legacy_Scan" && p.type !== "Document")
    $("filename").value =
      `${p.type.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}`;
  closeText();
  renderPages();
  await persistDraft();
  message(
    "Recognition review saved. Corrected text is included in the text download.",
  );
};
$("barcodeBtn").onclick = async () => {
  if (state.ocrBusy || !state.editing || !("BarcodeDetector" in window)) return;
  state.ocrBusy = true;
  updateControls();
  $("closeTextBtn").disabled = true;
  try {
    const formats = await BarcodeDetector.getSupportedFormats(),
      detector = new BarcodeDetector({ formats }),
      img = new Image();
    img.src = state.editing.image;
    await img.decode();
    const codes = await detector.detect(img);
    $("identifiedFields").value +=
      (codes.length ? "\n" : "") +
      codes.map((c) => `${c.format}: ${c.rawValue}`).join("\n");
    $("ocrStatus").textContent = codes.length
      ? "Code values found. Review and save; links are never opened automatically."
      : "No supported barcode found.";
  } catch (err) {
    $("ocrStatus").textContent = `Could not read barcode: ${err.message}`;
  } finally {
    state.ocrBusy = false;
    $("closeTextBtn").disabled = false;
    updateControls();
  }
};
function filename() {
  return (
    $("filename")
      .value.trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .slice(0, 100) || "JUO_Legacy_Scan"
  );
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$("downloadTextBtn").onclick = () => {
  const text = state.pages
    .map((p, i) => `Page ${i + 1} — ${p.type}\n${p.fields}\n\n${p.text}`)
    .join("\n\n-----\n\n");
  download(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
    filename() + ".txt",
  );
};
$("downloadPdfBtn").onclick = async () => {
  if (state.busy || !state.pages.length) return;
  state.busy = true;
  updateControls();
  try {
    message("Preparing PDF…");
    await loadScript(engines.pdf);
    let pdf;
    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i],
        [pw, ph] = p.paper,
        orientation = pw > ph ? "landscape" : "portrait";
      if (!pdf)
        pdf = new jspdf.jsPDF({
          unit: "mm",
          format: [pw, ph],
          orientation,
          compress: true,
        });
      else pdf.addPage([pw, ph], orientation);
      const box = C.fitImage(p.width, p.height, pw, ph);
      pdf.addImage(
        p.image,
        "JPEG",
        box.x,
        box.y,
        box.width,
        box.height,
        undefined,
        "FAST",
      );
      // Built-in Helvetica supports a limited Latin encoding. Keep other scripts in the UTF-8 text export.
      for (const word of p.words || []) {
        if (!word.text || !/^[\x20-\x7e\u00a0-\u00ff]+$/.test(word.text))
          continue;
        const b = word.bbox;
        if (!b || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
        const height = ((b.y1 - b.y0) / p.height) * box.height,
          width = ((b.x1 - b.x0) / p.width) * box.width;
        pdf.setFontSize(Math.max(1, (height * 72) / 25.4));
        const natural = pdf.getTextWidth(word.text);
        pdf.text(
          word.text,
          box.x + (b.x0 / p.width) * box.width,
          box.y + (b.y1 / p.height) * box.height,
          {
            renderingMode: "invisible",
            horizontalScale: natural ? width / natural : 1,
          },
        );
      }
      message(`Preparing PDF: ${i + 1}/${state.pages.length}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    pdf.setProperties({ title: filename(), creator: "JUO Legacy Scanner" });
    pdf.save(filename() + ".pdf");
    message("PDF downloaded. Your draft is kept until you clear it.");
  } catch (err) {
    error(err);
  } finally {
    state.busy = false;
    updateControls();
  }
};
// IndexedDB stores one replaceable draft. Writes are serialized to avoid stale snapshots winning races.
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("juo-scanner", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("draft");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(Error("Local storage is blocked by another tab."));
  });
}
function dbRequest(mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction("draft", mode),
      request = fn(tx.objectStore("draft"));
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Local save aborted."));
  });
}
function persistDraft() {
  if (!state.db) return Promise.resolve();
  const snapshot = structuredClone({
    pages: state.pages.map(
      ({ pendingWords, pendingText, pendingConfidence, pendingImage, ...p }) =>
        p,
    ),
    filename: $("filename").value,
  });
  state.persist = state.persist
    .catch(() => {})
    .then(() =>
      dbRequest("readwrite", (store) => store.put(snapshot, "current")),
    )
    .then(() => {
      $("storageStatus").textContent =
        "Draft saved on this browser. Clear it when finished on a shared device.";
    })
    .catch((err) => {
      $("storageStatus").textContent =
        `Draft could not be saved: ${err.message}. Export now to avoid losing your pages.`;
    });
  return state.persist;
}
async function restore() {
  try {
    state.db = await openDB();
    const draft = await dbRequest("readonly", (store) => store.get("current"));
    if (draft?.pages?.length) {
      state.pages = draft.pages;
      $("filename").value = draft.filename || "JUO_Legacy_Scan";
      message(`Recovered ${state.pages.length} page(s) from this browser.`);
    }
    state.db.onversionchange = () => state.db.close();
  } catch (err) {
    $("storageStatus").textContent =
      "Local recovery is unavailable. Export before closing this tab.";
  } finally {
    state.restoring = false;
    renderPages();
  }
}
$("filename").onchange = persistDraft;
$("clearBtn").onclick = async () => {
  if (
    state.busy ||
    !confirm(
      "Clear all pages and recognized text from this browser? Export first if you need a copy.",
    )
  )
    return;
  state.pages = [];
  $("filename").value = "JUO_Legacy_Scan";
  renderPages();
  await persistDraft();
  message("Document cleared.");
};
$("startCameraBtn").onclick = startCamera;
$("stopCameraBtn").onclick = stopCamera;
$("captureBtn").onclick = capturePage;
$("qualitySlider").oninput = () =>
  ($("qualityValue").value = $("qualitySlider").value);
$("helpBtn").onclick = () => $("helpModal").showModal();
$("closeHelpBtn").onclick = () => $("helpModal").close();
window.addEventListener("pagehide", stopCamera);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
});
window.addEventListener("beforeunload", (e) => {
  if (state.source) {
    e.preventDefault();
    e.returnValue = "";
  }
});
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.warn("Offline setup failed", err)),
  );
restore();
if (new URLSearchParams(location.search).get("action") === "help")
  $("helpModal").showModal();
