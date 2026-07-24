// All conversions run client-side. Two family shapes:
//   • "per-file": one input file → one output; supports batch queue and an output-format dropdown.
//   • "combine":  multiple input files → one output file (merge/zip).

export type ConvertResult = { blob: Blob; filename: string };

export type OutputOption = {
  ext: string; // "PNG"
  label: string; // "PNG (lossless)"
  description: string;
  run: (file: File) => Promise<ConvertResult>;
};

type FamilyBase = {
  id: string;
  category: string;
  title: string;
  description: string;
  accept: string; // input accept attr
  inputExts: string[]; // display list e.g. ["JPG","PNG","WEBP"]
};

export type PerFileFamily = FamilyBase & { mode: "per-file"; outputs: OutputOption[] };
export type CombineFamily = FamilyBase & {
  mode: "combine";
  outputExt: string;
  outputLabel: string;
  outputDescription: string;
  run: (files: File[]) => Promise<ConvertResult>;
};

export type Family = PerFileFamily | CombineFamily;

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
const getExt = (name: string) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : "";
};

export function isAcceptedFile(family: Family, file: File): boolean {
  const ext = getExt(file.name);
  if (family.inputExts.includes(ext)) return true;
  // fallback: mime prefix match on accept
  const parts = family.accept.split(",").map((p) => p.trim().toLowerCase());
  return parts.some((p) => {
    if (!p) return false;
    if (p.startsWith(".")) return file.name.toLowerCase().endsWith(p);
    if (p.endsWith("/*")) return file.type.startsWith(p.slice(0, -1));
    return file.type === p;
  });
}

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

function imageOutput(ext: string, mime: string, label: string, description: string, quality?: number): OutputOption {
  return {
    ext,
    label,
    description,
    run: async (file) => {
      const canvas = await imageToCanvas(file);
      const blob = await canvasToBlob(canvas, mime, quality);
      return { blob, filename: `${stripExt(file.name)}.${ext.toLowerCase()}` };
    },
  };
}

