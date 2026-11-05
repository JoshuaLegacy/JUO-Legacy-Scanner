/* Export the saved visible page, never silently regenerate it with different edit settings. */
(function (root) {
  "use strict";
  async function encode(page, format) {
    if (format === "jpeg" && page.image.startsWith("data:image/jpeg;base64,")) {
      const bytes = Uint8Array.from(atob(page.image.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      return new Blob([bytes], { type: "image/jpeg" });
    }
    const img = new Image();
    img.src = page.image;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(
                Error(
                  "Could not encode this image. Try a smaller detail limit.",
                ),
              ),
        format === "png" ? "image/png" : "image/jpeg",
        page.editRecipe?.quality || 0.95,
      ),
    );
  }
  async function save(pages, format, baseName) {
    if (!pages.length) throw Error("Choose at least one saved page.");
    if (pages.length === 1) {
      download(
        await encode(pages[0], format),
        `${baseName}.${format === "png" ? "png" : "jpg"}`,
      );
      return;
    }
    await loadScript("vendor/jszip.min.js");
    const zip = new JSZip();
    for (let i = 0; i < pages.length; i++) {
      zip.file(
        `${baseName}_page_${String(i + 1).padStart(3, "0")}.${format === "png" ? "png" : "jpg"}`,
        await encode(pages[i], format),
      );
      message(
        `Preparing ${format.toUpperCase()} images: ${i + 1}/${pages.length}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    download(
      await zip.generateAsync({ type: "blob", compression: "STORE" }),
      `${baseName}_${format.toUpperCase()}_pages.zip`,
    );
  }
  root.ImageExport = { save, encode };
})(globalThis);
