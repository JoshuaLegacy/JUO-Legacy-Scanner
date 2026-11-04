# JUO Legacy Scanner

A static, browser-based document scanner by Joshua Orizu. Camera images, recognized text and reviewed fields are processed on the device. No document upload service or account is required.

## User guide

Read the complete [User Guide](USER_GUIDE.md) for the current capture, editing/retake, undo, OCR review, language downloads, barcode, export and recovery workflows. In the app, select **Guide** for the offline instructions. The sections below also document technical limits and development checks.

## Scan a document

1. Open the app over HTTPS (or localhost). Start the rear camera, or import a JPEG/PNG/WebP image. Allow camera access when prompted.
2. Place the document on a contrasting surface under even light. The preview gives heuristic focus, exposure and shadow warnings. Automatic capture is optional and waits for a stable detected page.
3. Capture and check all four corners. Drag the corner handles or use the keyboard-accessible corner sliders. Perspective correction turns the selected quadrilateral into a rectangle. Rotate before adding if needed.
4. Choose Original, Color Document, Grayscale or Black & White before adding a page. Document modes reduce uneven illumination using local contrast normalization; optional text deskew corrects small angles up to 5°.
5. Review page thumbnails. Reorder/delete pages, or open **Edit / Retake** to adjust a saved page. Rotate opens a preview that must be saved. Crop/straighten, change enhancement mode, or capture/import a replacement, then choose **Save changes** or **Cancel**. A saved replacement keeps the page in its original document position. **Undo edit** restores the image and text from before the last saved image edit; there is one undo version per page, including after a successful local-draft save and reload.
6. Open **Text / identify**, choose a language, recognize text, and review the result. Optional orientation detection compares four rotations and corrects the image when recognition improves. It takes longer than recognizing upright text.
7. Review the suggested document category and fields. The app combines category cues and extracts dates, totals, invoice numbers, contact details, tax, due dates, ID labels or statement balances where present. These are heuristic suggestions, not verified facts or identity verification. QR/barcodes use native detection where available and a bundled ZXing fallback otherwise; scanned links are never opened automatically.
8. Download the PDF and/or UTF-8 text. Downloads keep the draft. **Clear document** explicitly removes the saved pages and text from this browser.

## Editing saved pages

New pages retain a bounded source JPEG before perspective correction and enhancement, together with their crop, enhancement and rotation settings. The editor reprocesses this retained source for each preview, rather than repeatedly recompressing the last enhanced result. Save commits the preview; Cancel discards temporary changes. Crop uses the existing corner controls and optional guided book correction. Camera retakes and replacement photos do not overwrite a saved page until accepted with Save. Cancelling a retake, denying camera permissions or receiving a late permission response leaves the saved page intact and releases its camera tracks.

Older drafts without a retained source still open using their saved image. The editor explains that lost color, cropped content or original detail cannot be recovered. After saving, that available image becomes the retained source for future edits. Retaking/importing a replacement supplies a new source.

Image edits invalidate positioned OCR words. Previously reviewed text and fields are retained and labelled **text needs review**, with a reference copy in Text / identify. They are excluded from PDF search until recognition is run again or you explicitly confirm that the text and fields match the edited image and save the review. UTF-8 text downloads label retained, unreviewed text. This prevents a replacement photo from silently exporting stale searchable text. One-step undo restores the previous image, source, settings and recognition state; later edits replace that undo version.

Sources and undo versions increase local storage and memory use. Browser quotas/eviction still apply. A failed local save warns that the current edit is only in memory: export before closing the tab. Clearing a page/document also removes its source and undo record from the active draft. Brightness/contrast sliders and a multi-step edit history are not included in this version.

## Quality and resource limits

- The camera requests up to 3840 × 2160 and continuous focus where supported. The browser/device decides the actual resolution and focus capabilities.
- Edge detection checks smoothed light and dark regions and falls back to page boundary lines. Dark paper, textured backgrounds and modest contrast are supported, but ambiguous or partially hidden pages may require manual corners. Inspect every detected corner.
- For a curved book page, select one page, open **Flatten a curved book page**, enable guided correction, and adjust the top/bottom edge curves using the preview. This corrects smooth vertical bowing; it is not automatic 3D reconstruction, cannot restore hidden text, and does not correct every form of spine distortion. Closing the controls keeps the enabled correction; uncheck it to disable.
- Preview quality checks operate on the detected page when available. Local exposure comparisons reduce false glare warnings on white paper, while contrast/detail and uneven lighting remain heuristic checks.
- Quality warnings estimate detail and exposure; they cannot guarantee readability or distinguish every white page from glare. Check the saved preview.
- Paper formats: A4, A3 and Letter. Landscape images use landscape pages. Images are centered with their proportions preserved; unused paper stays blank.
- DPI sets the output pixel ceiling relative to the selected paper. Images are never enlarged to pretend to have more detail. Working/output images are limited to 4 megapixels, so high DPI may be capped below the selected value on large paper.
- Imported files must be under 30 MB and 40 megapixels. Decoding a large image can still use substantial memory. Page JPEGs remain in memory and in local IndexedDB: export long documents in batches. There is no promise of unlimited or 100+ page scanning.

