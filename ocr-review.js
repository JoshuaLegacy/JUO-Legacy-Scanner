/* Candidate comparison and uncertain-word inspection; no automatic spelling corrections. */
(function (root) {
  "use strict";
  let candidates = [],
    current = -1,
    source = "",
    generation = 0;
  const $ = (id) => document.getElementById(id);
  function reset() {
    candidates = [];
    current = -1;
    source = "";
    generation++;
    $("ocrCandidatePanel").hidden = true;
    $("ocrResultChoice").replaceChildren();
    $("uncertainWords").replaceChildren();
    $("ocrWordPreview").width = 0;
    $("ocrWordPreview").height = 0;
    $("ocrSourcePreview").removeAttribute("src");
    $("ocrReviewSummary").textContent = "";
  }
  function store() {
    if (current < 0) return;
    const candidate = candidates[current];
    candidate.reviewedText = $("recognizedText").value;
    candidate.fields = $("identifiedFields").value;
    candidate.type = $("documentType").value;
  }
  function apply(index) {
    const item = candidates[index];
    if (!item || !state.editing) return;
    generation++;
    current = index;
    $("ocrResultChoice").value = String(index);
    state.editing.pendingWords = item.words || [];
    state.editing.pendingText = item.text;
    state.editing.pendingConfidence = item.confidence;
    $("recognizedText").value = item.reviewedText ?? item.text;
    $("documentType").value = item.type;
    $("identifiedFields").value = item.fields;
    const uncertain = (item.words || []).filter(
      (w) => w.confidence < 70 && w.text.trim(),
    );
    $("ocrReviewSummary").textContent =
      `Engine confidence: ${Math.round(item.confidence || 0)}%. ${uncertain.length} word(s) flagged for review. Confidence is not an accuracy guarantee; check names, numbers and reading order.`;
    $("uncertainWords").replaceChildren();
    for (const word of uncertain.slice(0, 40)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary";
      b.textContent = `${word.text} (${Math.round(word.confidence)}%)`;
      b.onclick = () => inspect(word);
      $("uncertainWords").append(b);
    }
    if (uncertain.length > 40) {
      const p = document.createElement("p");
      p.textContent =
        "Showing the first 40 flagged words. Review the complete text too.";
      $("uncertainWords").append(p);
    }
    $("ocrWordPreview").width = 0;
    $("ocrWordPreview").height = 0;
    updateControls();
  }
  async function inspect(word) {
    const token = generation,
      img = new Image();
    img.src = source;
    await img.decode();
    if (token !== generation) return;
    const b = word.bbox,
      pad = Math.max(8, (b.y1 - b.y0) * 0.6),
      x = Math.max(0, b.x0 - pad),
      y = Math.max(0, b.y0 - pad),
      w = Math.min(img.naturalWidth - x, b.x1 - b.x0 + 2 * pad),
      h = Math.min(img.naturalHeight - y, b.y1 - b.y0 + 2 * pad),
      scale = Math.min(4, 800 / w, 220 / h),
      canvas = $("ocrWordPreview");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas
      .getContext("2d")
      .drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
    const text = $("recognizedText"),
      position = text.value.indexOf(word.text);
    if (position >= 0) {
      text.focus();
      text.setSelectionRange(position, position + word.text.length);
    }
  }
  function render(results, index, image) {
    reset();
    source = image;
    candidates = results.map((result) => ({
      ...result,
      ...ScanCore.identify(result.text),
    }));
    $("ocrCandidatePanel").hidden = false;
    $("ocrSourcePreview").src = image;
    candidates.forEach((item, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = `${item.label} — ${Math.round(item.confidence || 0)}% engine confidence`;
      $("ocrResultChoice").append(option);
    });
    apply(index);
  }
  function init() {
    $("ocrResultChoice").onchange = () => {
      store();
      apply(Number($("ocrResultChoice").value));
    };
    $("recognizedText").addEventListener("input", updateControls);
  }
  root.OCRReview = { reset, render, init };
})(globalThis);
