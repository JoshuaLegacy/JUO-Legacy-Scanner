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
      h = image.height,
      hist = new Uint32Array(256);
    let sum = 0,
      lap = 0,
      lap2 = 0,
      n = 0;
    for (const value of g) {
      hist[Math.round(value)]++;
      sum += value;
    }
    function percentile(f) {
      let count = 0;
      for (let i = 0; i < 256; i++) {
        count += hist[i];
        if (count >= g.length * f) return i;
      }
      return 255;
    }
    const p10 = percentile(0.1),
      p50 = percentile(0.5),
      p90 = percentile(0.9),
      contrast = percentile(0.98) - percentile(0.02);
    for (let y = 2; y < h - 2; y++)
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x,
          v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        lap += v;
        lap2 += v * v;
        n++;
      }
    const sharpness = n ? Math.max(0, lap2 / n - (lap / n) ** 2) : 0,
      brightness = sum / g.length;
    // Compare local exposure with the rest of the page; ordinary white paper is not glare.
    const tiles = [];
    for (let ty = 0; ty < 4; ty++)
      for (let tx = 0; tx < 4; tx++) {
        let total = 0,
          saturated = 0,
          count = 0;
        for (
          let y = Math.floor((ty * h) / 4);
          y < Math.floor(((ty + 1) * h) / 4);
          y++
        )
          for (
            let x = Math.floor((tx * w) / 4);
            x < Math.floor(((tx + 1) * w) / 4);
            x++
          ) {
            const v = g[y * w + x];
            total += v;
            if (v > 252) saturated++;
            count++;
          }
        tiles.push({
          mean: total / Math.max(1, count),
          saturated: saturated / Math.max(1, count),
        });
      }
    const means = tiles.map((t) => t.mean).sort((a, b) => a - b),
      shadowRange = means[12] - means[3];
    const glare =
      tiles.some((t) => t.saturated > 0.55 && t.mean > p50 + 30) && p50 < 225;
    const lowDetail = sharpness < Math.max(45, contrast * contrast * 0.003);
    const warnings = [];
    if (brightness < 60) warnings.push("Too dark: add diffuse light.");
    if (glare)
      warnings.push("Possible glare: move the light or tilt the camera.");
    if (lowDetail) warnings.push("Low detail: check focus and hold steady.");
    if (shadowRange > 65)
      warnings.push("Uneven lighting: reduce shadows across the page.");
    if (contrast < 18)
      warnings.push("Low contrast: check faint text and page edges.");
    return {
      brightness,
      sharpness,
      contrast,
      glare,
      shadowRange,
      warnings,
      good:
        brightness >= 60 &&
        !glare &&
        !lowDetail &&
        contrast >= 18 &&
        shadowRange <= 65,
    };
  }
  function documentQuality(image, corners) {
    return quality(corners ? warp(image, corners, 90000) : image);
  }
  function smoothGray(image) {
    const src = gray(image),
      out = new Float32Array(src.length),
      w = image.width,
      h = image.height;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) {
              sum += src[yy * w + xx];
              n++;
            }
          }
        out[y * w + x] = sum / n;
      }
    return out;
  }
  // Find the largest connected light-paper region. Reject low-contrast or implausible candidates.
  // This deliberately conservative detector keeps manual corners available for difficult backgrounds.
  function detectRegion(image, inverted = false) {
    const w = image.width,
      h = image.height,
      g = smoothGray(image),
      hist = new Uint32Array(256);
    if (inverted) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
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
    if (best / g.length ** 2 < 9) return null;
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
      let touches = 0;
      while (head < tail) {
        const i = queue[head++],
          x = i % w,
          y = Math.floor(i / w);
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches++;
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
      if (
        tail < g.length * 0.18 ||
        points.length < 4 ||
        touches > Math.min(w, h) * 0.3
      )
        continue;
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
  function detectDocument(image) {
    const light = detectRegion(image),
      dark = detectRegion(image, true);
    if (light && dark) return area(light) >= area(dark) ? light : dark;
    return light || dark || detectEdges(image);
  }
  // Hough-line fallback uses boundary evidence instead of page brightness.
  function detectEdges(image) {
    const w = image.width,
      h = image.height,
      g = smoothGray(image),
      points = [];
    for (let y = 2; y < h - 2; y += 2)
      for (let x = 2; x < w - 2; x += 2) {
        const i = y * w + x,
          gx = g[i + 1] - g[i - 1],
          gy = g[i + w] - g[i - w],
          m = Math.hypot(gx, gy);
        if (m > 16) points.push({ x, y, m: Math.min(80, m) });
      }
    if (points.length < 40) return null;
    const diagonal = Math.ceil(Math.hypot(w, h)),
      bins = diagonal * 2 + 1,
      peaks = [];
    for (let deg = 0; deg < 180; deg += 3) {
      const angle = (deg * Math.PI) / 180,
        c = Math.cos(angle),
        sn = Math.sin(angle),
        votes = new Float32Array(bins);
      for (const p of points) {
        const rho = Math.round(p.x * c + p.y * sn) + diagonal;
        votes[rho] += p.m;
      }
      for (let r = 2; r < bins - 2; r++)
        if (
          votes[r] > Math.min(w, h) * 10 &&
          votes[r] >= votes[r - 1] &&
          votes[r] >= votes[r + 1]
        )
          peaks.push({ c, s: sn, r: r - diagonal, score: votes[r], deg });
    }
    peaks.sort((a, b) => b.score - a.score);
    const lines = [];
    for (const p of peaks) {
      if (
        lines.some(
          (l) => Math.abs(l.deg - p.deg) < 7 && Math.abs(l.r - p.r) < 8,
        )
      )
        continue;
      lines.push(p);
      if (lines.length === 24) break;
    }
    function intersect(a, b) {
      const d = a.c * b.s - b.c * a.s;
      if (Math.abs(d) < 0.4) return null;
      return { x: (a.r * b.s - b.r * a.s) / d, y: (a.c * b.r - b.c * a.r) / d };
    }
    let best = null;
    const vertical = lines.filter((l) => l.deg < 31 || l.deg > 149),
      horizontal = lines.filter((l) => l.deg > 59 && l.deg < 121);
    for (let a = 0; a < vertical.length; a++)
      for (let b = a + 1; b < vertical.length; b++)
        for (let c = 0; c < horizontal.length; c++)
          for (let d = c + 1; d < horizontal.length; d++) {
            const points = [
              intersect(vertical[a], horizontal[c]),
              intersect(vertical[b], horizontal[c]),
              intersect(vertical[b], horizontal[d]),
              intersect(vertical[a], horizontal[d]),
            ];
            if (
              points.some(
                (p) => !p || p.x < 2 || p.x > w - 3 || p.y < 2 || p.y > h - 3,
              )
            )
              continue;
            const center = {
              x: points.reduce((s, p) => s + p.x, 0) / 4,
              y: points.reduce((s, p) => s + p.y, 0) / 4,
            };
            points.sort(
              (a, b) =>
                Math.atan2(a.y - center.y, a.x - center.x) -
                Math.atan2(b.y - center.y, b.x - center.x),
            );
            const first = points.reduce(
                (best, p, i) =>
                  p.x + p.y < points[best].x + points[best].y ? i : best,
                0,
              ),
              q = points.slice(first).concat(points.slice(0, first)),
              size = area(q);
            if (!validQuad(q) || size < w * h * 0.2 || size > w * h * 0.94)
              continue;
            const score =
              vertical[a].score +
              vertical[b].score +
              horizontal[c].score +
              horizontal[d].score;
            if (!best || score > best.score) best = { q, score };
          }
    return best?.q || null;
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
  function flattenBook(
    image,
    topBend = 0,
    bottomBend = 0,
    maxPixels = 4000000,
  ) {
    if (
      !Number.isFinite(topBend) ||
      !Number.isFinite(bottomBend) ||
      Math.abs(topBend) > 0.25 ||
      Math.abs(bottomBend) > 0.25
    )
      throw Error("Book curvature must be between -25% and 25%.");
    const { width: w, height: h } = image,
      data = new Uint8ClampedArray(image.data.length);
    if (w * h > maxPixels)
      throw Error("Resize the book page before flattening.");
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1),
          v = y / (h - 1),
          curve = 4 * u * (1 - u),
          top = topBend * h * curve,
          bottom = h - 1 + bottomBend * h * curve;
        const sy = clamp(top + (bottom - top) * v, 0, h - 1),
          y0 = Math.floor(sy),
          y1 = Math.min(h - 1, y0 + 1),
          f = sy - y0,
          i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++)
          data[i + c] =
            image.data[(y0 * w + x) * 4 + c] * (1 - f) +
            image.data[(y1 * w + x) * 4 + c] * f;
        data[i + 3] = 255;
      }
    return { width: w, height: h, data };
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
    const normalized = text.normalize("NFKC"),
      rules = [
        ["Invoice", [/\binvoice\b/i, /\bamount due\b/i, /\bbill to\b/i]],
        ["Receipt", [/\breceipt\b/i, /\bcashier\b/i, /\bchange due\b/i]],
        [
          "ID document",
          [/\bpassport\b/i, /\bidentity card\b/i, /\bnational id\b/i],
        ],
        [
          "Bank statement",
          [
            /\bbank statement\b/i,
            /\bopening balance\b/i,
            /\bclosing balance\b/i,
          ],
        ],
        [
          "Business card",
          [/\bbusiness card\b/i, /\bmobile\s*:/i, /\bwebsite\s*:/i],
        ],
        [
          "Form",
          [
            /\bapplication form\b/i,
            /\bregistration form\b/i,
            /\bsignature\s*:/i,
          ],
        ],
        [
          "Letter",
          [/\bdear\b/i, /\byours sincerely\b/i, /\byours faithfully\b/i],
        ],
      ];
    const scored = rules
      .map(([type, patterns]) => ({
        type,
        score: patterns.reduce((n, p) => n + (p.test(normalized) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score);
    const selected = scored[0];
    let type = selected.score ? selected.type : "Document";
    // A generic signature or phone label alone is not sufficient to identify a form/card.
    if (
      type === "Form" &&
      !/application form|registration form/i.test(normalized)
    )
      type = "Document";
    if (
      type === "Business card" &&
      !/business card/i.test(normalized) &&
      selected.score < 2
    )
      type = "Document";
    const fields = [],
      money =
        "((?:(?:USD|EUR|GBP|NGN|JPY|CNY|INR|[$€£₦¥₹])\\s*)?\\d[\\d,.]*(?:\\s*(?:USD|EUR|GBP|NGN|JPY|CNY|INR))?)";
    const patterns = [
      [
        "Date",
        /\b(?:date\s*[:\-]?\s*)?(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/i,
      ],
      [
        "Total",
        new RegExp(
          "(?:^|\\n)\\s*(?:grand\\s+total|amount\\s+due|total)\\s*[:=]?\\s*" +
            money,
          "i",
        ),
      ],
      ["Invoice number", /\binvoice\s*(?:number|no\.?|#)\s*[:.]?\s*([\w/-]+)/i],
      ["Email", /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i],
      [
        "Phone",
        /(?:phone|tel(?:ephone)?|mobile)\s*[:.]?\s*(\+?[\d(][\d ()-]{6,}\d)/i,
      ],
      ["Website", /\b((?:https?:\/\/|www\.)[^\s<>]+)/i],
      ["Currency", /\b(USD|EUR|GBP|NGN|JPY|CNY|INR)\b/],
      ["Tax", new RegExp("(?:^|\\n)\\s*(?:VAT|tax)\\s*[:=]?\\s*" + money, "i")],
      ["Due date", /\bdue\s+date\s*[:.]?\s*([^\n]+)/i],
    ];
    if (type === "ID document")
      patterns.push(
        ["Name", /\b(?:full name|surname|name)\s*[:.]\s*([^\n]+)/i],
        [
          "Document number",
          /\b(?:passport|document|id)\s*(?:number|no\.?|#)\s*[:.]?\s*([\w/-]+)/i,
        ],
        ["Date of birth", /\b(?:date of birth|DOB)\s*[:.]?\s*([^\n]+)/i],
        ["Expiry", /\b(?:expiry|expires|expiration date)\s*[:.]?\s*([^\n]+)/i],
      );
    if (type === "Bank statement")
      patterns.push(
        [
          "Account (last four)",
          /\baccount\s*(?:number|no\.?|#)\s*[:.]?\s*[\d *Xx-]*?(\d{4})(?=\s*(?:\n|$))/i,
        ],
        [
          "Opening balance",
          new RegExp("opening\\s+balance\\s*[:=]?\\s*" + money, "i"),
        ],
        [
          "Closing balance",
          new RegExp("closing\\s+balance\\s*[:=]?\\s*" + money, "i"),
        ],
      );
    for (const [label, re] of patterns) {
      const m = normalized.match(re);
      if (m) fields.push(label + ": " + (m[1] || m[0]).trim());
    }
    return { type, fields: fields.join("\n") };
  }
  function pdfUnicodeHex(text) {
    let hex = "FEFF";
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      hex += c.toString(16).padStart(4, "0");
    }
    return hex.toUpperCase();
  }
  function textRuns(page) {
    if (!page.text || page.ocrStale) return [];
    // Preserve exact OCR geometry only when the reviewed text matches its recognition snapshot.
    if (page.words?.length && (!page.ocrText || page.text === page.ocrText))
      return page.words.filter((w) => w.text && w.bbox);
    const lines = page.text.split(/\r?\n/).filter((s) => s.trim()),
      step = Math.min(
        page.height * 0.035,
        (page.height * 0.9) / Math.max(1, lines.length),
      );
    return lines.map((text, i) => ({
      text,
      bbox: {
        x0: page.width * 0.04,
        y0: page.height * 0.04 + i * step,
        x1: page.width * 0.96,
        y1: page.height * 0.04 + (i + 1) * step,
      },
      approximate: true,
    }));
  }
  const api = {
    clamp,
    distance,
    validQuad,
    area,
    fullCorners,
    quality,
    documentQuality,
    flattenBook,
    pdfUnicodeHex,
    textRuns,
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