## OCR, identification and search

Tesseract.js 5.1.1 is bundled locally. Fourteen language packs are available: English, French, Spanish, German, Portuguese, Arabic, Hindi, simplified Chinese, Russian, Ukrainian, Japanese, Korean, Yoruba and Italian. Language recognition does not imply multilingual category/field extraction: classification cues and most field labels currently target English documents.

Choose a language and use **Download language for offline use** while connected. The app downloads the shared LSTM core and selected fast language model, checks exact byte lengths and SHA-256 hashes, and saves them separately from the application shell. The status reports readiness only when both are present. The English pack plus shared core is about 7.7 MB; other language sizes vary. Recognition can prepare a missing pack automatically while online. Downloads and recognition can be cancelled. Completed valid shared downloads are retained for retry; failed or corrupted downloads are not accepted as ready. A downloaded language can be removed without clearing scanned documents.

Models are pinned to a `tessdata_fast` Git commit; engine assets are pinned to Tesseract core 5.1.1. Remote downloads go to jsDelivr and raw.githubusercontent.com, and carry no scanned images. Workers read prepared assets through same-origin service-worker routes, so fresh recognition works after an offline reload. Browser data eviction or clearing site storage can remove packs: check readiness again before relying on offline use. Initial setup requires a browser with service workers and CacheStorage over HTTPS or localhost.

PDFs use Unicode `/ActualText` marked content in PDF 1.7. Unedited OCR words retain their coordinates. Reviewed text, including manual corrections and added lines, remains searchable with approximate line positions when the original word boxes are no longer valid. The text layer never changes the visible scan. Unicode extraction has been tested with Poppler across Latin, Greek, Cyrillic, Chinese, Hindi and emoji; PDF-reader search/selection behavior can vary, especially for bidirectional text. UTF-8 text export remains available. This is not PDF/A or a guarantee of OCR accuracy.

Barcode recognition uses the native `BarcodeDetector` first, then a bundled ZXing 0.21.3 decoder for QR and common 1D/2D formats. The fallback checks four rotations and works offline after the shell is cached. The current UI returns one decoded result per page; it does not promise to enumerate every barcode. Recognition does not validate an ID or authenticate a document.

## Offline use and privacy

A service worker caches the complete application shell and the bundled jsPDF 4.2.1 engine after the first successful online visit. Camera scanning, imports, PDF export and barcode fallback then work offline, subject to browser camera/storage restrictions. OCR also works offline once its selected language pack is ready. Cache installation is atomic and uses the actual root icon paths. Updates activate after older tabs close; the worker removes only this app's previous named caches.

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

Browser integration checks require Python 3, Playwright, Pillow, Chromium, Poppler (`pdftotext`) and a DejaVu Sans font:

```sh
pip install -r tests/requirements.txt
python -m playwright install chromium
# Keep the local HTTP server running in another terminal.
python tests/browser_checks.py
python tests/followup_checks.py
python tests/editor_checks.py
# Optional: real OCR/orientation integration; downloads engines and language data.
SCANNER_TEST_OCR=1 python tests/browser_checks.py
# Verify a fresh worker can recognize text after an offline reload:
python tests/fetch_ocr_fixtures.py
SCANNER_TEST_OFFLINE_OCR=1 SCANNER_ASSET_FIXTURES=/tmp/scanner-ocr-fixtures python tests/followup_checks.py
```

Set `CHROMIUM_PATH` to use a system Chromium and `SCANNER_URL` to test another local server URL. The optional asset-fixture test downloads and verifies real pinned engines/models before supplying them to browser download requests; the worker itself then runs with networking disabled. The browser checks use generated document fixtures and a simulated camera; they cover capture/cancel, import/detection, page processing, reviewed text export, draft recovery, real PDF generation, offline reload/export, rotation invalidation and clear. Real phone cameras, focus, performance and iOS/Android permission behavior still require device testing.

The `scan-core.js` module contains pure algorithms; `script.js` owns app state and browser interactions. `page-model.js` handles immutable edit/undo transactions and `page-editor.js` owns temporary previews, crop integration and retake camera cleanup. `offline-ocr.js` manages verified packs, `ocr-assets.json` pins their origins and hashes, and `pdf-text.js` writes Unicode replacement text. Third-party jsPDF, Tesseract, ZXing and model licenses are retained in `vendor/`. GitHub Actions runs syntax, algorithm and browser checks, including real offline OCR with the prepared English pack.
