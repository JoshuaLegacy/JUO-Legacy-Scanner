/* Saved-page transactions: a single undo version, with OCR review kept separate from image geometry. */
(function (root) {
  "use strict";
  function snapshot(page) {
    const out = {};
    for (const [key, value] of Object.entries(page))
      if (key !== "undo" && !key.startsWith("pending"))
        out[key] = structuredClone(value);
    return out;
  }
  function commit(page, changes) {
    if (
      !changes.image ||
      !Number.isFinite(changes.width) ||
      !Number.isFinite(changes.height) ||
      changes.width < 2 ||
      changes.height < 2
    )
      throw Error("The edited page is not ready.");
    const before = snapshot(page),
      hasReview = !!(page.text || page.fields || page.words?.length);
    const priorReview = page.ocrStale
      ? page.priorReview
      : hasReview
        ? {
            text: page.text || "",
            fields: page.fields || "",
            type: page.type || "Document",
          }
        : page.priorReview;
    return {
      ...before,
      ...changes,
      id: page.id,
      words: [],
      ocrText: "",
      confidence: null,
      ocrStale: hasReview,
      priorReview,
      undo: before,
    };
  }
  function undo(page) {
    return page.undo ? snapshot(page.undo) : null;
  }
  function paperFormat(page) {
    const [w, h] = [...(page.paper || [210, 297])].sort((a, b) => a - b);
    return Math.abs(w - 297) < 1 && Math.abs(h - 420) < 1
      ? "A3"
      : Math.abs(w - 215.9) < 1 && Math.abs(h - 279.4) < 1
        ? "LETTER"
        : "A4";
  }
  function recipe(page, width, height) {
    return page.editRecipe
      ? structuredClone(page.editRecipe)
      : {
          corners: [
            { x: 0, y: 0 },
            { x: width - 1, y: 0 },
            { x: width - 1, y: height - 1 },
            { x: 0, y: height - 1 },
          ],
          rotation: 0,
          mode: "original",
          deskew: false,
          book: false,
          topCurve: 0,
          bottomCurve: 0,
          format: paperFormat(page),
          dpi: page.dpi || 300,
          quality: page.quality || 0.85,
          brightness: 0,
          contrast: 0,
          maxPixels: 4000000,
        };
  }
  const api = { snapshot, commit, undo, paperFormat, recipe };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PageEdits = api;
})(globalThis);
