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
  cropTarget: null,
  cropSourceRotated: false,
};
const engines = {
  pdf: "vendor/jspdf.umd.min.js",
  ocr: "vendor/tesseract.min.js",
  barcode: "vendor/zxing.min.js",
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
function detailLimit() {
  return Math.min(
    24000000,
    Math.max(4000000, Number($("detailLimit").value) * 1000000),
  );
}
function selectedPages() {
  const value = $("exportPages").value;
  return value === "all"
    ? state.pages
    : state.pages.filter((p) => p.id === value);
}
function updateExportOptions() {
  const value = $("exportPages").value;
  $("exportPages").replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All pages";
  $("exportPages").append(all);
  state.pages.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `Page ${i + 1}`;
    $("exportPages").append(o);
  });
  $("exportPages").value =
    value === "all" || state.pages.some((p) => p.id === value) ? value : "all";
  updateExportLabel();
}
function updateExportLabel() {
  const format = $("exportFormat").value;
  $("downloadPdfBtn").textContent =
    format === "pdf"
      ? "Download PDF"
      : `Download ${format.toUpperCase()}${selectedPages().length > 1 ? " ZIP" : ""}`;
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
    blocked ||
    state.starting ||
    !!state.stream ||
    $("cropModal").open ||
    PageEditor.isOpen();
  $("stopCameraBtn").disabled = !state.stream && !state.starting;
  $("captureBtn").disabled =
    blocked ||
    !state.stream ||
    $("preview").readyState < 2 ||
    $("cropModal").open ||
    PageEditor.isOpen();
  $("importFile").disabled =
    blocked || $("cropModal").open || PageEditor.isOpen();
  $("downloadPdfBtn").disabled = blocked || !state.pages.length;
  $("downloadTextBtn").disabled = blocked || !state.pages.some((p) => p.text);
  $("clearBtn").disabled = blocked || !state.pages.length;
  $("confirmCropBtn").disabled =
    state.busy || !state.source || !C.validQuad(state.corners || []);
  $("applyAutoCropBtn").disabled = state.busy || !state.source;
  $("recognizeBtn").disabled = state.ocrBusy || state.busy;
  $("saveTextBtn").disabled = state.ocrBusy;
  $("ocrLanguage").disabled = state.ocrBusy;
  $("prepareOCRBtn").disabled = state.ocrBusy;
  $("removeOCRBtn").disabled = state.ocrBusy;
  $("barcodeBtn").disabled = state.ocrBusy;
  $("cancelOCRBtn").disabled = !state.ocrBusy;
  $("closeTextBtn").disabled = state.ocrBusy;
  $("pageCount").textContent = state.pages.length;
  $("cameraResolution").disabled = blocked || !state.stream || state.starting;
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
    await CameraControls.attach(
      track,
      $("cameraResolution"),
      $("cameraResolutionStatus"),
    );
    if (generation !== cameraGeneration) return;
    await CameraControls.apply(
      track,
      $("cameraResolution").value,
      $("cameraResolutionStatus"),
    );
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
        detection = C.findDocument(im),
        corners = detection?.corners,
        q = C.documentQuality(im, corners),
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
        detection?.confidence >= 0.75 &&
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
    const track = state.stream.getVideoTracks()[0],
      capture = await CameraControls.capture(
        track,
        $("preview"),
        $("cameraResolution").value,
        detailLimit(),
      );
    if (track.readyState === "ended") return;
    stopCamera();
    openCrop(capture.canvas);
    $("cropAdvice").textContent += ` ${capture.description}`;
  } catch (err) {
    error(err);
  } finally {
    state.busy = false;
    updateControls();
  }
}
function detectCorners() {
  const { data, scale } = sample(state.source, 600),
    detection = C.findDocument(data);
  state.detection = detection;
  state.corners = detection
    ? detection.corners.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    : C.fullCorners(state.source.width, state.source.height);
  $("cropAdvice").textContent = detection
    ? `Page detected. ${detection.confidence >= 0.75 ? "Strong boundary match." : "Check the boundary carefully."} Adjust any corner if needed.`
    : "Could not confidently detect all four page boundaries. Adjust the corners manually.";
  drawCrop();
}
function openCrop(canvas) {
  state.cropTarget = null;
  state.cropSourceRotated = false;
  $("cropTitle").textContent = "Adjust document edges";
  $("confirmCropBtn").textContent = "Add page";
  state.source = canvas;
  $("topCurve").value = 0;
  $("bottomCurve").value = 0;
  $("topCurveValue").value = "0%";
  $("bottomCurveValue").value = "0%";
  $("bookEnabled").checked = false;
  $("bookControls").open = false;
  $("cropModal").showModal();
  detectCorners();
  const { data } = sample(canvas);
  const warnings = C.documentQuality(data, C.detectDocument(data)).warnings;
  if (warnings.length) $("cropAdvice").textContent += " " + warnings.join(" ");
  updateControls();
  const source = state.source;
  requestAnimationFrame(() => {
    if (
      $("autoCrop").checked &&
      state.source === source &&
      state.cropTarget !== "editor" &&
      !state.busy &&
      state.detection?.confidence >= 0.75 &&
      $("cropModal").open
    )
      $("confirmCropBtn").click();
  });
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
  if ($("bookControls").open) queueBookPreview();
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
  state.cropTarget = null;
  state.cropSourceRotated = false;
  $("cropTitle").textContent = "Adjust document edges";
  $("confirmCropBtn").textContent = "Add page";
  updateControls();
}
$("cropModal").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeCrop();
});
$("applyAutoCropBtn").onclick = () => {
  if (state.busy || !state.source) return;
  detectCorners();
  if (state.detection?.confidence >= 0.75) $("confirmCropBtn").click();
  else
    $("cropAdvice").textContent =
      "Automatic crop was not confident enough. Check and adjust the four corners, then accept the crop.";
};
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
  state.cropSourceRotated = true;
  state.corners = C.fullCorners(state.source.width, state.source.height);
  drawCrop();
};
let bookTimer;
function queueBookPreview() {
  clearTimeout(bookTimer);
  bookTimer = setTimeout(() => {
    if (!state.source || !C.validQuad(state.corners)) return;
    try {
      const { data, scale } = sample(state.source, 700),
        corners = state.corners.map((p) => ({
          x: p.x / scale,
          y: p.y / scale,
        }));
      let out = C.warp(data, corners, 350000);
      if ($("bookEnabled").checked)
        out = C.flattenBook(
          out,
          Number($("topCurve").value) / 100,
          Number($("bottomCurve").value) / 100,
        );
      const c = $("bookPreview");
      c.width = out.width;
      c.height = out.height;
      c.getContext("2d").putImageData(
        new ImageData(out.data, out.width, out.height),
        0,
        0,
      );
    } catch (err) {
      $("cropAdvice").textContent = err.message;
    }
  }, 80);
}
$("bookEnabled").onchange = queueBookPreview;
$("bookControls").ontoggle = () => {
  if ($("bookControls").open) queueBookPreview();
};
for (const edge of ["top", "bottom"])
  $(edge + "Curve").oninput = () => {
    $(edge + "CurveValue").value = $(edge + "Curve").value + "%";
    $("bookEnabled").checked = true;
    queueBookPreview();
  };
