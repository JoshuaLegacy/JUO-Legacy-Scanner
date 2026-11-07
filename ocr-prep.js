/* OCR-only input preparation and inverse geometry. Never changes the visible saved page. */
(function (root) {
  "use strict";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function transform(image, variant = "contrast") {
    const { width: w, height: h, data } = image,
      n = w * h,
      g = new Uint8Array(n),
      hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      g[i] = Math.round(
        0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2],
      );
      hist[g[i]]++;
    }
    function percentile(f) {
      let count = 0;
      for (let i = 0; i < 256; i++) {
        count += hist[i];
        if (count >= n * f) return i;
      }
      return 255;
    }
    const low = percentile(0.005),
      high = percentile(0.995),
      gain = Math.min(3, 255 / Math.max(32, high - low));
    for (let i = 0; i < n; i++)
      g[i] = clamp(255 - (high - g[i]) * gain, 0, 255);
    const inverted = percentile(0.5) < (low + high) / 2;
    if (variant === "adaptive") {
      const tile = 64,
        columns = Math.ceil(w / tile),
        rows = Math.ceil(h / tile),
        polarity = new Uint8Array(columns * rows),
        margins = new Float32Array(columns * rows);
      for (let ty = 0; ty < rows; ty++)
        for (let tx = 0; tx < columns; tx++) {
          const local = new Uint32Array(256);
          let count = 0;
          for (let y = ty * tile; y < Math.min(h, (ty + 1) * tile); y++)
            for (let x = tx * tile; x < Math.min(w, (tx + 1) * tile); x++) {
              local[g[y * w + x]]++;
              count++;
            }
          function quantile(f) {
            let n = 0;
            for (let k = 0; k < 256; k++) {
              n += local[k];
              if (n >= count * f) return k;
            }
            return 255;
          }
          const low = quantile(0.01),
            mid = quantile(0.5),
            high = quantile(0.99),
            i = ty * columns + tx;
          polarity[i] = mid - low >= high - mid ? 1 : 0;
          margins[i] = Math.max(5, Math.min(10, (high - low) * 0.06));
        }
      const stride = w + 1,
        integral = new Float64Array((w + 1) * (h + 1)),
        radius = Math.max(12, Math.round(Math.min(w, h) / 55));
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
              ((x1 - x0) * (y1 - y0)),
            value = g[y * w + x],
            tileIndex = Math.floor(y / tile) * columns + Math.floor(x / tile),
            ink = polarity[tileIndex]
              ? value < mean - margins[tileIndex]
              : value > mean + margins[tileIndex],
            out = ink ? 0 : 255,
            i = (y * w + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = out;
          data[i + 3] = 255;
        }
    } else
      for (let i = 0; i < n; i++) {
        const v = inverted ? 255 - g[i] : g[i];
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
    return image;
  }
  function prepare(
    source,
    {
      variant = "contrast",
      quality = "accurate",
      upscale = true,
      maxPixels,
    } = {},
  ) {
    const budget = maxPixels || (quality === "accurate" ? 6000000 : 4000000),
      scale = Math.min(
        upscale ? 2 : 1,
        upscale ? Math.max(1, 1800 / Math.max(source.width, source.height)) : 1,
        Math.sqrt((budget * 0.9) / (source.width * source.height)),
      ),
      width = Math.max(2, Math.floor(source.width * scale)),
      height = Math.max(2, Math.floor(source.height * scale)),
      padding = 24;
    const inner = document.createElement("canvas");
    inner.width = width;
    inner.height = height;
    const ctx = inner.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    if (variant !== "original") {
      const image = ctx.getImageData(0, 0, width, height);
      ctx.putImageData(transform(image, variant), 0, 0);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width + padding * 2;
    canvas.height = height + padding * 2;
    const out = canvas.getContext("2d");
    out.fillStyle = "white";
    out.fillRect(0, 0, canvas.width, canvas.height);
    out.drawImage(inner, padding, padding);
    return {
      canvas,
      width: source.width,
      height: source.height,
      scaleX: width / source.width,
      scaleY: height / source.height,
      padding,
    };
  }
  function mapWords(words, geometry) {
    return (words || [])
      .filter((w) => w.bbox && w.text?.trim())
      .map((w) => ({
        text: w.text,
        confidence: Number(w.confidence) || 0,
        bbox: {
          x0: clamp(
            (w.bbox.x0 - geometry.padding) / geometry.scaleX,
            0,
            geometry.width,
          ),
          x1: clamp(
            (w.bbox.x1 - geometry.padding) / geometry.scaleX,
            0,
            geometry.width,
          ),
          y0: clamp(
            (w.bbox.y0 - geometry.padding) / geometry.scaleY,
            0,
            geometry.height,
          ),
          y1: clamp(
            (w.bbox.y1 - geometry.padding) / geometry.scaleY,
            0,
            geometry.height,
          ),
        },
      }))
      .filter((w) => w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0);
  }
  function score(data) {
    const words = (data.words || []).filter((w) =>
        /[\p{L}\p{N}]/u.test(w.text),
      ),
      chars = (data.text?.match(/[\p{L}\p{N}]/gu) || []).length;
    if (!chars) return -100;
    let weighted = 0,
      total = 0,
      low = 0;
    for (const w of words) {
      const weight = Math.sqrt(w.text.length);
      weighted += (Number(w.confidence) || 0) * weight;
      total += weight;
      if (w.confidence < 50) low++;
    }
    const confidence = total ? weighted / total : Number(data.confidence) || 0,
      punctuation =
        (data.text?.match(/[^\p{L}\p{N}\s.,:;!?()'"\-/%€£₦$]/gu) || []).length /
        Math.max(1, data.text?.length || 0);
    return (
      confidence +
      Math.min(8, Math.log1p(chars) * 1.4) -
      Math.min(20, punctuation * 40) -
      (words.length ? (low / words.length) * 12 : 0)
    );
  }
  function choose(results) {
    let best = 0;
    const count = (r) => (r.text?.match(/[\p{L}\p{N}]/gu) || []).length;
    for (let i = 1; i < results.length; i++) {
      const moreCoverage =
        count(results[i]) > count(results[best]) * 1.25 &&
        results[i].confidence >= results[best].confidence - 10 &&
        score(results[i]) >= score(results[best]) - 4;
      if (score(results[i]) > score(results[best]) + 3 || moreCoverage)
        best = i;
    }
    return best;
  }
  const api = { transform, prepare, mapWords, score, choose };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OCRPrep = api;
})(globalThis);
