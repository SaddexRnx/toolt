// Lightweight previews for supported inputs (images and first page of PDFs).
// Returns object URLs the caller must revoke.

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
      const pdfjs = await import("pdfjs-dist");
      // Use bundled worker via Vite ?url import
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl;
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
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
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("preview encode failed"))), "image/png"),
      );
      doc.destroy();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }
  return null;
}
