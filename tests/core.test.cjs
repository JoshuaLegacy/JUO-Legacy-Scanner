const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  C = require("../scan-core.js");
function image(w, h, pixel) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const rgb = pixel(x, y);
      data.set([...rgb, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}
test("detects a light page and rejects uniform backgrounds", () => {
  const im = image(200, 160, (x, y) =>
    x >= 30 && x <= 170 && y >= 20 && y <= 140 ? [240, 240, 240] : [25, 25, 25],
  );
  const q = C.detectDocument(im);
  assert.ok(q);
  assert.deepEqual(q, [
    { x: 30, y: 20 },
    { x: 170, y: 20 },
    { x: 170, y: 140 },
    { x: 30, y: 140 },
  ]);
  assert.equal(C.detectDocument(image(100, 100, () => [255, 255, 255])), null);
});
test("rejects crossed and degenerate corners", () => {
  assert.equal(
    C.validQuad([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]),
    false,
  );
  assert.throws(() =>
    C.warp(
      image(20, 20, () => [0, 0, 0]),
      Array(4).fill({ x: 0, y: 0 }),
    ),
  );
});
test("perspective warp maps the four corners without stretching to a paper ratio", () => {
  const im = image(100, 80, (x, y) => [x * 2, y * 3, 0]),
    q = [
      { x: 10, y: 10 },
      { x: 90, y: 5 },
      { x: 85, y: 70 },
      { x: 15, y: 65 },
    ],
    out = C.warp(im, q);
  const corners = [
    0,
    (out.width - 1) * 4,
    ((out.height - 1) * out.width + out.width - 1) * 4,
    (out.height - 1) * out.width * 4,
  ];
  q.forEach((p, i) => {
    assert.ok(Math.abs(out.data[corners[i]] - p.x * 2) <= 1);
    assert.ok(Math.abs(out.data[corners[i] + 1] - p.y * 3) <= 1);
  });
});
test("DPI changes output pixel limits, never invents source detail, and caps memory", () => {
  const low = C.outputSize(3500, 4900, "A4", 150),
    high = C.outputSize(3500, 4900, "A4", 300);
  assert.ok(low.width < high.width);
  assert.ok(high.width * high.height <= 4000000);
  assert.equal(C.outputSize(400, 600, "A4", 400).width, 400);
  assert.deepEqual(
    C.outputSize(1200, 800, "LETTER", 300).paper,
    [279.4, 215.9],
  );
});
test("PDF fitting preserves aspect ratio and centers the image", () => {
  const fit = C.fitImage(1600, 900, 210, 297);
  assert.equal(fit.width / fit.height, 1600 / 900);
  assert.equal(fit.x, 0);
  assert.ok(fit.y > 0);
});
test("enhancement leaves original alone and makes binary/grayscale outputs", () => {
  const im = image(30, 30, (x) => (x < 15 ? [100, 80, 60] : [230, 240, 250])),
    before = im.data.slice();
  C.enhance(im, "original");
  assert.deepEqual(im.data, before);
  const gray = C.enhance(structuredClone(im), "gray");
  for (let i = 0; i < gray.data.length; i += 4)
    assert.equal(gray.data[i], gray.data[i + 2]);
  const bw = C.enhance(structuredClone(im), "bw");
  for (let i = 0; i < bw.data.length; i += 4)
    assert.ok([0, 255].includes(bw.data[i]));
});
test("quality reports dark, low detail captures", () => {
  const q = C.quality(image(80, 80, () => [20, 20, 20]));
  assert.equal(q.good, false);
  assert.ok(q.warnings.some((w) => w.includes("dark")));
  assert.equal(q.sharpness, 0);
});
test("classifies conservatively and extracts suggestions without asserting truth", () => {
  assert.deepEqual(C.identify("hello"), { type: "Document", fields: "" });
  const out = C.identify(
    "INVOICE No: INV-2026-11\nDate 2026-11-04\nGrand total: NGN 123",
  );
  assert.equal(out.type, "Invoice");
  assert.match(out.fields, /Invoice number: INV-2026-11/);
  assert.match(out.fields, /Date: 2026-11-04/);
  assert.equal(C.identify("Dear Joshua, yours sincerely").type, "Letter");
});
test("deskew does not invent an angle for an empty page", () => {
  assert.equal(C.skewAngle(image(120, 120, () => [255, 255, 255])), 0);
});
test("projective mapping and processing stay inside a requested memory bound", () => {
  const out = C.warp(
    image(200, 150, (x, y) => [x, y, 100]),
    C.fullCorners(200, 150),
    5000,
  );
  assert.ok(out.width * out.height <= 5000);
  assert.ok(out.data.every(Number.isFinite));
});
test("extracts currency-prefixed totals", () => {
  assert.match(
    C.identify("INVOICE\nGrand total: NGN 12,345.50").fields,
    /Total: NGN 12,345.50/,
  );
});
test("deskew estimates slanted text rows within half a degree", () => {
  const radians = (3 * Math.PI) / 180;
  const im = image(300, 220, (x, y) => {
    const row = y - Math.tan(radians) * x;
    return x > 20 && x < 280 && row > 20 && row < 180 && row % 25 < 3
      ? [0, 0, 0]
      : [255, 255, 255];
  });
  assert.ok(Math.abs(C.skewAngle(im) + 3) <= 0.5);
});
