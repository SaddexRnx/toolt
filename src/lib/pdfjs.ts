// Single pdf.js entry point.
//
// The modern pdf.js v6 worker calls `Uint8Array.prototype.toHex()`, a method
// that only exists in Chrome 131+, Safari 18.2+ and Firefox 133+. On older
// browsers every pdf.js-backed tool failed with "a.toHex is not a function".
// The legacy bundles ship the polyfill, so every consumer loads this module.
export type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!loading) {
    loading = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
      (
        pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
      ).GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
    loading.catch(() => {
      loading = null; // allow a retry after a failed chunk load
    });
  }
  return loading;
}
