/* A real Office Open XML .docx package containing reviewed, editable Unicode text. */
(function (root) {
  "use strict";
  const MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  function xml(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
  function reviewed(page) {
    return !!page.text?.trim() && !page.ocrStale;
  }
  function paragraph(text, style = "Normal", rtl = false) {
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${rtl ? "<w:bidi/>" : ""}</w:pPr><w:r><w:rPr>${rtl ? "<w:rtl/>" : ""}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  }
  function documentXML(pages, title, numbers = []) {
    let body = paragraph(title, "Title");
    pages.forEach((page, i) => {
      if (i) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      body += paragraph(`Page ${numbers[i] || i + 1}`, "Heading1");
      if (!reviewed(page)) {
        body += paragraph(
          page.ocrStale
            ? "Text needs review after an image edit; unreviewed text is not included."
            : "No reviewed text is available for this scanned page.",
        );
        return;
      }
      for (const line of page.text.replace(/\r\n?/g, "\n").split("\n")) {
        const arabic = (line.match(/[\u0590-\u08FF]/g) || []).length,
          letters = (line.match(/\p{L}/gu) || []).length;
        body += paragraph(line, "Normal", arabic > letters * 0.4);
      }
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  }
  function files(pages, title, numbers = []) {
    return {
      "[Content_Types].xml":
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      "_rels/.rels":
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      "word/document.xml": documentXML(pages, title, numbers),
      "word/_rels/document.xml.rels":
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      "word/styles.xml":
        '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>',
      "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>JUO Legacy Scanner</dc:creator></cp:coreProperties>`,
    };
  }
  async function build(
    pages,
    { title = "JUO Legacy Scan", numbers = [] } = {},
  ) {
    if (!pages.some(reviewed))
      throw Error(
        "Recognize text and save its review before downloading Word.",
      );
    await loadScript("vendor/jszip.min.js");
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files(pages, title, numbers)))
      zip.file(path, content);
    return zip.generateAsync({
      type: "blob",
      mimeType: MIME,
      compression: "DEFLATE",
    });
  }
  const api = { xml, reviewed, documentXML, files, build, MIME };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WordExport = api;
})(globalThis);
