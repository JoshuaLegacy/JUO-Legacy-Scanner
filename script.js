/* ============================================================
   JUO Legacy Scanner - Steps 1-5 with Help Modal + Progress
   Author: Joshua Orizu
   ============================================================ */

/* ------------------------------
   DOM REFERENCES
-------------------------------- */
const video = document.getElementById("preview");
const canvas = document.getElementById("captureCanvas");
const ctx = canvas.getContext("2d");
const statusDiv = document.getElementById("status");
const pageFormatSelect = document.getElementById("pageFormat");
const dpiSelect = document.getElementById("dpiSelect");
const qualitySlider = document.getElementById("qualitySlider");
const qualityValue = document.getElementById("qualityValue");

const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const closeBtn = document.querySelector(".closeBtn");

const progressBar = document.getElementById("progressBar");

let stream = null;

/* ------------------------------
   PAGE SIZE DEFINITIONS
-------------------------------- */
const PAGE_SIZES = {
  A4: { widthMM: 210, heightMM: 297 },
  A3: { widthMM: 297, heightMM: 420 },
  LETTER: { widthMM: 216, heightMM: 279 }
};

/* ------------------------------
   STEP 1: CAMERA CONTROL
-------------------------------- */
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    video.srcObject = stream;
  } catch (err) {
    alert("Media permission denied: " + err.name);
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

/* ------------------------------
   STEP 2: CAPTURE & NORMALIZATION
-------------------------------- */
function capturePage() {
  if (!stream) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  stopCamera();

  handleCapturedPage(canvas);
}

function mmToPixels(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

function normalizePage(sourceCanvas, pageFormat, dpi) {
  const size = PAGE_SIZES[pageFormat];
  const targetWidth = mmToPixels(size.widthMM, dpi);
  const targetHeight = mmToPixels(size.heightMM, dpi);

  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d");

  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;

  tempCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

  return tempCanvas;
}

function exportPage(canvas, format = "image/jpeg", quality = 0.85) {
  return canvas.toDataURL(format, quality);
}

function releaseCanvas(cnv) {
  cnv.width = 0;
  cnv.height = 0;
}

/* ------------------------------
   STEP 3 & 4: PDF ASSEMBLY WITH OPTIONS + PROGRESS
-------------------------------- */
let pdf = null;
let pageCount = 0;

function handleCapturedPage(sourceCanvas) {
  const selectedFormat = pageFormatSelect.value;
  const selectedDPI = parseInt(dpiSelect.value);
  const selectedQuality = parseFloat(qualitySlider.value);

  const normalizedCanvas = normalizePage(sourceCanvas, selectedFormat, selectedDPI);
  const pageData = exportPage(normalizedCanvas, "image/jpeg", selectedQuality);

  releaseCanvas(sourceCanvas);
  releaseCanvas(normalizedCanvas);

  if (!pdf) {
    pdf = new jspdf.jsPDF({ unit: "pt", format: selectedFormat.toLowerCase() });
    pdf.addImage(pageData, "JPEG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
    pageCount = 1;
  } else {
    pdf.addPage();
    pdf.addImage(pageData, "JPEG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
    pageCount++;
  }

  statusDiv.innerText = `Page ${pageCount} captured and added to PDF.`;
  setTimeout(() => { statusDiv.innerText = ""; }, 3000);

  // Update progress bar
  progressBar.style.width = Math.min(100, pageCount) + "%";

  console.log(`Page ${pageCount} added to PDF.`);
}

/* ------------------------------
   STEP 5: IMAGE QUALITY SLIDER
-------------------------------- */
qualitySlider.addEventListener("input", () => {
  qualityValue.innerText = qualitySlider.value;
});

/* ------------------------------
   DOWNLOAD PDF
-------------------------------- */
document.getElementById("downloadPdfBtn").addEventListener("click", () => {
  if (!pdf) {
    alert("No pages captured yet!");
    return;
  }
  pdf.save("JUO_Legacy_Scanner.pdf");

  pdf = null;
  pageCount = 0;
  progressBar.style.width = "0%";
});

/* ------------------------------
   HELP / GUIDE MODAL
-------------------------------- */
helpBtn.addEventListener("click", () => {
  helpModal.style.display = "block";
});

closeBtn.addEventListener("click", () => {
  helpModal.style.display = "none";
});

window.addEventListener("click", (event) => {
  if (event.target === helpModal) {
    helpModal.style.display = "none";
  }
});

/* ------------------------------
   EVENT BINDINGS
-------------------------------- */
document.getElementById("startCameraBtn").addEventListener("click", startCamera);
document.getElementById("captureBtn").addEventListener("click", capturePage);
