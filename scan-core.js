/* Pure image and document helpers. No document data leaves the browser. */
(function (root) {
  "use strict";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  function validQuad(q) {
    return (
      q.length === 4 &&
      q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
      q.every((p, i) => cross(p, q[(i + 1) % 4], q[(i + 2) % 4]) > 4)
    );
  }
  function area(q) {
    return (
      Math.abs(
        q.reduce(
          (s, p, i) =>
            s + p.x * q[(i + 1) % q.length].y - p.y * q[(i + 1) % q.length].x,
          0,
        ),
      ) / 2
    );
  }
  function fullCorners(w, h) {
    return [
      { x: 0, y: 0 },
      { x: w - 1, y: 0 },
      { x: w - 1, y: h - 1 },
      { x: 0, y: h - 1 },
    ];
  }
  function gray(image) {
    const out = new Float32Array(image.width * image.height);
    for (let i = 0; i < out.length; i++)
      out[i] =
        0.299 * image.data[i * 4] +
        0.587 * image.data[i * 4 + 1] +
        0.114 * image.data[i * 4 + 2];
    return out;
  }
  function quality(image) {
    const g = gray(image),
      w = image.width,
      h = image.height;
    let sum = 0,
      white = 0,
      dark = 0,
      lap = 0,
      lap2 = 0,
      n = 0;
    for (let i = 0; i < g.length; i++) {
      sum += g[i];
      if (g[i] > 250) white++;
      if (g[i] < 35) dark++;
    }
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x,
          v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        lap += v;
        lap2 += v * v;
        n++;
      }
    const sharpness = n ? Math.max(0, lap2 / n - (lap / n) ** 2) : 0,
      brightness = sum / g.length;
    const warnings = [];
    if (brightness < 65) warnings.push("Too dark: add diffuse light.");
    if (white / g.length > 0.35)
      warnings.push("Large bright area: check for glare or missing text.");
    if (sharpness < 45)
      warnings.push("Low detail: check focus and hold steady.");
    if (dark / g.length > 0.65)
      warnings.push("Heavy shadows: move to even lighting.");
    return {
      brightness,
      sharpness,
      warnings,
      good: brightness >= 65 && brightness <= 245 && sharpness >= 45,
    };
  }
  // Find the largest connected light-paper region. Reject low-contrast or implausible candidates.
  // This deliberately conservative detector keeps manual corners available for difficult backgrounds.
  function detectDocument(image) {
    const w = image.width,
      h = image.height,
      g = gray(image),
      hist = new Uint32Array(256);
    for (const v of g) hist[Math.round(v)]++;
    let total = 0;
    for (let i = 0; i < 256; i++) total += i * hist[i];
    let left = 0,
      leftSum = 0,
      best = -1,
      threshold = 127;
    for (let t = 0; t < 255; t++) {
      left += hist[t];
      leftSum += t * hist[t];
      const right = g.length - left;
      if (!left || !right) continue;
      const score =
        left * right * (leftSum / left - (total - leftSum) / right) ** 2;
      if (score > best) {
        best = score;
        threshold = t;
      }
    }
    if (best / g.length ** 2 < 150) return null;
    const seen = new Uint8Array(g.length),
      queue = new Int32Array(g.length);
    let candidate = null;
    for (let start = 0; start < g.length; start++) {
      if (seen[start] || g[start] <= threshold) continue;
      let head = 0,
        tail = 1;
      queue[0] = start;
      seen[start] = 1;
      const points = [];
      while (head < tail) {
        const i = queue[head++],
          x = i % w,
          y = Math.floor(i / w);
        if (
          x === 0 ||
          y === 0 ||
          x === w - 1 ||
          y === h - 1 ||
          g[i - 1] <= threshold ||
          g[i + 1] <= threshold ||
          g[i - w] <= threshold ||
          g[i + w] <= threshold
        )
          points.push({ x, y });
        for (const j of [
          x > 0 ? i - 1 : -1,
          x < w - 1 ? i + 1 : -1,
          y > 0 ? i - w : -1,
          y < h - 1 ? i + w : -1,
        ])
          if (j >= 0 && !seen[j] && g[j] > threshold) {
            seen[j] = 1;
            queue[tail++] = j;
          }
      }
      if (tail < g.length * 0.18 || points.length < 4) continue;
      const q = [
        points.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b)),
        points.reduce((a, b) => (a.x - a.y > b.x - b.y ? a : b)),
        points.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b)),
        points.reduce((a, b) => (a.y - a.x > b.y - b.x ? a : b)),
      ];
      const size = area(q),
        coverage = tail / size;
      if (
        validQuad(q) &&
        size > g.length * 0.18 &&
        size < g.length * 0.96 &&
        coverage > 0.72 &&
        coverage < 1.15 &&
        (!candidate || size > candidate.area)
      )
        candidate = { corners: q, area: size };
    }
    return candidate?.corners || null;
  }
  // Map a unit square to a quadrilateral using a projective homography.
  function homography(q) {
    const [a, b, c, d] = q,
      dx1 = b.x - c.x,
      dx2 = d.x - c.x,
      dy1 = b.y - c.y,
      dy2 = d.y - c.y;
    const sx = a.x - b.x + c.x - d.x,
      sy = a.y - b.y + c.y - d.y,
      den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-8) throw Error("Corners are too close together.");
    const g = (sx * dy2 - dx2 * sy) / den,
      h = (dx1 * sy - sx * dy1) / den;
    return [
      b.x - a.x + g * b.x,
      d.x - a.x + h * d.x,
      a.x,
      b.y - a.y + g * b.y,
      d.y - a.y + h * d.y,
      a.y,
      g,
      h,
    ];
  }
  function warp(image, q, maxPixels = 4000000) {
    if (!validQuad(q))
      throw Error("Keep the corners in clockwise order around the document.");
    let width = Math.round(
        Math.max(distance(q[0], q[1]), distance(q[3], q[2])),
      ),
      height = Math.round(Math.max(distance(q[0], q[3]), distance(q[1], q[2])));
    const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
    width = Math.max(2, Math.floor(width * scale));
    height = Math.max(2, Math.floor(height * scale));
    const m = homography(q),
      data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1),
          v = y / (height - 1),
          z = m[6] * u + m[7] * v + 1,
          sx = clamp((m[0] * u + m[1] * v + m[2]) / z, 0, image.width - 1),
          sy = clamp((m[3] * u + m[4] * v + m[5]) / z, 0, image.height - 1);
        const x0 = Math.floor(sx),
          y0 = Math.floor(sy),
          x1 = Math.min(image.width - 1, x0 + 1),
          y1 = Math.min(image.height - 1, y0 + 1),
          fx = sx - x0,
          fy = sy - y0,
          i = (y * width + x) * 4;
        for (let k = 0; k < 3; k++)
          data[i + k] =
            image.data[(y0 * image.width + x0) * 4 + k] * (1 - fx) * (1 - fy) +
            image.data[(y0 * image.width + x1) * 4 + k] * fx * (1 - fy) +
            image.data[(y1 * image.width + x0) * 4 + k] * (1 - fx) * fy +
            image.data[(y1 * image.width + x1) * 4 + k] * fx * fy;
        data[i + 3] = 255;
      }
    return { width, height, data };
  }
  function enhance(image, mode) {
    if (mode === "original") return image;
    const w = image.width,
      h = image.height,
      g = gray(image),
      stride = w + 1,
      integral = new Float64Array((w + 1) * (h + 1)),
      radius = Math.max(8, Math.round(Math.min(w, h) / 30));
    for (let y = 1; y <= h; y++) {
      let row = 0;
      for (let x = 1; x <= w; x++) {
        row += g[(y - 1) * w + x - 1];
        integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius),
          x1 = Math.min(w, x + radius + 1),
          y0 = Math.max(0, y - radius),
          y1 = Math.min(h, y + radius + 1),
          mean =
            (integral[y1 * stride + x1] -
              integral[y0 * stride + x1] -
              integral[y1 * stride + x0] +
              integral[y0 * stride + x0]) /
            ((x1 - x0) * (y1 - y0));
        const i = y * w + x,
          base = g[i],
          normalized = clamp((base * 235) / Math.max(40, mean), 0, 255);
        for (let k = 0; k < 3; k++)
          image.data[i * 4 + k] =
            mode === "bw"
              ? base < mean - 12
                ? 0
                : 255
              : mode === "gray"
                ? normalized
                : clamp(
                    (image.data[i * 4 + k] * 235) / Math.max(40, mean),
                    0,
                    255,
                  );
      }
    return image;
  }
  // Estimate small text skew using horizontal projection variance. Caller supplies a downsampled image.
  function skewAngle(image) {
    const w = image.width,
      h = image.height,
      g = gray(image),
      points = [];
    for (let y = 1; y < h - 1; y += 2)
      for (let x = 1; x < w - 1; x += 2) {
        const i = y * w + x;
        if (g[i] < 130 && g[i - w] > g[i] + 25)
          points.push({ x: x - w / 2, y: y - h / 2 });
      }
    if (points.length < 50) return 0;
    function score(deg) {
      const r = (deg * Math.PI) / 180,
        bins = new Uint32Array(h + w);
      for (const p of points) {
        const y = Math.round(
          p.y * Math.cos(r) + p.x * Math.sin(r) + (h + w) / 2,
        );
        if (y >= 0 && y < bins.length) bins[y]++;
      }
      return bins.reduce((s, n) => s + n * n, 0);
    }
    const baseline = score(0);
    let best = baseline,
      angle = 0;
    for (let d = -5; d <= 5; d += 0.5) {
      const s = score(d);
      if (s > best) {
        best = s;
        angle = d;
      }
    }
    return best > baseline * 1.12 ? angle : 0;
  }
  const SIZES = { A4: [210, 297], A3: [297, 420], LETTER: [215.9, 279.4] };
  function outputSize(w, h, format, dpi) {
    let [pw, ph] = SIZES[format] || SIZES.A4;
    if (w > h) [pw, ph] = [ph, pw];
    const scale = Math.min(
      1,
      ((pw / 25.4) * dpi) / w,
      ((ph / 25.4) * dpi) / h,
      Math.sqrt(4000000 / (w * h)),
    );
    return {
      width: Math.max(1, Math.floor(w * scale)),
      height: Math.max(1, Math.floor(h * scale)),
      paper: [pw, ph],
    };
  }
  function fitImage(w, h, pw, ph) {
    const s = Math.min(pw / w, ph / h);
    return {
      x: (pw - w * s) / 2,
      y: (ph - h * s) / 2,
      width: w * s,
      height: h * s,
    };
  }
  function identify(text) {
    const type = /\binvoice\b/i.test(text)
      ? "Invoice"
      : /\b(receipt|change due|cashier)\b/i.test(text)
        ? "Receipt"
        : /\b(passport|identity card|date of birth|national id)\b/i.test(text)
          ? "ID document"
          : /\b(dear|yours sincerely|yours faithfully)\b/i.test(text)
            ? "Letter"
            : "Document";
    const fields = [];
    const patterns = [
      [
        "Date",
        /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/,
      ],
      [
        "Total",
        /\b(?:grand\s+total|amount\s+due|total)\s*[:=]?\s*((?:(?:USD|EUR|GBP|NGN|[$€£₦])\s*)?[\d,.]+(?:\s*(?:USD|EUR|GBP|NGN))?)/i,
      ],
      ["Invoice number", /\binvoice\s*(?:number|no\.?|#)\s*[:.]?\s*([\w/-]+)/i],
    ];
    for (const [name, re] of patterns) {
      const m = text.match(re);
      if (m) fields.push(`${name}: ${(m[1] || m[0]).trim()}`);
    }
    return { type, fields: fields.join("\n") };
  }
  const api = {
    clamp,
    distance,
    validQuad,
    area,
    fullCorners,
    quality,
    detectDocument,
    homography,
    warp,
    enhance,
    skewAngle,
    outputSize,
    fitImage,
    identify,
    SIZES,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
