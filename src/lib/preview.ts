// Lightweight previews for supported inputs (images and first page of PDFs).
// Returns object URLs the caller must revoke.
import { loadPdfjs } from "./pdfjs";

const IMAGE_EXTS = ["JPG", "JPEG", "PNG", "WEBP", "GIF", "BMP", "AVIF", "TIFF", "TIF", "SVG"];

const getExt = (name: string) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : "";
};

export function canPreview(file: File): boolean {
  const ext = getExt(file.name);
  if (file.type.startsWith("image/") || IMAGE_EXTS.includes(ext)) return true;
  if (file.type === "application/pdf" || ext === "PDF") return true;
  return false;
}

export async function makePreview(file: File): Promise<string | null> {
  const ext = getExt(file.name);
  if (file.type.startsWith("image/") || IMAGE_EXTS.includes(ext)) {
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }
  if (file.type === "application/pdf" || ext === "PDF") {
    try {
      const pdfjs = await loadPdfjs();
      const buf = await file.arrayBuffer();
      const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
      const doc = await task.promise;
      try {
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(200 / viewport.width, 260 / viewport.height, 1.5);
        const scaled = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(scaled.width);
        canvas.height = Math.ceil(scaled.height);
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport: scaled, canvas }).promise;
        const blob: Blob = await new Promise((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("preview encode failed"))),
            "image/png",
          ),
        );
        return URL.createObjectURL(blob);
      } finally {
        task.destroy();
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Render up to `maxPages` pages of a PDF blob into PNG object URLs. */
export async function renderPdfPages(blob: Blob, maxPages = 30, scale = 1.25): Promise<string[]> {
  const urls: string[] = [];
  try {
    const pdfjs = await loadPdfjs();
    const buf = await blob.arrayBuffer();
    const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
    const doc = await task.promise;
    try {
      const count = Math.min(doc.numPages, maxPages);
      for (let i = 1; i <= count; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        const pngBlob: Blob = await new Promise((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"),
        );
        urls.push(URL.createObjectURL(pngBlob));
      }
    } finally {
      task.destroy();
    }
  } catch {
    // partial results returned if any
  }
  return urls;
}
