document.addEventListener("DOMContentLoaded", () => {

  const video = document.getElementById("preview");
  const canvas = document.getElementById("captureCanvas");
  const ctx = canvas.getContext("2d");

  const startCameraBtn = document.getElementById("startCameraBtn");
  const captureBtn = document.getElementById("captureBtn");
  const downloadPdfBtn = document.getElementById("downloadPdfBtn");
  const helpBtn = document.getElementById("helpBtn");

  const pageFormatSelect = document.getElementById("pageFormat");
  const dpiSelect = document.getElementById("dpiSelect");
  const qualitySlider = document.getElementById("qualitySlider");
  const qualityValue = document.getElementById("qualityValue");

  const progressBar = document.getElementById("progressBar");
  const statusDiv = document.getElementById("status");

  const helpModal = document.getElementById("helpModal");
  const closeBtn = document.querySelector(".closeBtn");

  let stream = null;
  let pdf = null;
  let pageCount = 0;

  const PAGE_SIZES = {
    A4: [210, 297],
    A3: [297, 420],
    LETTER: [216, 279]
  };

  function mmToPx(mm, dpi) {
    return (mm / 25.4) * dpi;
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      video.srcObject = stream;
    } catch {
      alert("Camera permission denied");
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function capturePage() {
    if (!stream) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    stopCamera();
    processPage();
  }

  function processPage() {
    const format = pageFormatSelect.value;
    const dpi = parseInt(dpiSelect.value);
    const quality = parseFloat(qualitySlider.value);

    const [wMM, hMM] = PAGE_SIZES[format];
    const wPx = mmToPx(wMM, dpi);
    const hPx = mmToPx(hMM, dpi);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = wPx;
    tempCanvas.height = hPx;
    tempCanvas.getContext("2d").drawImage(canvas, 0, 0, wPx, hPx);

    const imgData = tempCanvas.toDataURL("image/jpeg", quality);

    if (!pdf) {
      pdf = new jspdf.jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: format.toLowerCase()
      });
    } else {
      pdf.addPage();
    }

    pdf.addImage(
      imgData,
      "JPEG",
      0,
      0,
      pdf.internal.pageSize.getWidth(),
      pdf.internal.pageSize.getHeight()
    );

    pageCount++;
    updateProgress();

    statusDiv.innerText = `Page ${pageCount} captured`;
  }

  function updateProgress() {
    const percent = Math.min((pageCount / 100) * 100, 100);
    progressBar.style.width = percent + "%";
  }

  startCameraBtn.onclick = startCamera;
  captureBtn.onclick = capturePage;

  downloadPdfBtn.onclick = () => {
    if (!pdf || pageCount === 0) {
      alert("No pages captured yet");
      return;
    }
    pdf.save("JUO_Legacy_Scanner.pdf");
    pdf = null;
    pageCount = 0;
    progressBar.style.width = "0%";
  };

  qualitySlider.oninput = () => {
    qualityValue.innerText = qualitySlider.value;
  };

  helpBtn.onclick = () => helpModal.style.display = "block";
  closeBtn.onclick = () => helpModal.style.display = "none";
  window.onclick = e => {
    if (e.target === helpModal) helpModal.style.display = "none";
  };

});
