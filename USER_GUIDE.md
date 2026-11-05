# JUO Legacy Scanner — User Guide

For version 3.3.0 · Updated 5 November 2026

[Open JUO Legacy Scanner](https://joshualegacy.github.io/JUO-Legacy-Scanner/). The same instructions are available inside the app through **Guide**, including when the app has been cached for offline use.

## 1. Scan your first document

1. Open the scanner in a current browser. Use the HTTPS site and allow camera access when prompted.
2. Choose **Paper size**, **Processing detail limit**, **Output resolution**, **Enhancement**, and **JPEG quality** before capturing. **Original / preserve colors** is the default. Leave brightness and contrast at zero for an unchanged starting image. These settings apply when you add the page.
3. Put the document on a flat surface in even light. A contrasting background helps the scanner find its edges. Keep all four page corners visible and avoid glare, fingers, and heavy shadows.
4. Select **Start camera**. Once ready, **Camera resolution** lists the modes the browser reports. Choose a higher supported mode if needed, check the actual resolution status, then select **Capture page**. Alternatively, choose **Import image** and select a JPEG, PNG, or WebP photo.
5. In **Adjust document edges**, inspect the outline. Drag each corner to the document edge, or select a corner and use the **Horizontal** and **Vertical** sliders. Use **Detect edges**, **Use full image**, or **Rotate 90°** if needed; check the corners again after rotating.
6. Leave **Straighten text (up to 5°)** checked to correct a small tilt, or uncheck it if the result looks worse. Select **Add page** when ready, or **Cancel** to discard this capture.
7. Check the saved thumbnail. Select **Start camera** again for the next page. Capture pauses the camera while you crop; **Add page** still needs your confirmation.
8. Name the document, choose **Export format** (PDF, JPEG, or PNG) and **Export pages**, then select the download button. For PDF, select **Download PDF**. To make the PDF searchable, recognize and review its text first as described below.

## 2. Capture controls and quality advice

**Stop camera** releases the camera. The scanner also stops camera access when you leave the page or switch away from it. Start it again when you return.

Optional **Capture automatically when a document is steady and clear** waits for a detected page to stay steady and pass the quality checks, then opens the crop screen. It does not automatically accept the crop or save the page. If it does not trigger, use **Capture page** manually.

**Automatically crop and add confidently detected pages** is a separate option. When enabled, a strong boundary match skips manual cropping and adds the page. Uncertain outlines stay on the crop screen for review. You can also select **Auto crop** in that screen to detect and accept a confident boundary in one step. Auto-capture controls when a photograph is taken; auto-crop controls whether its boundary is accepted. Retained source images let you correct a crop later through Edit / Retake.

The preview can warn about low detail, darkness, low contrast, possible glare, or uneven lighting. Hold the phone steady, clean the lens, add diffuse light, or change the light's angle. Detection checks matching color outlines, light and dark page regions, and page boundaries. Matching hues across a colored cover and its footer are grouped so a white printed panel is less likely to truncate the page. However, difficult backgrounds may still need manual corners. Warnings and outlines are guidance: inspect the image yourself, especially names, small print, and faint text.

## 3. Paper, resolution, and enhancement

| Setting                        | How to choose                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Paper size**                 | A4, A3, or Letter. Landscape images use landscape pages. Proportions are preserved and unused paper stays blank.                                                                                                                                                                                                          |
| **Camera resolution**          | Available after starting the camera. Modes come from browser-reported capabilities. Where supported, the app requests a high-resolution still photo; otherwise it uses the actual video frame. The status reports the returned dimensions. Sensor megapixels advertised on the phone may not be available to the browser. |
| **Processing detail limit**    | 4 MP is the balanced default; 8, 12, and 24 MP retain more source detail and use more memory. A higher camera choice raises this limit as needed, up to 24 MP. It never creates pixels missing from the camera or imported source.                                                                                        |
| **Output resolution**          | **Source detail** avoids an extra DPI resize. Optional 150, 300, or 400 DPI limits pixel size relative to the selected paper. Higher DPI cannot recover missing detail. Images are never enlarged, and the selected processing limit still applies.                                                                       |
| **Original / preserve colors** | The default, recommended for colored covers and photographs. With brightness and contrast at zero, no enhancement whitening is applied.                                                                                                                                                                                   |
| **Color document**             | Gentle global contrast that keeps dark printed colors dark. It no longer brightens each local region toward white.                                                                                                                                                                                                        |
| **Grayscale**                  | Removes color and applies gentle contrast.                                                                                                                                                                                                                                                                                |
| **Black & white**              | Adaptive black/white conversion for clear text. Inspect faint text, colored lettering and stamps because they can disappear.                                                                                                                                                                                              |
| **Brightness / Contrast**      | Start at zero. Lower brightness if a scan looks too light, or add a little contrast if needed. Saved-page editing provides a preview before you accept the result.                                                                                                                                                        |
| **JPEG quality**               | Choose 0.5–1.0. Higher values usually give larger files. Start at 0.85 and inspect small text. This does not change a PNG into a JPEG; image export uses the selected file type.                                                                                                                                          |

Imported images must be at most 30 MB and 40 megapixels. Large files can still strain a phone's memory. Export long documents in batches rather than assuming an unlimited page count.

## 4. Correct a curved book page

Scan one book page at a time. In the crop screen, open **Flatten a curved book page** and enable **Apply guided book correction**. Adjust **Top edge curve** and **Bottom edge curve** while watching the preview. Aim for straight text rows, then add or accept the page.

Closing the controls keeps an enabled correction; uncheck **Apply guided book correction** to disable it. This is guided correction for smooth vertical bowing. It cannot reveal hidden text, separate two facing pages automatically, or correct every form of spine distortion. Flatten the book gently and keep the page well lit for the best starting image.

## 5. Manage and edit saved pages

Each thumbnail has these actions:

- **Edit / Retake:** opens a large preview for editing the selected page.
- **Text / identify:** opens text recognition, identification suggestions, and barcode reading.
- **Move earlier / Move later:** changes the page's position in the PDF and text download.
- **Rotate:** opens an edited preview; choose **Save changes** to apply it.
- **Undo edit:** restores the image, settings, and reviewed text from before the last saved image edit. It becomes available after an image edit is saved.
- **Delete:** removes that page after confirmation. Export a copy first if you need it.

Inside **Edit / Retake**, use **Crop / straighten**, **Rotate 90°**, enhancement, brightness/contrast, processing-detail/output-resolution choices, and the text-straightening checkbox. Changes are temporary until you choose **Save changes**. **Cancel** keeps the saved page; if you changed the preview, you will be asked whether to discard those changes.

The editor reports the retained source dimensions. A higher processing limit cannot restore pixels already missing from an older source; retake at a higher supported camera mode when needed.

New pages retain a source image so different enhancement choices can be tried without repeatedly processing the previous enhanced result. Older saved pages remain editable, but original colors, cropped content, or detail already removed cannot be recovered. The editor displays a notice for those pages.

There is one undo version per page, not a full edit history. A later saved image edit replaces it. Undo also restores the earlier text and fields, so later text reviews on that page will be replaced. Undo survives a reload only if the local draft was saved successfully. **Undo edit** does not undo a page deletion or **Clear document**.

## 6. Retake or replace one page

1. Choose **Edit / Retake** on the page to replace.
2. Select **Retake with camera**, choose an available **Retake resolution** if needed, align the document, and select **Capture replacement**. **Cancel retake** closes the camera without changing the saved page.
3. Alternatively, select **Replace from photo** and choose another image.
4. Check the replacement preview. Adjust its crop or enhancement if needed.
5. Choose **Save changes** to replace the selected page in its existing position. No extra page is appended. **Cancel** discards the temporary replacement.

Denied camera permission or an invalid replacement file leaves the saved page intact. You can try again or use **Replace from photo**. After saving, **Undo edit** restores the previous version.

## 7. Recognize text and make PDFs searchable

1. Select **Text / identify** on a saved page.
2. Choose **Text language**. Fourteen languages are available: English, French, Spanish, German, Portuguese, Arabic, Hindi, simplified Chinese, Russian, Ukrainian, Japanese, Korean, Yoruba, and Italian.
3. If needed, download the language while online. See the offline instructions below.
4. Optional **Detect text orientation** checks four rotations and corrects the page when recognition improves. Leave it on for sideways text; turn it off to save time on a clear, upright page.
5. Select **Recognize text**. Use **Cancel operation** if you want to stop.
6. Read and correct **Recognized text**, **Document type**, and **Suggested fields**. Pay particular attention to names, dates, document numbers, and amounts. Average confidence is a hint, not a guarantee.
7. Select **Save review** to accept the result. Closing without saving does not accept the new recognition result.
8. Repeat for other pages, then download the PDF or text file.

Reviewed text and manual corrections can be included in PDF search. Corrected text may have approximate selection positions, and the visible scan is not rewritten. Search/selection behavior varies by PDF reader, especially for right-to-left text. **Download text** provides a UTF-8 copy when you need the text separately.

## 8. Review text after an image edit

Saving an image edit or retake removes the old OCR word positions, because they may no longer match the image. Previously reviewed text and fields are retained, and the thumbnail shows **text needs review**. Open **Text / identify** to see the reference copy under **Text retained from before the image edit**.

Choose one of these routes:

- Run **Recognize text** again, review the fresh result, and select **Save review**.
- Compare and correct the retained text and fields against the edited page. Check **I have checked this text and its fields against the edited page**, then select **Save review**.

Until that review is saved, retained text is excluded from PDF search. A text download labels it as retained text needing review. The reference copy is available for comparison; it is not automatically accepted as current text.

## 9. Document identification and suggested fields

The app suggests Document, Invoice, Receipt, Letter, ID document, Bank statement, Business card, or Form. Depending on the text, it may suggest dates, totals, invoice numbers, tax, due dates, email/phone/website details, ID labels, or statement balances. Statement account suggestions show the last four digits where detected.

These are editable suggestions based on text cues, primarily English field labels. Choosing an OCR language does not mean identification supports every document in that language. Check the category and every extracted value. Identification does not authenticate documents or verify a person's identity.

## 10. Read a QR code or barcode

Open **Text / identify** and select **Read QR / barcode**. The scanner uses browser support where available and a bundled fallback otherwise. It can read QR and common barcode formats from the page image, including when the app is cached offline.

Review the decoded value under **Suggested fields**, then select **Save review** if you want to keep it. Links are not opened automatically. For a missing code, try a sharper, closer image with the entire code and a clear border visible. Do not assume that every code on a page will be listed.

## 11. Prepare for offline scanning and OCR

1. Open the app while online so its scanning, editing, export, barcode, and Guide files can be cached.
2. Open **Text / identify**, select a language, and choose **Download language for offline use**. Recognition can also prepare a missing language automatically while online.
3. Wait for **Language downloaded and ready for offline OCR**. The shared engine plus English model is about 7.7 MB; other language sizes vary. The app checks downloads before reporting readiness.
4. Before relying on offline work, turn off the connection, reopen the app, and try the workflow you need. Camera access and storage still depend on the browser.

**Cancel operation** stops a download or recognition. Completed shared assets may remain for a retry. **Remove downloaded language** removes the selected model without deleting scanned pages; a shared engine may remain for other languages. Select and download any additional languages separately.

Clearing browser data or storage eviction can remove downloaded languages. Check readiness again before a trip or other offline session. If a language is missing while offline, reconnect and download it before recognizing text.

## 12. Export, draft recovery, and privacy

Set **Document name** before downloading. **Export format** offers PDF, JPEG, and PNG, and **Export pages** selects all pages or one saved page. PDF keeps selected pages in one document with eligible reviewed search text. A single JPEG or PNG downloads directly as an image; multiple images download together in a ZIP with numbered filenames. Images do not contain a searchable OCR text layer. PNG is a real lossless file encoding of the saved page, but converting an older saved JPEG cannot undo its earlier compression or recover lost colors. Image exports work offline after the app is cached. **Download text** exports available page text and fields in UTF-8. It becomes available when at least one page has saved text; barcode values or fields alone do not enable it, so copy those values from Suggested fields if needed. Downloading keeps the current draft so you can continue working; it does not reset the document.

The current draft, retained source images, and one undo version per page are saved locally in this browser when storage succeeds. Reopening the app restores that draft. This is one current draft, not a library of separate projects. Private browsing, browser cleanup, storage limits, or eviction can remove it.

If the app says a draft or edit could not be saved, the current pages may exist only in memory. Export immediately before closing the tab. Keep downloaded copies of important documents rather than relying on recovery alone.

Camera images, OCR, editing, and identification run on the device. No document upload or account is required. Initial app, engine, and language downloads still use an internet connection. On a shared device, export what you need and use **Clear document** to remove the current pages, reviewed text, sources, and undo records from the active draft. Clearing does not delete PDFs/text files already downloaded to your device, and removing an OCR language is a separate action.

## 13. Troubleshooting and updates

| Problem                                             | What to do                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Camera does not open                                | Use the HTTPS site, allow camera access in browser settings, and close other apps using the camera. Try Import image or Replace from photo if camera access is unavailable.                                                          |
| Camera stopped after switching apps                 | Select Start camera or Retake with camera again. Camera streams stop when the scanner is hidden.                                                                                                                                     |
| Automatic capture does not trigger                  | Hold steady, improve light/background contrast, or select Capture page manually.                                                                                                                                                     |
| Page edges are wrong                                | Drag the four corners, use their sliders, or choose Use full image and crop manually.                                                                                                                                                |
| Text or stamps disappeared                          | In Edit / Retake, choose Original / preserve colors and start with brightness/contrast at zero. A previously whitened PDF cannot recover clipped detail by changing file type; restore from the retained source or retake if needed. |
| Sideways or inaccurate OCR                          | Check the language, enable Detect text orientation, rotate/retake if needed, and review the result. Higher DPI alone cannot fix blur.                                                                                                |
| Edited page is no longer searchable                 | Open Text / identify and recognize again, or explicitly confirm and save the reviewed text against the edited page.                                                                                                                  |
| Offline OCR fails                                   | Check that the selected language is downloaded and ready. Reconnect and retry the download if it is missing, incomplete, or was removed.                                                                                             |
| PDF or image ZIP is too large or the app slows down | Use a smaller processing-detail limit, 150 DPI, or lower JPEG quality, and export smaller batches or individual images. High-detail PNG archives can be particularly large.                                                          |
| Local recovery failed                               | Export the current in-memory document before closing. Free browser storage if needed, but export before clearing site data.                                                                                                          |
| New features or the updated Guide do not appear     | Reconnect, close all scanner tabs/windows, then reopen the site so the cached app can update. Export unsaved work first.                                                                                                             |

For a colored cover that looked faint in an earlier release, first try **Edit / Retake → Original** using its retained source. The old whitening effect has been removed from Color document. Re-export after saving the corrected preview.

Review real results on your device: camera focus, memory limits, PDF readers, and browser permissions differ between phones.
