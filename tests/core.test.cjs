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
  const expected = [
    { x: 30, y: 20 },
    { x: 170, y: 20 },
    { x: 170, y: 140 },
    { x: 30, y: 140 },
  ];
  expected.forEach((point, i) => assert.ok(C.distance(point, q[i]) <= 2));
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

test("detects dark pages on light backgrounds and low-contrast pages", () => {
  for (const [fg, bg] of [
    [35, 225],
    [165, 150],
  ]) {
    const im = image(180, 150, (x, y) => {
        const v = x >= 25 && x <= 155 && y >= 20 && y <= 130 ? fg : bg;
        return [v, v, v];
      }),
      q = C.detectDocument(im);
    assert.ok(q, `${fg} on ${bg}`);
    assert.ok(C.distance(q[0], { x: 25, y: 20 }) < 4);
  }
});
test("detects paper on a textured surface", () => {
  const im = image(180, 150, (x, y) => {
    const v =
      x >= 25 && x <= 155 && y >= 20 && y <= 130
        ? 205
        : 60 + ((x * 17 + y * 23) % 70);
    return [v, v, v];
  });
  const q = C.detectDocument(im);
  assert.ok(q);
  assert.ok(C.distance(q[2], { x: 155, y: 130 }) < 4);
});
test("white paper is not treated as glare; local hotspots are warned about", () => {
  const paper = image(160, 160, () => [255, 255, 255]);
  assert.equal(C.quality(paper).glare, false);
  const hotspot = image(160, 160, (x, y) =>
    x < 55 && y < 55 ? [255, 255, 255] : [150, 150, 150],
  );
  assert.equal(C.quality(hotspot).glare, true);
});
test("quality analysis of a document excludes the dark desk", () => {
  const im = image(200, 200, (x, y) =>
    x > 35 && x < 165 && y > 30 && y < 170 ? [220, 220, 220] : [10, 10, 10],
  );
  const full = C.quality(im),
    roi = C.documentQuality(im, C.detectDocument(im));
  assert.ok(roi.brightness > full.brightness + 60);
});
test("guided book flattening preserves a flat page and straightens bowed rows", () => {
  const im = image(160, 160, (x, y) => {
    const edge = 20 + 20 * 4 * (x / 159) * (1 - x / 159);
    return Math.abs(y - edge) < 2 ? [0, 0, 0] : [255, 255, 255];
  });
  assert.deepEqual(C.flattenBook(im, 0, 0).data, im.data);
  const flat = C.flattenBook(im, 0.125, 0.125);
  let min = 200,
    max = 0;
  for (let x = 10; x < 150; x++) {
    let darkest = 255,
      row = -1;
    for (let y = 10; y < 30; y++) {
      const v = flat.data[(y * 160 + x) * 4];
      if (v < darkest) {
        darkest = v;
        row = y;
      }
    }
    assert.ok(row >= 0);
    min = Math.min(min, row);
    max = Math.max(max, row);
  }
  assert.ok(max - min <= 2);
  assert.throws(() => C.flattenBook(im, 0.8, 0));
});
test("Unicode PDF replacement strings preserve surrogate pairs and neutralize PDF syntax", () => {
  assert.equal(C.pdfUnicodeHex("A(é)中😀"), "FEFF0041002800E900294E2DD83DDE00");
  assert.match(C.pdfUnicodeHex(") >> EMC"), /^[A-F0-9]+$/);
});
test("corrected text remains searchable without stale OCR coordinates", () => {
  const page = {
    width: 1000,
    height: 1400,
    text: "Corrected invoice\nTotal: ₦450",
    ocrText: "Wrong invoice",
    words: [{ text: "Wrong", bbox: { x0: 1, y0: 1, x1: 50, y1: 20 } }],
  };
  const runs = C.textRuns(page);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].text, "Corrected invoice");
  assert.equal(runs[0].approximate, true);
  page.text = page.ocrText;
  assert.equal(C.textRuns(page)[0].text, "Wrong");
});
test("identifies statement, contact card and form with category-specific fields", () => {
  const bank = C.identify(
    "BANK STATEMENT\nAccount number: 1234567890\nOpening balance: NGN 20,000\nClosing balance: NGN 30,000",
  );
  assert.equal(bank.type, "Bank statement");
  assert.match(bank.fields, /Account \(last four\): 7890/);
  assert.match(bank.fields, /Closing balance: NGN 30,000/);
  const card = C.identify(
    "Mobile: +234 801 234 5678\nWebsite: www.example.com\nEmail: joshua@example.com",
  );
  assert.equal(card.type, "Business card");
  assert.match(card.fields, /Email: joshua@example.com/);
  assert.equal(C.identify("Application form\nSignature:").type, "Form");
  assert.equal(C.identify("Signature:").type, "Document");
  const id = C.identify(
    "PASSPORT\nFull name: Ada Okafor\nPassport No: A12345\nDate of birth: 04/11/1990",
  );
  assert.equal(id.type, "ID document");
  assert.match(id.fields, /Name: Ada Okafor/);
});

test("boundary fallback finds an outlined page with broken edges on the same-tone background", () => {
  const im = image(200, 160, (x, y) => {
    const edge =
      (((x >= 29 && x <= 31) || (x >= 169 && x <= 171)) &&
        y >= 20 &&
        y <= 140 &&
        y % 14 < 10) ||
      (((y >= 19 && y <= 21) || (y >= 139 && y <= 141)) &&
        x >= 30 &&
        x <= 170 &&
        x % 14 < 10);
    return edge ? [30, 30, 30] : [200, 200, 200];
  });
  const q = C.detectDocument(im);
  assert.ok(q);
  assert.ok(C.distance(q[0], { x: 30, y: 20 }) < 5);
  assert.ok(C.distance(q[2], { x: 170, y: 140 }) < 5);
});
test("quality distinguishes focused text detail from a heavily blurred copy", () => {
  const sharp = image(160, 160, (x, y) =>
    x > 12 && x < 148 && y > 12 && y < 148 && x % 28 < 18 && y % 17 < 3
      ? [40, 40, 40]
      : [220, 220, 220],
  );
  const blurred = image(160, 160, (x, y) => {
    let sum = 0,
      n = 0;
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const xx = C.clamp(x + dx, 0, 159),
          yy = C.clamp(y + dy, 0, 159);
        sum += sharp.data[(yy * 160 + xx) * 4];
        n++;
      }
    const value = sum / n;
    return [value, value, value];
  });
  const focused = C.quality(sharp),
    soft = C.quality(blurred);
  assert.ok(focused.sharpness > soft.sharpness * 5);
  assert.ok(soft.warnings.some((s) => s.includes("focus")));
  assert.ok(!focused.warnings.some((s) => s.includes("focus")));
});
