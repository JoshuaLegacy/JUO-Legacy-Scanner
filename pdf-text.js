/* Unicode replacement text in standard PDF marked content, independent of visible fonts. */
(function (root) {
  "use strict";
  function addSearchText(pdf, page, box) {
    // ActualText was introduced in PDF 1.4. Use 1.7 for compatibility with current readers.
    pdf.__private__.setPdfVersion("1.7");
    for (const run of ScanCore.textRuns(page)) {
      const b = run.bbox;
      if (
        !b ||
        ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) ||
        b.x1 <= b.x0 ||
        b.y1 <= b.y0
      )
        continue;
      const height = ((b.y1 - b.y0) / page.height) * box.height,
        width = ((b.x1 - b.x0) / page.width) * box.width;
      // Hex encoding prevents recognized text from being interpreted as PDF syntax.
      pdf.internal.write(
        `/Span << /ActualText <${ScanCore.pdfUnicodeHex(run.text)}> >> BDC`,
      );
      pdf.setFontSize(Math.max(1, (height * 72) / 25.4));
      const marker = "x",
        natural = pdf.getTextWidth(marker);
      pdf.text(
        marker,
        box.x + (b.x0 / page.width) * box.width,
        box.y + (b.y1 / page.height) * box.height,
        {
          renderingMode: "invisible",
          horizontalScale: natural ? width / natural : 1,
        },
      );
      pdf.internal.write("EMC");
    }
  }
  root.PDFText = { addSearchText };
})(globalThis);
