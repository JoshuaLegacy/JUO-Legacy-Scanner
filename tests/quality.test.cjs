const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  C = require("../scan-core.js"),
  Camera = require("../camera-controls.js");
function image(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([...fn(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
test("color enhancement keeps purple dark and white letters distinct", () => {
  const source = image(120, 100, (x, y) =>
      x > 40 && x < 80 && y > 40 && y < 60 ? [230, 230, 235] : [92, 80, 151],
    ),
    fixed = C.enhance(source, "color"),
    dark = fixed.data.slice(0, 3),
    white = fixed.data.slice((50 * 120 + 60) * 4, (50 * 120 + 60) * 4 + 3);
  assert.ok(dark[2] < 180 && dark[0] < 120);
  assert.ok(white[0] - dark[0] > 100);
  assert.ok(Math.abs(dark[0] / dark[2] - 92 / 151) < 0.03);
});
test("Original with neutral sliders preserves source channels exactly", () => {
  const source = image(70, 60, (x, y) => [x * 3, y * 4, 150]),
    copy = source.data.slice();
  C.adjustTone(C.enhance(source, "original"), 0, 0);
  assert.deepEqual(source.data, copy);
});
test("tone adjustments are explicit and preserve a neutral setting", () => {
  const source = image(10, 10, () => [100, 120, 160]);
  assert.ok(C.adjustTone(structuredClone(source), -10, 0).data[0] < 100);
  const out = C.adjustTone(structuredClone(source), 0, 40);
  assert.ok(out.data[0] < 100 && out.data[2] > 160);
});
test("higher-detail output retains chosen pixels without upscaling", () => {
  assert.equal(C.outputSize(4000, 3000, "A4", 0, 12000000).width, 4000);
  const size = C.outputSize(6000, 4000, "A4", 0, 8000000);
  assert.ok(size.width * size.height <= 8000000);
  assert.equal(C.outputSize(800, 1200, "A4", 0, 24000000).width, 800);
});
test("camera choices respect reported capabilities and the processing ceiling", () => {
  const options = Camera.choices(4000, 3000);
  assert.ok(options.some((o) => o.value === "12"));
  assert.ok(!options.some((o) => o.value === "24"));
  assert.ok(options.every((o) => o.pixels <= 12000000));
  assert.ok(Camera.choices(12000, 9000).every((o) => o.pixels <= 24000000));
});
test("camera dimensions preserve aspect and fit reported bounds", () => {
  const size = Camera.fitPixels(8000000, 4000, 3000, 4 / 3);
  assert.ok(size.width * size.height <= 8000000);
  assert.ok(size.width <= 4000 && size.height <= 3000);
  assert.ok(Math.abs(size.width / size.height - 4 / 3) < 0.01);
});
test("a mixed purple and white cover is detected as one page on a textured floor", () => {
  const source = image(240, 320, (x, y) => {
      if (x >= 35 && x <= 205 && y >= 30 && y <= 290) {
        if (y > 170 && x > 50 && x < 190) return [225, 225, 225];
        return [92, 80, 151];
      }
      const value = 135 + ((x * 3 + y * 7) % 18);
      return [value, value + 1, value];
    }),
    d = C.findDocument(source);
  assert.ok(d && d.confidence >= 0.75);
  assert.ok(C.distance(d.corners[0], { x: 35, y: 30 }) < 6);
  assert.ok(C.distance(d.corners[2], { x: 205, y: 290 }) < 6);
});
test("a uniform frame never gets an automatic crop", () =>
  assert.equal(C.findDocument(image(160, 120, () => [120, 120, 120])), null));
test("white panels splitting a colored cover do not truncate its matching-color footer", () => {
  const source = image(240, 320, (x, y) => {
    if (x >= 35 && x <= 205 && y >= 30 && y <= 290)
      return y < 135 || y > 245 ? [92, 80, 151] : [225, 225, 225];
    return [145, 145, 145];
  });
  const found = C.findDocument(source);
  assert.ok(found && found.confidence >= 0.75);
  assert.ok(C.distance(found.corners[2], { x: 205, y: 290 }) < 6);
  assert.ok(C.distance(found.corners[0], { x: 35, y: 30 }) < 6);
});
