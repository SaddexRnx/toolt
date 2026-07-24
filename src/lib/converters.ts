// All conversions run client-side. Each converter takes File(s) and returns a Blob + filename.
// Kept intentionally lightweight — heavy libs (pdfjs, ffmpeg.wasm) can be added later.

export type ConvertResult = { blob: Blob; filename: string };
export type ConverterFn = (files: File[]) => Promise<ConvertResult>;

export type Converter = {
  id: string;
  from: string; // source extension label
  to: string; // target extension label
  label: string; // "PDF → JPG" etc.
  description: string;
  accept: string; // input accept attr
  multiple?: boolean;
  run: ConverterFn;
};

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");

// --- image helpers -------------------------------------------------
async function imageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encode failed"))),
      mime,
      quality,
    );
  });
}

function imageConverter(id: string, from: string, to: string, mime: string, accept: string): Converter {
  return {
    id,
    from,
    to,
    label: `${from} → ${to}`,
    description: `Convert ${from} images to ${to}.`,
    accept,
    run: async (files) => {
      const file = files[0];
      const canvas = await imageToCanvas(file);
      const blob = await canvasToBlob(canvas, mime);
      return { blob, filename: `${stripExt(file.name)}.${to.toLowerCase()}` };
    },
  };
}

// --- registry ------------------------------------------------------
export const converters: Converter[] = [
  // Images
  imageConverter("jpg-png", "JPG", "PNG", "image/png", "image/jpeg,image/jpg"),
  imageConverter("png-jpg", "PNG", "JPG", "image/jpeg", "image/png"),
  imageConverter("jpg-webp", "JPG", "WEBP", "image/webp", "image/jpeg,image/jpg"),
  imageConverter("png-webp", "PNG", "WEBP", "image/webp", "image/png"),
  imageConverter("webp-png", "WEBP", "PNG", "image/png", "image/webp"),
  imageConverter("webp-jpg", "WEBP", "JPG", "image/jpeg", "image/webp"),

  // Image compress
  {
    id: "image-compress",
    from: "IMAGE",
    to: "COMPRESSED",
    label: "Compress image",
    description: "Reduce JPG / PNG / WEBP size while keeping quality.",
    accept: "image/*",
    run: async (files) => {
      const { default: compress } = await import("browser-image-compression");
      const file = files[0];
      const out = await compress(file, { maxSizeMB: 1, maxWidthOrHeight: 2400, useWebWorker: true });
      return { blob: out, filename: `compressed-${file.name}` };
    },
  },

  // Images → PDF
  {
    id: "images-pdf",
    from: "JPG/PNG",
    to: "PDF",
    label: "Images → PDF",
    description: "Combine one or more images into a single PDF.",
    accept: "image/jpeg,image/png",
    multiple: true,
    run: async (files) => {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const img = file.type.includes("png")
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const out = await doc.save();
      return { blob: new Blob([out as BlobPart], { type: "application/pdf" }), filename: "images.pdf" };
    },
  },

  // Merge PDFs
  {
    id: "pdf-merge",
    from: "PDF",
    to: "MERGED PDF",
    label: "Merge PDFs",
    description: "Combine multiple PDF files into one.",
    accept: "application/pdf",
    multiple: true,
    run: async (files) => {
      const { PDFDocument } = await import("pdf-lib");
      const out = await PDFDocument.create();
      for (const file of files) {
        const src = await PDFDocument.load(await file.arrayBuffer());
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), filename: "merged.pdf" };
    },
  },

  // Split PDF (one file per page)
  {
    id: "pdf-split",
    from: "PDF",
    to: "ZIP (pages)",
    label: "Split PDF pages",
    description: "Split a PDF into one file per page, delivered as a ZIP.",
    accept: "application/pdf",
    run: async (files) => {
      const { PDFDocument } = await import("pdf-lib");
      const { default: JSZip } = await import("jszip");
      const src = await PDFDocument.load(await files[0].arrayBuffer());
      const zip = new JSZip();
      for (let i = 0; i < src.getPageCount(); i++) {
        const doc = await PDFDocument.create();
        const [page] = await doc.copyPages(src, [i]);
        doc.addPage(page);
        const bytes = await doc.save();
        zip.file(`page-${i + 1}.pdf`, bytes);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      return { blob, filename: `${stripExt(files[0].name)}-pages.zip` };
    },
  },

  // Spreadsheets
  {
    id: "csv-xlsx",
    from: "CSV",
    to: "XLSX",
    label: "CSV → Excel",
    description: "Convert CSV to an Excel spreadsheet.",
    accept: ".csv,text/csv",
    run: async (files) => {
      const XLSX = await import("xlsx");
      const text = await files[0].text();
      const wb = XLSX.read(text, { type: "string" });
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      return {
        blob: new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        filename: `${stripExt(files[0].name)}.xlsx`,
      };
    },
  },
  {
    id: "xlsx-csv",
    from: "XLSX",
    to: "CSV",
    label: "Excel → CSV",
    description: "Extract the first sheet of an Excel file as CSV.",
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    run: async (files) => {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await files[0].arrayBuffer(), { type: "array" });
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      return { blob: new Blob([csv], { type: "text/csv" }), filename: `${stripExt(files[0].name)}.csv` };
    },
  },
  {
    id: "csv-json",
    from: "CSV",
    to: "JSON",
    label: "CSV → JSON",
    description: "Convert CSV rows into a JSON array of objects.",
    accept: ".csv,text/csv",
    run: async (files) => {
      const Papa = (await import("papaparse")).default;
      const text = await files[0].text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const json = JSON.stringify(parsed.data, null, 2);
      return { blob: new Blob([json], { type: "application/json" }), filename: `${stripExt(files[0].name)}.json` };
    },
  },
  {
    id: "json-csv",
    from: "JSON",
    to: "CSV",
    label: "JSON → CSV",
    description: "Flatten a JSON array of objects into CSV.",
    accept: "application/json,.json",
    run: async (files) => {
      const Papa = (await import("papaparse")).default;
      const data = JSON.parse(await files[0].text());
      const csv = Papa.unparse(data);
      return { blob: new Blob([csv], { type: "text/csv" }), filename: `${stripExt(files[0].name)}.csv` };
    },
  },
  {
    id: "xlsx-json",
    from: "XLSX",
    to: "JSON",
    label: "Excel → JSON",
    description: "Convert the first sheet of an Excel file to JSON.",
    accept: ".xlsx",
    run: async (files) => {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await files[0].arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      return {
        blob: new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
        filename: `${stripExt(files[0].name)}.json`,
      };
    },
  },

  // JSON / YAML / XML
  {
    id: "json-yaml",
    from: "JSON",
    to: "YAML",
    label: "JSON → YAML",
    description: "Convert JSON to YAML.",
    accept: "application/json,.json",
    run: async (files) => {
      const yaml = await import("js-yaml");
      const out = yaml.dump(JSON.parse(await files[0].text()));
      return { blob: new Blob([out], { type: "text/yaml" }), filename: `${stripExt(files[0].name)}.yaml` };
    },
  },
  {
    id: "yaml-json",
    from: "YAML",
    to: "JSON",
    label: "YAML → JSON",
    description: "Convert YAML to JSON.",
    accept: ".yaml,.yml,text/yaml",
    run: async (files) => {
      const yaml = await import("js-yaml");
      const data = yaml.load(await files[0].text());
      return {
        blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
        filename: `${stripExt(files[0].name)}.json`,
      };
    },
  },
  {
    id: "json-xml",
    from: "JSON",
    to: "XML",
    label: "JSON → XML",
    description: "Convert JSON to XML.",
    accept: "application/json,.json",
    run: async (files) => {
      const { XMLBuilder } = await import("fast-xml-parser");
      const builder = new XMLBuilder({ format: true });
      const xml = builder.build(JSON.parse(await files[0].text()));
      return { blob: new Blob([xml], { type: "application/xml" }), filename: `${stripExt(files[0].name)}.xml` };
    },
  },
  {
    id: "xml-json",
    from: "XML",
    to: "JSON",
    label: "XML → JSON",
    description: "Convert XML to JSON.",
    accept: ".xml,application/xml,text/xml",
    run: async (files) => {
      const { XMLParser } = await import("fast-xml-parser");
      const parser = new XMLParser();
      const data = parser.parse(await files[0].text());
      return {
        blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
        filename: `${stripExt(files[0].name)}.json`,
      };
    },
  },

  // Documents
  {
    id: "md-html",
    from: "MD",
    to: "HTML",
    label: "Markdown → HTML",
    description: "Render Markdown to a standalone HTML document.",
    accept: ".md,.markdown,text/markdown",
    run: async (files) => {
      const { marked } = await import("marked");
      const body = await marked.parse(await files[0].text());
      const html = `<!doctype html><meta charset="utf-8"><title>${stripExt(files[0].name)}</title>${body}`;
      return { blob: new Blob([html], { type: "text/html" }), filename: `${stripExt(files[0].name)}.html` };
    },
  },
  {
    id: "html-md",
    from: "HTML",
    to: "MD",
    label: "HTML → Markdown",
    description: "Convert HTML to clean Markdown.",
    accept: ".html,.htm,text/html",
    run: async (files) => {
      const Turndown = (await import("turndown")).default;
      const td = new Turndown();
      const md = td.turndown(await files[0].text());
      return { blob: new Blob([md], { type: "text/markdown" }), filename: `${stripExt(files[0].name)}.md` };
    },
  },
  {
    id: "docx-html",
    from: "DOCX",
    to: "HTML",
    label: "Word → HTML",
    description: "Convert a Word document to HTML.",
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    run: async (files) => {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await files[0].arrayBuffer() });
      const html = `<!doctype html><meta charset="utf-8"><title>${stripExt(files[0].name)}</title>${value}`;
      return { blob: new Blob([html], { type: "text/html" }), filename: `${stripExt(files[0].name)}.html` };
    },
  },
  {
    id: "docx-txt",
    from: "DOCX",
    to: "TXT",
    label: "Word → Text",
    description: "Extract plain text from a Word document.",
    accept: ".docx",
    run: async (files) => {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ arrayBuffer: await files[0].arrayBuffer() });
      return { blob: new Blob([value], { type: "text/plain" }), filename: `${stripExt(files[0].name)}.txt` };
    },
  },

  // Archives
  {
    id: "files-zip",
    from: "FILES",
    to: "ZIP",
    label: "Files → ZIP",
    description: "Bundle any files into a single ZIP archive.",
    accept: "*/*",
    multiple: true,
    run: async (files) => {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f);
      const blob = await zip.generateAsync({ type: "blob" });
      return { blob, filename: "archive.zip" };
    },
  },
  {
    id: "zip-extract",
    from: "ZIP",
    to: "FOLDER (zip)",
    label: "Extract & re-pack ZIP",
    description: "Extract a ZIP and repack it (round-trip inspection).",
    accept: ".zip,application/zip",
    run: async (files) => {
      const { default: JSZip } = await import("jszip");
      const src = await JSZip.loadAsync(await files[0].arrayBuffer());
      const out = new JSZip();
      const entries = Object.values(src.files);
      for (const entry of entries) {
        if (entry.dir) continue;
        out.file(entry.name, await entry.async("uint8array"));
      }
      const blob = await out.generateAsync({ type: "blob" });
      return { blob, filename: `extracted-${files[0].name}` };
    },
  },
];

export type ConverterGroup = { title: string; items: Converter[] };

export const groups: ConverterGroup[] = [
  { title: "Images", items: converters.filter((c) => ["jpg-png","png-jpg","jpg-webp","png-webp","webp-png","webp-jpg","image-compress"].includes(c.id)) },
  { title: "PDF", items: converters.filter((c) => ["images-pdf","pdf-merge","pdf-split"].includes(c.id)) },
  { title: "Spreadsheets", items: converters.filter((c) => ["csv-xlsx","xlsx-csv","csv-json","json-csv","xlsx-json"].includes(c.id)) },
  { title: "Data", items: converters.filter((c) => ["json-yaml","yaml-json","json-xml","xml-json"].includes(c.id)) },
  { title: "Documents", items: converters.filter((c) => ["md-html","html-md","docx-html","docx-txt"].includes(c.id)) },
  { title: "Archives", items: converters.filter((c) => ["files-zip","zip-extract"].includes(c.id)) },
];
