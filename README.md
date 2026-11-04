# JUO Legacy Scanner

A static, browser-based document scanner by Joshua Orizu. Camera images, recognized text and reviewed fields are processed on the device. No document upload service or account is required.

## Scan a document

1. Open the app over HTTPS (or localhost). Start the rear camera, or import a JPEG/PNG/WebP image. Allow camera access when prompted.
2. Place the document on a contrasting surface under even light. The preview gives heuristic focus, exposure and shadow warnings. Automatic capture is optional and waits for a stable detected page.
3. Capture and check all four corners. Drag the corner handles or use the keyboard-accessible corner sliders. Perspective correction turns the selected quadrilateral into a rectangle. Rotate before adding if needed.
4. Choose Original, Color Document, Grayscale or Black & White before adding a page. Document modes reduce uneven illumination using local contrast normalization; optional text deskew corrects small angles up to 5°.
5. Review page thumbnails. Reorder, delete or rotate pages. Rotating an existing page clears its OCR because the word coordinates would otherwise be wrong.
6. Open **Text / identify**, choose a language, recognize text, and review the result. Optional orientation detection compares four rotations and corrects the image when recognition improves. It takes longer than recognizing upright text.
7. Review the suggested document category and extracted date, total or invoice number. These are pattern-based suggestions, not verified facts or identity verification. Supported browsers can also read QR/barcodes; scanned links are never opened automatically.
8. Download the PDF and/or UTF-8 text. Downloads keep the draft. **Clear document** explicitly removes the saved pages and text from this browser.

## Quality and resource limits

- The camera requests up to 3840 × 2160 and continuous focus where supported. The browser/device decides the actual resolution and focus capabilities.
- Edge detection targets a large, light page against a darker background. Textured, low-contrast, dark or partially hidden documents may require manual corners. It does not detect individual book pages or flatten curved pages.
- Quality warnings estimate detail and exposure; they cannot guarantee readability or distinguish every white page from glare. Check the saved preview.
- Paper formats: A4, A3 and Letter. Landscape images use landscape pages. Images are centered with their proportions preserved; unused paper stays blank.
- DPI sets the output pixel ceiling relative to the selected paper. Images are never enlarged to pretend to have more detail. Working/output images are limited to 4 megapixels, so high DPI may be capped below the selected value on large paper.
- Imported files must be under 30 MB and 40 megapixels. Decoding a large image can still use substantial memory. Page JPEGs remain in memory and in local IndexedDB: export long documents in batches. There is no promise of unlimited or 100+ page scanning.

## OCR, identification and search

Tesseract.js 5.1.1 downloads on first OCR use. English, French, Spanish, German and Portuguese language choices are available. The engine and selected language require an internet connection on first use. OCR is performed locally; language and engine requests go to jsDelivr and Project Naptha. Browser caches may retain downloaded engines/languages, but offline OCR is not guaranteed. Initial downloads or four-way orientation checks can take time on phones.

PDFs include an invisible, positioned text layer for unedited OCR words supported by built-in Helvetica (ASCII and Latin-1). Other characters remain visible in the scanned image and are preserved in the UTF-8 text download. Manually editing recognized text discards its word boxes to avoid exporting incorrect text locations; corrected text is available in the text download. This is not a PDF/A export or a guarantee of OCR accuracy.

Barcode detection uses the browser's native `BarcodeDetector` when available. The button is disabled in browsers that do not implement it. Recognition does not validate an ID or authenticate a document.

## Offline use and privacy

A service worker caches the complete application shell and the bundled jsPDF 4.2.1 engine after the first successful online visit. Camera scanning, imports and PDF export then work offline, subject to browser camera/storage restrictions. Cache installation is atomic and uses the actual root icon paths. Updates activate after older tabs close; the worker removes only this app's previous named caches.

The current draft is saved to IndexedDB after changes, and recovered when the app opens. If storage is unavailable/full, the interface warns you to export. Private browsing, clearing site data, or browser storage eviction can remove drafts. Do not rely on local recovery as your only copy. On a shared device, export and clear the document when finished. No analytics or document upload endpoint is used.

## Development and verification

No build step or runtime package installation is needed:

```sh
python -m http.server 8765
# Open http://localhost:8765
npm run check
npm test
```

Core tests cover page detection, invalid geometry, perspective mapping, aspect ratios, DPI/memory caps, enhancement, exposure/detail warnings, field extraction and deskew.

Browser integration checks require Python 3, Playwright, Pillow, Chromium and a DejaVu Sans font:

```sh
pip install -r tests/requirements.txt
python -m playwright install chromium
# Keep the local HTTP server running in another terminal.
python tests/browser_checks.py
# Optional: real OCR/orientation integration; downloads engines and language data.
SCANNER_TEST_OCR=1 python tests/browser_checks.py
```

Set `CHROMIUM_PATH` to use a system Chromium. The browser checks use generated document fixtures and a simulated camera; they cover capture/cancel, import/detection, page processing, reviewed text export, draft recovery, real PDF generation, offline reload/export, rotation invalidation and clear. Real phone cameras, focus, performance and iOS/Android permission behavior still require device testing.

The `scan-core.js` module contains pure algorithms; `script.js` owns the app state and browser interactions. jsPDF is vendored with its MIT license in `vendor/`. Tests and syntax checks run through GitHub Actions.