$("cancelCropBtn").onclick = closeCrop;
$("confirmCropBtn").onclick = async () => {
  if (state.cropTarget === "editor") {
    PageEditor.acceptCrop();
    return;
  }
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
      detailLimit(),
    );
    if ($("bookEnabled").checked)
      im = C.flattenBook(
        im,
        Number($("topCurve").value) / 100,
        Number($("bottomCurve").value) / 100,
        detailLimit(),
      );
    im = C.adjustTone(
      C.enhance(im, $("enhancement").value),
      Number($("brightness").value),
      Number($("contrast").value),
    );
    let canvas = makeCanvas(im.width, im.height);
    canvas
      .getContext("2d")
      .putImageData(new ImageData(im.data, im.width, im.height), 0, 0);
    if ($("deskew").checked) {
      const angle = C.skewAngle(sample(canvas, 600).data);
      if (angle) canvas = rotate(canvas, angle);
    }
    canvas = imageCanvas(canvas, detailLimit());
    const size = C.outputSize(
      canvas.width,
      canvas.height,
      $("pageFormat").value,
      Number($("dpiSelect").value),
      detailLimit(),
    );
    const out = makeCanvas(size.width, size.height);
    out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
    const page = {
      id: crypto.randomUUID(),
      image: out.toDataURL("image/jpeg", Number($("qualitySlider").value)),
      sourceImage: state.source.toDataURL("image/jpeg", 0.95),
      sourceWidth: state.source.width,
      sourceHeight: state.source.height,
      editRecipe: {
        corners: structuredClone(state.corners),
        rotation: 0,
        mode: $("enhancement").value,
        deskew: $("deskew").checked,
        book: $("bookEnabled").checked,
        topCurve: Number($("topCurve").value) / 100,
        bottomCurve: Number($("bottomCurve").value) / 100,
        format: $("pageFormat").value,
        dpi: Number($("dpiSelect").value),
        quality: Number($("qualitySlider").value),
        maxPixels: detailLimit(),
        brightness: Number($("brightness").value),
        contrast: Number($("contrast").value),
      },
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
    openCrop(imageCanvas(img, detailLimit()));
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
    title.id = `page-title-${page.id}`;
    card.setAttribute("aria-labelledby", title.id);
    title.textContent = `Page ${index + 1} · ${page.type}${page.ocrStale ? " · text needs review" : page.text ? " · text reviewed" : ""} · ${page.width} × ${page.height} (${((page.width * page.height) / 1000000).toFixed(1)} MP)`;
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
    button("Edit / Retake", () => PageEditor.open(page));
    button("Text / identify", () => openText(page));
    button("Undo edit", () => PageEditor.undo(page), !page.undo);
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
    button("Rotate", () => PageEditor.rotateShortcut(page));
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
  updateExportOptions();
  updateControls();
}
function openText(page) {
  if (state.busy) return;
  state.editing = page;
  $("recognizedText").value = page.text;
  $("documentType").value = page.type;
  $("identifiedFields").value = page.fields;
  $("retainedReview").hidden = !page.priorReview;
  $("retainedText").value = page.priorReview
    ? `${page.priorReview.text}\n\n${page.priorReview.fields}`
    : "";
  $("confirmEditedReviewLabel").hidden = !page.ocrStale;
  $("confirmEditedReview").checked = false;
  $("ocrStatus").textContent =
    page.confidence === null
      ? "Review recognition before relying on it."
      : `Average OCR confidence: ${Math.round(page.confidence)}%. Check names, dates and amounts.`;
  if (page.ocrStale)
    $("ocrStatus").textContent =
      "The image changed. Retained text and fields need recognition again or explicit review before they return to PDF search.";
  $("barcodeBtn").disabled = false;
  updatePackStatus();
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
let packGeneration = 0,
  operation = null;
async function updatePackStatus() {
  const generation = ++packGeneration;
  try {
    const info = await OfflineOCR.status($("ocrLanguage").value);
    if (generation !== packGeneration) return;
    $("packStatus").textContent = info.ready
      ? "Language downloaded and ready for offline OCR."
      : `Language not downloaded. Download size including shared engine: ${(info.bytes / 1048576).toFixed(1)} MB.`;
    $("removeOCRBtn").disabled = state.ocrBusy || !info.ready;
  } catch (err) {
    if (generation === packGeneration)
      $("packStatus").textContent = err.message;
  }
}
$("ocrLanguage").onchange = updatePackStatus;
function beginOperation() {
  const controller = new AbortController();
  let reject;
  const cancelled = new Promise((_, r) => (reject = r));
  cancelled.catch(() => {});
  const op = { controller, cancelled, reject, worker: null };
  operation = op;
  state.ocrBusy = true;
  updateControls();
  return op;
}
function checkOperation(op) {
  op.controller.signal.throwIfAborted();
}
async function endOperation(op) {
  if (op.worker) await op.worker.terminate().catch(() => {});
  if (operation === op) {
    operation = null;
    state.ocrBusy = false;
    updateControls();
    await updatePackStatus();
  }
}
$("cancelOCRBtn").onclick = () => {
  if (!operation) return;
  operation.controller.abort();
  operation.reject(Error("Operation cancelled."));
  operation.worker?.terminate().catch(() => {});
};
function packProgress(done, total) {
  $("packStatus").textContent =
    `Downloading language: ${Math.round((done / total) * 100)}% (${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)`;
}
$("prepareOCRBtn").onclick = async () => {
  if (state.ocrBusy) return;
  const op = beginOperation();
  try {
    await Promise.race([
      OfflineOCR.prepare($("ocrLanguage").value, {
        signal: op.controller.signal,
        onProgress: packProgress,
      }),
      op.cancelled,
    ]);
    $("ocrStatus").textContent =
      "Language verified and saved. You can recognize pages offline.";
  } catch (err) {
    $("ocrStatus").textContent = op.controller.signal.aborted
      ? "Download cancelled. Completed shared assets are kept for retry."
      : err.message;
  } finally {
    await endOperation(op);
  }
};
$("removeOCRBtn").onclick = async () => {
  if (state.ocrBusy) return;
  try {
    await OfflineOCR.remove($("ocrLanguage").value);
    await updatePackStatus();
  } catch (err) {
    $("packStatus").textContent = err.message;
  }
};
$("recognizeBtn").onclick = async () => {
  if (state.ocrBusy || !state.editing) return;
  for (const key of [
    "pendingText",
    "pendingWords",
    "pendingConfidence",
    "pendingImage",
  ])
    delete state.editing[key];
  const op = beginOperation();
  $("ocrStatus").textContent = "Preparing text recognition…";
  let worker;
  try {
    const options = await Promise.race([
      OfflineOCR.prepare($("ocrLanguage").value, {
        signal: op.controller.signal,
        onProgress: packProgress,
      }),
      op.cancelled,
    ]);
    checkOperation(op);
    await Promise.race([loadScript(engines.ocr), op.cancelled]);
    checkOperation(op);
    const workerPromise = Tesseract.createWorker($("ocrLanguage").value, 1, {
      ...options,
      errorHandler: (e) => op.reject(Error(String(e))),
      logger: (m) => {
        if (operation === op && !op.controller.signal.aborted)
          $("ocrStatus").textContent =
            `${m.status}${m.progress === undefined ? "" : ` ${Math.round(m.progress * 100)}%`}`;
      },
    });
    workerPromise
      .then((w) => {
        if (op.controller.signal.aborted) w.terminate().catch(() => {});
        else op.worker = w;
      })
      .catch(() => {});
    worker = await Promise.race([workerPromise, op.cancelled]);
    checkOperation(op);
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
        const { data: probe } = await Promise.race([
          worker.recognize(angle ? rotate(preview, angle) : preview),
          op.cancelled,
        ]);
        checkOperation(op);
        const count = probe.text.replace(/\s/g, "").length,
          score = count >= 8 ? probe.confidence * Math.min(1, count / 30) : 0;
        if (angle === 0) baseline = score;
        if (score > best.score) best = { angle, score };
      }
      if (best.angle && best.score > baseline + 5) {
        const corrected = rotate(
          imageCanvas(
            img,
            state.editing.editRecipe?.maxPixels ||
              Math.min(24000000, img.width * img.height),
          ),
          best.angle,
        );
        recognitionImage = corrected.toDataURL("image/jpeg", 0.95);
        state.editing.pendingImage = {
          image: recognitionImage,
          editRecipe: state.editing.editRecipe
            ? {
                ...structuredClone(state.editing.editRecipe),
                rotation:
                  ((state.editing.editRecipe.rotation || 0) + best.angle) % 360,
              }
            : undefined,
          width: corrected.width,
          height: corrected.height,
          paper:
            best.angle % 180
              ? [state.editing.paper[1], state.editing.paper[0]]
              : state.editing.paper,
        };
      }
    }
    const { data } = await Promise.race([
      worker.recognize(recognitionImage),
      op.cancelled,
    ]);
    checkOperation(op);
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
    $("ocrStatus").textContent = op.controller.signal.aborted
      ? "Recognition cancelled. Your saved page and text are unchanged."
      : `Recognition failed: ${err.message || String(err)}. Check the downloaded language status and retry.`;
  } finally {
    await endOperation(op);
  }
};
$("saveTextBtn").onclick = async () => {
  const p = state.editing;
  if (!p || state.ocrBusy) return;
  const text = $("recognizedText").value;
  if (
    p.ocrStale &&
    p.pendingText === undefined &&
    !$("confirmEditedReview").checked
  ) {
    $("ocrStatus").textContent =
      "Check the review confirmation after comparing this text and its fields with the edited page, or recognize text again.";
    return;
  }
  // Do not place stale OCR word boxes into the searchable layer after manual corrections.
  if (p.pendingImage) Object.assign(p, p.pendingImage);
  delete p.pendingImage;
  if (p.pendingText !== undefined) {
    p.ocrText = p.pendingText;
    p.words = p.pendingWords || [];
  } else if (!p.ocrText && p.words?.length) p.ocrText = p.text;
  if (p.text !== text && p.pendingText === undefined && !p.ocrText)
    p.words = [];
  p.confidence = p.pendingConfidence ?? p.confidence;
  p.text = text;
  p.ocrStale = false;
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
    "Recognition review saved. Your reviewed text is included in PDF search and text download.",
  );
};
$("barcodeBtn").onclick = async () => {
  if (state.ocrBusy || !state.editing) return;
  const op = beginOperation();
  try {
    const img = new Image();
    img.src = state.editing.image;
    await img.decode();
    checkOperation(op);
    let codes = [];
    if ("BarcodeDetector" in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        codes = await new BarcodeDetector({ formats }).detect(img);
      } catch {
        /* Use the portable decoder below. */
      }
    }
    if (!codes.length) {
      await Promise.race([loadScript(engines.barcode), op.cancelled]);
      checkOperation(op);
      const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]),
        reader = new ZXing.MultiFormatReader();
      for (const angle of [0, 90, 180, 270]) {
        checkOperation(op);
        const canvas = angle
          ? rotate(imageCanvas(img), angle)
          : imageCanvas(img);
        try {
          const result = reader.decode(
            new ZXing.BinaryBitmap(
              new ZXing.HybridBinarizer(
                new ZXing.HTMLCanvasElementLuminanceSource(canvas),
              ),
            ),
            hints,
          );
          codes = [
            {
              format: ZXing.BarcodeFormat[result.getBarcodeFormat()],
              rawValue: result.getText(),
            },
          ];
          break;
        } catch (err) {
          if (
            !(err instanceof ZXing.NotFoundException) &&
            !(err instanceof ZXing.ChecksumException) &&
            !(err instanceof ZXing.FormatException)
          )
            throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    checkOperation(op);
    $("identifiedFields").value +=
      (codes.length ? "\n" : "") +
      codes.map((c) => `${c.format}: ${c.rawValue}`).join("\n");
    $("ocrStatus").textContent = codes.length
      ? "Code values found. Review and save; links are never opened automatically."
      : "No supported QR or barcode found. Try a clearer, closer scan.";
  } catch (err) {
    $("ocrStatus").textContent = `Could not read barcode: ${err.message}`;
  } finally {
    await endOperation(op);
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
    .map(
      (p, i) =>
        `Page ${i + 1} — ${p.type}${p.ocrStale ? " (retained text — needs review after image edit)" : ""}\n${p.fields}\n\n${p.text}`,
    )
    .join("\n\n-----\n\n");
  download(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
    filename() + ".txt",
  );
};
$("downloadPdfBtn").onclick = async () => {
  if (state.busy || !state.pages.length) return;
  const pages = selectedPages(),
    format = $("exportFormat").value;
  if (!pages.length) return;
  state.busy = true;
  updateControls();
  try {
    if (format !== "pdf") {
      await ImageExport.save(pages, format, filename());
      message(
        `${format.toUpperCase()} export downloaded. Your draft is kept until you clear it.`,
      );
      return;
    }
    message("Preparing PDF…");
    await loadScript(engines.pdf);
    let pdf;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i],
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
      PDFText.addSearchText(pdf, p, box);
      message(`Preparing PDF: ${i + 1}/${pages.length}`);
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
  if (!state.db) return Promise.resolve(false);
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
      return true;
    })
    .catch((err) => {
      $("storageStatus").textContent =
        `Draft could not be saved: ${err.message}. Export now to avoid losing your pages.`;
      return false;
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
$("exportFormat").onchange = updateExportLabel;
$("exportPages").onchange = updateExportLabel;
for (const id of ["brightness", "contrast"])
  $(id).oninput = () => ($(id + "Value").value = $(id).value);
$("cameraResolution").onchange = async () => {
  if (!state.stream || state.busy || state.starting) return;
  state.busy = true;
  updateControls();
  try {
    const pixels = await CameraControls.apply(
      state.stream.getVideoTracks()[0],
      $("cameraResolution").value,
      $("cameraResolutionStatus"),
    );
    if ($("cameraResolution").value !== "auto") {
      const mp = [4, 8, 12, 24].find((n) => n * 1000000 >= pixels) || 24;
      $("detailLimit").value = String(mp);
      $("dpiSelect").value = "0";
    }
  } catch (err) {
    message(err.message);
  } finally {
    state.busy = false;
    updateControls();
  }
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
  if (state.source || PageEditor.hasChanges()) {
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
PageEditor.init();
restore();
if (new URLSearchParams(location.search).get("action") === "help")
  $("helpModal").showModal();
