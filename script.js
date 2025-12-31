const video = document.getElementById("preview");
const canvas = document.getElementById("captureCanvas");
const ctx = canvas.getContext("2d");
const statusBox = document.getElementById("status");

let stream = null;
let pages = [];

const PAGE_MM = { width: 210, height: 297 };
const DPI = 300;

/* ---------------- CAMERA ---------------- */
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    video.srcObject = stream;
    statusBox.textContent = "Camera ready";
  } catch {
    statusBox.textContent = "Camera permission denied";
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

/* ---------------- CAPTURE ---------------- */
function capturePage() {
  if (!stream) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  const normalized = normalize(canvas);
  pages.push(normalized);

  stopCamera();
  release(canvas);

  statusBox.textContent = `Page ${pages.length} captured`;
}

/* ---------------- NORMALIZE ---------------- */
function mmToPx(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

function normalize(source) {
  const w = mmToPx(PAGE_MM.width, DPI);
  const h = mmToPx(PAGE_MM.height, DPI);

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;

  temp.getContext("2d").drawImage(source, 0, 0, w, h);
  return temp;
}

function release(cnv) {
  cnv.width = 0;
  cnv.height = 0;
}

/* ---------------- EXPORT ---------------- */
function exportPDF() {
  if (pages.length === 0) return;

  const pdf = new window.jspdf.jsPDF("p", "mm", "a4");

  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(p.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297);
    release(p);
  });

  pages = [];
  pdf.save("JUO_Legacy_Scan.pdf");
  statusBox.textContent = "PDF exported";
}

function exportPNG() {
  if (pages.length === 0) return;

  const p = pages.pop();
  const a = document.createElement("a");
  a.href = p.toDataURL("image/png");
  a.download = "JUO_Legacy_Scan.png";
  a.click();

  release(p);
  statusBox.textContent = "PNG exported";
}

/* ---------------- EVENTS ---------------- */
document.getElementById("startCameraBtn").onclick = startCamera;
document.getElementById("captureBtn").onclick = capturePage;
document.getElementById("exportPdfBtn").onclick = exportPDF;
document.getElementById("exportPngBtn").onclick = exportPNG;
