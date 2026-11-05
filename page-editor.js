/* Preview-first page editing. No saved page is mutated until the user chooses Save. */
(function (root) {
  "use strict";
  let session = null,
    generation = 0,
    previewTimer,
    retakeStream = null,
    retakeGeneration = 0,
    retakeStarting = false;
  const byId = (id) => document.getElementById(id);
  function isOpen() {
    return !!session;
  }
  function hasChanges() {
    return (
      !!session &&
      (session.replaced ||
        JSON.stringify(session.recipe) !== session.initialRecipe)
    );
  }
  function update() {
    const busy = !session || state.busy || session.rendering,
      retaking = retakeStarting || !!retakeStream;
    for (const id of [
      "editorCropBtn",
      "editorRotateBtn",
      "editorEnhancement",
      "editorDeskew",
      "editorReplaceFile",
      "editorRetakeBtn",
      "editorDetailLimit",
      "editorDpi",
      "editorBrightness",
      "editorContrast",
    ])
      byId(id).disabled = busy || retaking;
    byId("savePageEditBtn").disabled =
      busy || retaking || !hasChanges() || !session?.result;
    byId("cancelPageEditBtn").disabled = state.busy;
    byId("editorCameraResolution").disabled =
      state.busy || !retakeStream || retakeStarting;
    byId("captureRetakeBtn").disabled =
      state.busy || !retakeStream || byId("editorVideo").readyState < 2;
    byId("cancelRetakeBtn").disabled = state.busy;
    byId("editorReplaceLabel").disabled = byId("editorReplaceFile").disabled;
    byId("editorReplaceLabel").setAttribute(
      "aria-disabled",
      String(byId("editorReplaceFile").disabled),
    );
  }
  function stopRetake() {
    retakeGeneration++;
    retakeStarting = false;
    retakeStream?.getTracks().forEach((t) => t.stop());
    retakeStream = null;
    byId("editorVideo").srcObject = null;
    byId("editorCameraPanel").hidden = true;
    byId("editorCameraResolution").disabled = true;
    byId("editorPreview").hidden = false;
    update();
  }
  async function open(page) {
    if (state.busy || state.ocrBusy || session) return false;
    stopCamera();
    state.busy = true;
    updateControls();
    try {
      const img = new Image();
      img.src = page.sourceImage || page.image;
      await img.decode();
      const source = imageCanvas(
          img,
          page.editRecipe?.maxPixels ||
            Math.min(24000000, img.width * img.height),
        ),
        recipe = PageEdits.recipe(page, source.width, source.height);
      session = {
        pageId: page.id,
        source,
        sourceImage: page.sourceImage || page.image,
        recipe,
        initialRecipe: JSON.stringify(recipe),
        replaced: false,
        result: {
          image: page.image,
          width: page.width,
          height: page.height,
          paper: page.paper,
        },
        rendering: false,
      };
      byId("pageEditTitle").textContent =
        `Edit page ${state.pages.findIndex((p) => p.id === page.id) + 1}`;
      byId("editorPreview").src = page.image;
      byId("editorEnhancement").value = recipe.mode;
      byId("editorDeskew").checked = recipe.deskew;
      byId("editorDetailLimit").value = String(
        (recipe.maxPixels || 4000000) / 1000000,
      );
      byId("editorDpi").value = String(recipe.dpi);
      for (const id of ["Brightness", "Contrast"]) {
        byId("editor" + id).value = recipe[id.toLowerCase()] || 0;
        byId("editor" + id + "Value").value = byId("editor" + id).value;
      }
      byId("editorNotice").textContent = page.sourceImage
        ? "Edits use the retained source image. Save changes when the preview looks right."
        : "This older page starts from its saved image. Detail or colors removed previously cannot be recovered.";
      byId("editorNotice").textContent +=
        ` Source: ${source.width} × ${source.height} (${((source.width * source.height) / 1000000).toFixed(1)} MP). Higher limits cannot recreate detail missing from this source.`;
      byId("editorStatus").textContent =
        "Your saved page stays unchanged until you choose Save changes.";
      byId("pageEditor").showModal();
      return true;
    } catch (err) {
      error(err);
      return false;
    } finally {
      state.busy = false;
      updateControls();
      update();
    }
  }
  function close(force = false) {
    if (state.busy || !session) return;
    if (
      !force &&
      hasChanges() &&
      !confirm("Discard the unsaved changes to this page?")
    )
      return;
    stopRetake();
    clearTimeout(previewTimer);
    generation++;
    byId("pageEditor").close();
    session = null;
    byId("editorPreview").removeAttribute("src");
    updateControls();
  }
  async function process(source, recipe) {
    let im = ScanCore.warp(
      source.getContext("2d").getImageData(0, 0, source.width, source.height),
      recipe.corners,
      recipe.maxPixels || 4000000,
    );
    if (recipe.book)
      im = ScanCore.flattenBook(
        im,
        recipe.topCurve,
        recipe.bottomCurve,
        recipe.maxPixels || 4000000,
      );
    im = ScanCore.adjustTone(
      ScanCore.enhance(im, recipe.mode),
      recipe.brightness || 0,
      recipe.contrast || 0,
    );
    let canvas = makeCanvas(im.width, im.height);
    canvas
      .getContext("2d")
      .putImageData(new ImageData(im.data, im.width, im.height), 0, 0);
    if (recipe.rotation) canvas = rotate(canvas, recipe.rotation);
    if (recipe.deskew) {
      const angle = ScanCore.skewAngle(sample(canvas, 600).data);
      if (angle) canvas = rotate(canvas, angle);
    }
    canvas = imageCanvas(canvas, recipe.maxPixels || 4000000);
    const size = ScanCore.outputSize(
        canvas.width,
        canvas.height,
        recipe.format,
        recipe.dpi,
        recipe.maxPixels || 4000000,
      ),
      out = makeCanvas(size.width, size.height);
    out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
    return {
      image: out.toDataURL("image/jpeg", recipe.quality),
      width: out.width,
      height: out.height,
      paper: size.paper,
    };
  }
  function schedulePreview() {
    if (!session) return;
    clearTimeout(previewTimer);
    const token = ++generation;
    session.rendering = true;
    session.result = null;
    byId("editorStatus").textContent = "Preparing edited preview…";
    update();
    previewTimer = setTimeout(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (!session || token !== generation) return;
      try {
        const result = await process(session.source, session.recipe);
        if (!session || token !== generation) return;
        byId("editorPreview").src = result.image;
        await byId("editorPreview").decode();
        if (!session || token !== generation) return;
        session.result = result;
        byId("editorStatus").textContent =
          "Preview ready. Save to replace this page, or Cancel to keep the saved version.";
      } catch (err) {
        byId("editorStatus").textContent =
          `Could not prepare the edit: ${err.message}`;
      } finally {
        if (session && token === generation) {
          session.rendering = false;
          update();
        }
      }
    }, 120);
  }
  async function rotateShortcut(page) {
    if (await open(page)) rotatePreview();
  }
  function rotatePreview() {
    if (!session || state.busy || retakeStream || retakeStarting) return;
    session.recipe.rotation = (session.recipe.rotation + 90) % 360;
    schedulePreview();
  }
  function crop() {
    if (!session || session.rendering || state.busy) return;
    openCrop(imageCanvas(session.source, session.recipe.maxPixels || 4000000));
    state.cropTarget = "editor";
    state.corners = structuredClone(session.recipe.corners);
    byId("cropTitle").textContent = "Adjust saved page crop";
    byId("confirmCropBtn").textContent = "Use this crop";
    byId("bookEnabled").checked = session.recipe.book;
    byId("topCurve").value = session.recipe.topCurve * 100;
    byId("bottomCurve").value = session.recipe.bottomCurve * 100;
    byId("topCurveValue").value = byId("topCurve").value + "%";
    byId("bottomCurveValue").value = byId("bottomCurve").value + "%";
    byId("bookControls").open = session.recipe.book;
    drawCrop();
  }
  function acceptCrop() {
    if (
      !session ||
      state.busy ||
      !state.source ||
      !ScanCore.validQuad(state.corners)
    )
      return;
    // A rotate in the crop dialog changes the source itself; it is still only a temporary edit.
    if (
      state.source.width !== session.source.width ||
      state.source.height !== session.source.height ||
      state.cropSourceRotated
    ) {
      session.source = state.source;
      session.sourceImage = null;
      session.replaced = true;
    }
    session.recipe.corners = structuredClone(state.corners);
    session.recipe.book = byId("bookEnabled").checked;
    session.recipe.topCurve = Number(byId("topCurve").value) / 100;
    session.recipe.bottomCurve = Number(byId("bottomCurve").value) / 100;
    closeCrop();
    schedulePreview();
  }
  function replaceSource(canvas) {
    if (!session) return;
    session.source = canvas;
    session.sourceImage = null;
    session.replaced = true;
    const { data, scale } = sample(canvas, 480),
      corners = ScanCore.detectDocument(data);
    session.recipe.corners = corners
      ? corners.map((p) => ({ x: p.x * scale, y: p.y * scale }))
      : ScanCore.fullCorners(canvas.width, canvas.height);
    session.recipe.rotation = 0;
    session.recipe.book = false;
    session.recipe.topCurve = 0;
    session.recipe.bottomCurve = 0;
    schedulePreview();
  }
  async function retake() {
    if (!session || state.busy || retakeStarting || retakeStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      byId("editorStatus").textContent =
        "Camera access requires HTTPS and a supported browser. Use Replace from photo instead.";
      return;
    }
    const token = ++retakeGeneration;
    retakeStarting = true;
    byId("editorCameraPanel").hidden = false;
    byId("editorPreview").hidden = true;
    byId("editorStatus").textContent =
      "Starting camera for a replacement. Your saved page is still safe.";
    update();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      if (token !== retakeGeneration || !session) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      retakeStream = stream;
      const track = stream.getVideoTracks()[0],
        caps = track.getCapabilities?.();
      if (caps?.focusMode?.includes("continuous"))
        await track
          .applyConstraints({ advanced: [{ focusMode: "continuous" }] })
          .catch(() => {});
      if (token !== retakeGeneration || !session) return;
      await CameraControls.attach(
        track,
        byId("editorCameraResolution"),
        byId("editorResolutionStatus"),
      );
      if (token !== retakeGeneration || !session) return;
      await CameraControls.apply(
        track,
        byId("editorCameraResolution").value,
        byId("editorResolutionStatus"),
      );
      if (token !== retakeGeneration || !session) return;
      byId("editorVideo").srcObject = stream;
      await byId("editorVideo").play();
      if (token !== retakeGeneration || !session) return;
      byId("editorStatus").textContent =
        "Capture a replacement, then review and save it.";
    } catch (err) {
      if (token === retakeGeneration) {
        stopRetake();
        byId("editorStatus").textContent =
          `Could not start retake: ${err.message}. Your saved page was not changed.`;
      }
    } finally {
      if (token === retakeGeneration) retakeStarting = false;
      update();
    }
  }
  async function captureReplacement() {
    if (
      !session ||
      !retakeStream ||
      byId("editorVideo").readyState < 2 ||
      state.busy
    )
      return;
    state.busy = true;
    update();
    try {
      const capture = await CameraControls.capture(
        retakeStream.getVideoTracks()[0],
        byId("editorVideo"),
        byId("editorCameraResolution").value,
        session.recipe.maxPixels || 4000000,
      );
      stopRetake();
      replaceSource(capture.canvas);
    } catch (err) {
      byId("editorStatus").textContent = err.message;
    } finally {
      state.busy = false;
      update();
    }
  }
  async function replaceFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file || !session || state.busy) return;
    if (file.size > 30 * 1024 * 1024) {
      byId("editorStatus").textContent = "Choose an image smaller than 30 MB.";
      return;
    }
    const url = URL.createObjectURL(file);
    state.busy = true;
    updateControls();
    update();
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (
        img.width * img.height > 40000000 ||
        Math.min(img.width, img.height) < 4
      )
        throw Error(
          "Choose an image between 4 pixels per side and 40 megapixels.",
        );
      replaceSource(imageCanvas(img, session.recipe.maxPixels || 4000000));
    } catch (err) {
      byId("editorStatus").textContent =
        `Could not open replacement: ${err.message}. Your saved page was not changed.`;
    } finally {
      URL.revokeObjectURL(url);
      state.busy = false;
      updateControls();
      update();
    }
  }
  async function save() {
    if (
      !session ||
      session.rendering ||
      state.busy ||
      retakeStream ||
      retakeStarting ||
      !session.result ||
      !hasChanges()
    )
      return;
    const index = state.pages.findIndex((p) => p.id === session.pageId);
    if (index < 0) {
      byId("editorStatus").textContent =
        "This page is no longer in the document.";
      return;
    }
    state.busy = true;
    updateControls();
    update();
    try {
      const sourceImage =
          session.sourceImage || session.source.toDataURL("image/jpeg", 0.95),
        changes = {
          ...session.result,
          sourceImage,
          sourceWidth: session.source.width,
          sourceHeight: session.source.height,
          editRecipe: structuredClone(session.recipe),
        };
      state.pages[index] = PageEdits.commit(state.pages[index], changes);
      const saved = await persistDraft();
      state.busy = false;
      close(true);
      renderPages();
      message(
        "Page updated in its original position. Undo edit restores its previous version." +
          (state.pages[index].ocrStale
            ? " Retained text needs review before it returns to PDF search."
            : "") +
          (!saved
            ? " Local recovery could not be saved. Export before closing this tab."
            : ""),
      );
    } catch (err) {
      byId("editorStatus").textContent =
        `Could not save the edit: ${err.message}`;
    } finally {
      state.busy = false;
      updateControls();
      update();
    }
  }
  async function undo(page) {
    if (state.busy || session || !page.undo) return;
    const index = state.pages.findIndex((p) => p.id === page.id);
    if (index < 0) return;
    state.pages[index] = PageEdits.undo(page);
    renderPages();
    await persistDraft();
    message("Last image edit undone.");
  }
  function init() {
    for (const [id, key] of [
      ["editorDetailLimit", "maxPixels"],
      ["editorDpi", "dpi"],
    ])
      byId(id).onchange = () => {
        if (!session) return;
        session.recipe[key] =
          Number(byId(id).value) * (key === "maxPixels" ? 1000000 : 1);
        schedulePreview();
      };
    for (const label of ["Brightness", "Contrast"])
      byId("editor" + label).oninput = () => {
        if (!session) return;
        session.recipe[label.toLowerCase()] = Number(
          byId("editor" + label).value,
        );
        byId("editor" + label + "Value").value = byId("editor" + label).value;
        schedulePreview();
      };
    byId("editorCameraResolution").onchange = async () => {
      if (!retakeStream || state.busy) return;
      state.busy = true;
      update();
      try {
        const pixels = await CameraControls.apply(
          retakeStream.getVideoTracks()[0],
          byId("editorCameraResolution").value,
          byId("editorResolutionStatus"),
        );
        const mp = [4, 8, 12, 24].find((n) => n * 1000000 >= pixels) || 24;
        session.recipe.maxPixels = mp * 1000000;
        byId("editorDetailLimit").value = String(mp);
        session.recipe.dpi = 0;
        byId("editorDpi").value = "0";
      } catch (err) {
        byId("editorStatus").textContent = err.message;
      } finally {
        state.busy = false;
        update();
      }
    };
    byId("editorCropBtn").onclick = crop;
    byId("editorRotateBtn").onclick = rotatePreview;
    byId("savePageEditBtn").onclick = save;
    byId("cancelPageEditBtn").onclick = () => close();
    byId("editorEnhancement").onchange = () => {
      if (!session) return;
      session.recipe.mode = byId("editorEnhancement").value;
      schedulePreview();
    };
    byId("editorDeskew").onchange = () => {
      if (!session) return;
      session.recipe.deskew = byId("editorDeskew").checked;
      schedulePreview();
    };
    byId("editorRetakeBtn").onclick = retake;
    byId("captureRetakeBtn").onclick = captureReplacement;
    byId("cancelRetakeBtn").onclick = () => {
      stopRetake();
      byId("editorStatus").textContent =
        "Retake cancelled. The previous preview and saved page are unchanged.";
    };
    byId("editorReplaceLabel").onclick = () => {
      if (!byId("editorReplaceFile").disabled)
        byId("editorReplaceFile").click();
    };
    byId("editorVideo").addEventListener("loadeddata", update);
    byId("editorReplaceFile").onchange = replaceFile;
    byId("pageEditor").addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    window.addEventListener("pagehide", stopRetake);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopRetake();
    });
  }
  root.PageEditor = {
    init,
    open,
    isOpen,
    hasChanges,
    update,
    acceptCrop,
    rotateShortcut,
    undo,
  };
})(globalThis);
