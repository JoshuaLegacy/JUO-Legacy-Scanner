const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  OCR = require("../ocr-prep.js"),
  Word = require("../word-export.js");
function image(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([...fn(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
test("OCR contrast strengthens faint text while preserving geometry", () => {
  const src = image(100, 80, (x, y) =>
      x > 20 && x < 80 && y > 30 && y < 45 ? [175, 175, 175] : [225, 225, 225],
    ),
    prepared = OCR.transform(src, "contrast");
  assert.equal(prepared.width, 100);
  assert.equal(prepared.height, 80);
  assert.ok(prepared.data[0] - prepared.data[(35 * 100 + 40) * 4] > 100);
});
test("adaptive OCR preparation reads light lettering and dark text as dark ink", () => {
  const src = image(120, 80, (x, y) => {
    const dark = x < 60,
      letter = y > 30 && y < 40 && x % 20 < 10;
    const v = dark ? (letter ? 230 : 60) : letter ? 40 : 230;
    return [v, v, v];
  });
  const out = OCR.transform(src, "adaptive");
  assert.equal(out.data[(35 * 120 + 45) * 4], 0);
  assert.equal(out.data[(35 * 120 + 85) * 4], 0);
  assert.equal(out.data[(10 * 120 + 45) * 4], 255);
});
test("prepared OCR word boxes map back to the exact saved-image coordinate system", () => {
  const words = OCR.mapWords(
    [
      {
        text: "450",
        confidence: 81,
        bbox: { x0: 124, y0: 224, x1: 224, y1: 274 },
      },
    ],
    { padding: 24, scaleX: 2, scaleY: 2, width: 1000, height: 1400 },
  );
  assert.deepEqual(words[0].bbox, { x0: 50, y0: 100, x1: 100, y1: 125 });
  assert.equal(words[0].confidence, 81);
});
test("candidate selection rejects confident punctuation-only noise", () => {
  assert.equal(
    OCR.choose([
      {
        text: "Invoice total 450",
        confidence: 85,
        words: [
          { text: "Invoice", confidence: 86 },
          { text: "450", confidence: 83 },
        ],
      },
      { text: "~~~ ||||", confidence: 99, words: [] },
    ]),
    0,
  );
});
test("Word export preserves Unicode and escapes markup instead of treating it as XML", () => {
  const text = "Café & <total> ₦450\n中文 हिन्दी مرحبا 😀";
  const xml = Word.documentXML([{ text }], "Review & export");
  assert.ok(xml.includes("Café &amp; &lt;total&gt; ₦450"));
  assert.ok(xml.includes("中文 हिन्दी مرحبا 😀"));
  assert.ok(!xml.includes("<total>"));
  assert.equal(Word.xml("A\x00B"), "AB");
});
test("Word export excludes stale OCR while preserving page order and explicit missing-page notes", () => {
  const xml = Word.documentXML(
    [
      { text: "Reviewed first" },
      { text: "Unreviewed secret", ocrStale: true },
      { text: "" },
      { text: "Reviewed last" },
    ],
    "Document",
    [2, 3, 4, 5],
  );
  assert.ok(xml.includes("Page 2") && xml.includes("Page 5"));
  assert.ok(xml.indexOf("Reviewed first") < xml.indexOf("Reviewed last"));
  assert.ok(!xml.includes("Unreviewed secret"));
  assert.equal((xml.match(/w:type="page"/g) || []).length, 3);
});
test("DOCX package declares native Word document content and relationship parts", () => {
  const files = Word.files([{ text: "Editable text" }], "Test");
  assert.ok(
    files["[Content_Types].xml"].includes("wordprocessingml.document.main+xml"),
  );
  assert.ok(files["_rels/.rels"].includes("word/document.xml"));
  assert.ok(files["word/_rels/document.xml.rels"].includes("styles.xml"));
  assert.ok(files["word/document.xml"].includes("Editable text"));
});