// --- registry ------------------------------------------------------
export const families: Family[] = [
  // ============ IMAGES ============
  {
    id: "image-convert",
    category: "Images",
    title: "Convert image",
    description: "Convert between JPG, PNG, WEBP, GIF, BMP and more.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "GIF", "BMP", "AVIF", "TIFF", "TIF"],
    mode: "per-file",
    outputs: [
      imageOutput("PNG", "image/png", "PNG (lossless)", "Lossless raster with alpha channel."),
      imageOutput("JPG", "image/jpeg", "JPG (photo)", "Smaller size, no transparency.", 0.92),
      imageOutput("WEBP", "image/webp", "WEBP (modern)", "Better compression than JPG/PNG.", 0.9),
    ],
  },
  {
    id: "image-compress",
    category: "Images",
    title: "Compress image",
    description: "Reduce image size while keeping visual quality.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP"],
    mode: "per-file",
    outputs: [
      {
        ext: "AUTO",
        label: "Same format (smallest)",
        description: "Keep the input format, target under ~1 MB.",
        run: async (file) => {
          const { default: compress } = await import("browser-image-compression");
          const out = await compress(file, { maxSizeMB: 1, maxWidthOrHeight: 2400, useWebWorker: true });
          return { blob: out, filename: `compressed-${file.name}` };
        },
      },
      {
        ext: "WEBP",
        label: "Convert to WEBP",
        description: "Re-encode as WEBP for maximum compression.",
        run: async (file) => {
          const { default: compress } = await import("browser-image-compression");
          const out = await compress(file, {
            maxSizeMB: 1,
            maxWidthOrHeight: 2400,
            useWebWorker: true,
            fileType: "image/webp",
          });
          return { blob: out, filename: `${stripExt(file.name)}.webp` };
        },
      },
    ],
  },

  // ============ PDF ============
  {
    id: "images-to-pdf",
    category: "PDF",
    title: "Images → PDF",
    description: "Combine one or more images into a single PDF document.",
    accept: "image/jpeg,image/png",
    inputExts: ["JPG", "JPEG", "PNG"],
    mode: "combine",
    outputExt: "PDF",
    outputLabel: "Single PDF",
    outputDescription: "All images stacked as pages in one PDF.",
    run: async (files) => {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const img = file.type.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const out = await doc.save();
      return { blob: new Blob([out as BlobPart], { type: "application/pdf" }), filename: "images.pdf" };
    },
  },
  {
    id: "pdf-merge",
    category: "PDF",
    title: "Merge PDFs",
    description: "Combine multiple PDF files into one, in the order you drop them.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "combine",
    outputExt: "PDF",
    outputLabel: "Merged PDF",
    outputDescription: "All pages concatenated into one file.",
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
  {
    id: "pdf-split",
    category: "PDF",
    title: "Split PDF",
    description: "Split a PDF into individual pages, delivered as a ZIP.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "One PDF per page (ZIP)",
        description: "Each page becomes its own PDF file inside a ZIP archive.",
        run: async (file) => {
          const { PDFDocument } = await import("pdf-lib");
          const { default: JSZip } = await import("jszip");
          const src = await PDFDocument.load(await file.arrayBuffer());
          const zip = new JSZip();
          for (let i = 0; i < src.getPageCount(); i++) {
            const doc = await PDFDocument.create();
            const [page] = await doc.copyPages(src, [i]);
            doc.addPage(page);
            const bytes = await doc.save();
            zip.file(`page-${i + 1}.pdf`, bytes);
          }
          const blob = await zip.generateAsync({ type: "blob" });
          return { blob, filename: `${stripExt(file.name)}-pages.zip` };
        },
      },
    ],
  },

  // ============ SPREADSHEETS ============
  {
    id: "spreadsheet",
    category: "Spreadsheets",
    title: "Convert spreadsheet",
    description: "Convert between CSV, TSV, XLSX, XLS, ODS, JSON and HTML.",
    accept: ".csv,.tsv,.xlsx,.xls,.ods,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet",
    inputExts: ["CSV", "TSV", "XLSX", "XLS", "ODS"],
    mode: "per-file",
    outputs: [
      {
        ext: "XLSX",
        label: "Excel (.xlsx)",
        description: "Modern Excel spreadsheet.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
          return {
            blob: new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
            filename: `${stripExt(file.name)}.xlsx`,
          };
        },
      },
      {
        ext: "CSV",
        label: "CSV (comma-separated)",
        description: "First sheet as CSV.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          return { blob: new Blob([csv], { type: "text/csv" }), filename: `${stripExt(file.name)}.csv` };
        },
      },
      {
        ext: "TSV",
        label: "TSV (tab-separated)",
        description: "First sheet as tab-separated values.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const tsv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t" });
          return {
            blob: new Blob([tsv], { type: "text/tab-separated-values" }),
            filename: `${stripExt(file.name)}.tsv`,
          };
        },
      },
      {
        ext: "JSON",
        label: "JSON (array of rows)",
        description: "First sheet as an array of row objects.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          return {
            blob: new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
      {
        ext: "HTML",
        label: "HTML table",
        description: "First sheet rendered as an HTML table.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const html = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]);
          return { blob: new Blob([html], { type: "text/html" }), filename: `${stripExt(file.name)}.html` };
        },
      },
    ],
  },

  // ============ DATA ============
  {
    id: "data",
    category: "Data",
    title: "Convert data file",
    description: "Convert between JSON, YAML and XML.",
    accept: ".json,.yaml,.yml,.xml,application/json,application/xml,text/xml,text/yaml",
    inputExts: ["JSON", "YAML", "YML", "XML"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "JSON",
        description: "Standard JSON with 2-space indent.",
        run: async (file) => {
          const data = await parseData(file);
          return {
            blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
      {
        ext: "YAML",
        label: "YAML",
        description: "Human-readable YAML.",
        run: async (file) => {
          const yaml = await import("js-yaml");
          const data = await parseData(file);
          return {
            blob: new Blob([yaml.dump(data)], { type: "text/yaml" }),
            filename: `${stripExt(file.name)}.yaml`,
          };
        },
      },
      {
        ext: "XML",
        label: "XML",
        description: "XML built from the parsed structure.",
        run: async (file) => {
          const { XMLBuilder } = await import("fast-xml-parser");
          const data = await parseData(file);
          const xml = new XMLBuilder({ format: true }).build(data);
          return { blob: new Blob([xml], { type: "application/xml" }), filename: `${stripExt(file.name)}.xml` };
        },
      },
      {
        ext: "CSV",
        label: "CSV (array of objects)",
        description: "Flatten a JSON/YAML array of objects into CSV.",
        run: async (file) => {
          const Papa = (await import("papaparse")).default;
          const data = await parseData(file);
          if (!Array.isArray(data)) throw new Error("CSV export needs an array of objects at the root.");
          return {
            blob: new Blob([Papa.unparse(data)], { type: "text/csv" }),
            filename: `${stripExt(file.name)}.csv`,
          };
        },
      },
    ],
  },

  // ============ DOCUMENTS ============
  {
    id: "markdown",
    category: "Documents",
    title: "Markdown → …",
    description: "Render Markdown to HTML or plain text.",
    accept: ".md,.markdown,text/markdown",
    inputExts: ["MD", "MARKDOWN"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "HTML document",
        description: "Standalone HTML file.",
        run: async (file) => {
          const { marked } = await import("marked");
          const body = await marked.parse(await file.text());
          const html = `<!doctype html><meta charset="utf-8"><title>${stripExt(file.name)}</title>${body}`;
          return { blob: new Blob([html], { type: "text/html" }), filename: `${stripExt(file.name)}.html` };
        },
      },
      {
        ext: "TXT",
        label: "Plain text",
        description: "Stripped of Markdown syntax.",
        run: async (file) => {
          const { marked } = await import("marked");
          const html = await marked.parse(await file.text());
          const text = html.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");
          return { blob: new Blob([text], { type: "text/plain" }), filename: `${stripExt(file.name)}.txt` };
        },
      },
    ],
  },
  {
    id: "html-to",
    category: "Documents",
    title: "HTML → …",
    description: "Convert HTML to Markdown or plain text.",
    accept: ".html,.htm,text/html",
    inputExts: ["HTML", "HTM"],
    mode: "per-file",
    outputs: [
      {
        ext: "MD",
        label: "Markdown",
        description: "Clean Markdown via Turndown.",
        run: async (file) => {
          const Turndown = (await import("turndown")).default;
          const md = new Turndown().turndown(await file.text());
          return { blob: new Blob([md], { type: "text/markdown" }), filename: `${stripExt(file.name)}.md` };
        },
      },
      {
        ext: "TXT",
        label: "Plain text",
        description: "Text with tags stripped.",
        run: async (file) => {
          const text = (await file.text()).replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n");
          return { blob: new Blob([text], { type: "text/plain" }), filename: `${stripExt(file.name)}.txt` };
        },
      },
    ],
  },
  {
    id: "word",
    category: "Documents",
    title: "Word → …",
    description: "Convert Word (.docx) to HTML, Markdown or plain text.",
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    inputExts: ["DOCX"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "HTML document",
        description: "Preserves formatting where possible.",
        run: async (file) => {
          const mammoth = await import("mammoth");
          const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
          const html = `<!doctype html><meta charset="utf-8"><title>${stripExt(file.name)}</title>${value}`;
          return { blob: new Blob([html], { type: "text/html" }), filename: `${stripExt(file.name)}.html` };
        },
      },
      {
        ext: "MD",
        label: "Markdown",
        description: "HTML → Markdown via Turndown.",
        run: async (file) => {
          const mammoth = await import("mammoth");
          const Turndown = (await import("turndown")).default;
          const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
          const md = new Turndown().turndown(value);
          return { blob: new Blob([md], { type: "text/markdown" }), filename: `${stripExt(file.name)}.md` };
        },
      },
      {
        ext: "TXT",
        label: "Plain text",
        description: "Raw text extraction, no formatting.",
        run: async (file) => {
          const mammoth = await import("mammoth");
          const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          return { blob: new Blob([value], { type: "text/plain" }), filename: `${stripExt(file.name)}.txt` };
        },
      },
    ],
  },
  {
    id: "text-encode",
    category: "Documents",
    title: "Text → encoded",
    description: "Encode any text file to Base64 or a data URL.",
    accept: "text/*,.txt,.json,.md,.csv,.xml,.yaml,.yml,.html,.htm",
    inputExts: ["TXT", "JSON", "MD", "CSV", "XML", "YAML", "HTML"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Base64",
        description: "The file bytes encoded as Base64 text.",
        run: async (file) => {
          const buf = new Uint8Array(await file.arrayBuffer());
          let s = "";
          for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
          const b64 = btoa(s);
          return { blob: new Blob([b64], { type: "text/plain" }), filename: `${file.name}.base64.txt` };
        },
      },
      {
        ext: "TXT",
        label: "Data URL",
        description: "A base64 data: URL you can paste anywhere.",
        run: async (file) => {
          const buf = new Uint8Array(await file.arrayBuffer());
          let s = "";
          for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
          const url = `data:${file.type || "application/octet-stream"};base64,${btoa(s)}`;
          return { blob: new Blob([url], { type: "text/plain" }), filename: `${file.name}.dataurl.txt` };
        },
      },
    ],
  },

  // ============ ARCHIVES ============
  {
    id: "files-to-zip",
    category: "Archives",
    title: "Files → ZIP",
    description: "Bundle any files into a single ZIP archive.",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "combine",
    outputExt: "ZIP",
    outputLabel: "ZIP archive",
    outputDescription: "All dropped files bundled into archive.zip.",
    run: async (files) => {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f);
      const blob = await zip.generateAsync({ type: "blob" });
      return { blob, filename: "archive.zip" };
    },
  },
  {
    id: "zip-repack",
    category: "Archives",
    title: "Repack ZIP",
    description: "Extract a ZIP and repack it (useful for round-trip inspection).",
    accept: ".zip,application/zip",
    inputExts: ["ZIP"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "Repacked ZIP",
        description: "Re-compressed archive with the same contents.",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const src = await JSZip.loadAsync(await file.arrayBuffer());
          const out = new JSZip();
          for (const entry of Object.values(src.files)) {
            if (entry.dir) continue;
            out.file(entry.name, await entry.async("uint8array"));
          }
          const blob = await out.generateAsync({ type: "blob" });
          return { blob, filename: `repacked-${file.name}` };
        },
      },
    ],
  },
];

async function parseData(file: File): Promise<unknown> {
  const text = await file.text();
  const ext = getExt(file.name);
  if (ext === "JSON") return JSON.parse(text);
  if (ext === "YAML" || ext === "YML") {
    const yaml = await import("js-yaml");
    return yaml.load(text);
  }
  if (ext === "XML") {
    const { XMLParser } = await import("fast-xml-parser");
    return new XMLParser().parse(text);
  }
  // fallback try-order
  try {
    return JSON.parse(text);
  } catch {
    const yaml = await import("js-yaml");
    return yaml.load(text);
  }
}

export type FamilyGroup = { title: string; items: Family[] };
export const groups: FamilyGroup[] = Array.from(
  families.reduce((map, f) => {
    const arr = map.get(f.category) ?? [];
    arr.push(f);
    map.set(f.category, arr);
    return map;
  }, new Map<string, Family[]>()),
).map(([title, items]) => ({ title, items }));
