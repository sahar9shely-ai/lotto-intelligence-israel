import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function waitForFonts(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // ignore
  }
}

export function mountPdfNode(html: string, styles: string): HTMLElement {
  const host = document.createElement("div");
  host.className = "pdf-root";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;pointer-events:none;opacity:1;z-index:-1;";
  const style = document.createElement("style");
  style.textContent = styles;
  host.appendChild(style);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  host.appendChild(wrap);
  document.body.appendChild(host);
  return host;
}

export function canvasToPdf(canvas: HTMLCanvasElement, fileName: string): void {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 8;
  const marginY = 8;
  const usableWidth = pageWidth - marginX * 2;
  const usableHeight = pageHeight - marginY * 2;
  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  let imgWidth = usableWidth;
  let imgHeight = (canvas.height * imgWidth) / canvas.width;

  if (imgHeight <= usableHeight * 1.12) {
    if (imgHeight > usableHeight) {
      const scale = usableHeight / imgHeight;
      imgWidth *= scale;
      imgHeight = usableHeight;
    }
    const offsetX = marginX + (usableWidth - imgWidth) / 2;
    pdf.addImage(imgData, "JPEG", offsetX, marginY, imgWidth, imgHeight, undefined, "FAST");
    pdf.save(fileName);
    return;
  }

  let heightLeft = imgHeight;
  let position = marginY;
  pdf.addImage(imgData, "JPEG", marginX, position, imgWidth, imgHeight, undefined, "FAST");
  heightLeft -= usableHeight;

  while (heightLeft > 8) {
    position = marginY - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", marginX, position, imgWidth, imgHeight, undefined, "FAST");
    heightLeft -= usableHeight;
  }

  pdf.save(fileName);
}

export async function renderHtmlToPdf(
  html: string,
  styles: string,
  fileName: string,
): Promise<void> {
  await waitForFonts();
  const host = mountPdfNode(html, styles);
  const sheet = host.querySelector(".pdf-sheet") as HTMLElement | null;
  if (!sheet) {
    host.remove();
    throw new Error("לא ניתן לבנות את מסמך ה-PDF");
  }

  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = await html2canvas(sheet, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: sheet.scrollWidth,
      windowHeight: sheet.scrollHeight,
    });
    canvasToPdf(canvas, fileName);
  } finally {
    host.remove();
  }
}

/** Shared base styles for תזרים PDF documents. */
export const PDF_BASE_STYLES = `
  .pdf-root * { box-sizing: border-box; }
  .pdf-sheet {
    width: 794px;
    padding: 36px 44px 28px;
    background: #ffffff;
    color: #0e2a22;
    font-family: "Rubik", "Segoe UI", Tahoma, sans-serif;
    line-height: 1.4;
    direction: rtl;
    text-align: right;
  }
  .pdf-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    padding-bottom: 14px;
    border-bottom: 1px solid #d7e4dd;
  }
  .pdf-brand__mark {
    display: block;
    font-family: "Frank Ruhl Libre", "Times New Roman", serif;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #0e2a22;
  }
  .pdf-brand__tag {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    color: #5a7369;
  }
  .pdf-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    font-size: 11px;
    color: #5a7369;
  }
  .pdf-badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 999px;
    background: #f0e6d4;
    color: #8a6a2f;
    font-size: 10px;
    font-weight: 600;
  }
  .pdf-hero { margin-bottom: 18px; }
  .pdf-hero h1 {
    margin: 0 0 6px;
    font-family: "Frank Ruhl Libre", "Times New Roman", serif;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.12;
    color: #0e2a22;
  }
  .pdf-hero__sub {
    margin: 0;
    font-size: 14px;
    color: #456056;
  }
  .pdf-kpis {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    margin-bottom: 22px;
  }
  .pdf-kpis--4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
  .pdf-kpi {
    padding: 12px 14px;
    border-radius: 12px;
    background: #f4faf7;
    border: 1px solid #d5e5db;
  }
  .pdf-kpi--accent {
    background: #0e2a22;
    border-color: #0e2a22;
    color: #eef7f2;
  }
  .pdf-kpi--accent .pdf-kpi__label { color: #a8c4b8; }
  .pdf-kpi__label {
    display: block;
    margin-bottom: 4px;
    font-size: 11px;
    color: #5a7369;
  }
  .pdf-kpi__value {
    display: block;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .pdf-section-title { margin-bottom: 10px; }
  .pdf-section-title h2 {
    margin: 0 0 2px;
    font-family: "Frank Ruhl Libre", "Times New Roman", serif;
    font-size: 20px;
    font-weight: 700;
  }
  .pdf-section-title p {
    margin: 0;
    font-size: 12px;
    color: #5a7369;
  }
  .pdf-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }
  .pdf-table thead th {
    padding: 8px 8px;
    background: #eef5f1;
    color: #456056;
    font-weight: 600;
    text-align: right;
    border-bottom: 1px solid #c9dbd1;
  }
  .pdf-table td {
    padding: 6px 8px;
    border-bottom: 1px solid #e4eee8;
    text-align: right;
  }
  .pdf-table tr.even td { background: #fafcfb; }
  .pdf-table .col-num { font-variant-numeric: tabular-nums; font-weight: 600; }
  .pdf-table .muted { color: #5a7369; font-weight: 500; }
  .pdf-totals {
    margin-top: 16px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #d5e5db;
  }
  .pdf-totals__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 11px 14px;
    background: #f4faf7;
    font-size: 14px;
  }
  .pdf-totals__row--final {
    background: #0e2a22;
    color: #eef7f2;
    font-size: 16px;
  }
  .pdf-footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #d7e4dd;
  }
  .pdf-footer p {
    margin: 0;
    font-size: 10px;
    color: #7a9087;
  }
  .pdf-status {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
  }
  .pdf-status--paid { background: #d8f0e4; color: #1f6b55; }
  .pdf-status--scheduled { background: #f0e6d4; color: #8a6a2f; }
  .pdf-status--skipped { background: #eceff1; color: #546e7a; }
`;
