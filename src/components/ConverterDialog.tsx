import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Upload,
  Loader2,
  Check,
  X,
  Download,
  FileWarning,
  Clock,
  Archive,
  RotateCw,
  FileText,
  Eye,
  History as HistoryIcon,
  AlertTriangle,
  StopCircle,
  Search,
  Trash2,
} from "lucide-react";
import type { Family, OutputOption } from "@/lib/converters";
import { isAcceptedFile } from "@/lib/converters";
import { canPreview, makePreview } from "@/lib/preview";
import { parsePageRange, validatePageRange } from "@/lib/pdf-range";
import {
  loadHistory,
  saveEntry,
  removeEntry,
  saveBlob,
  getBlob,
  type HistoryEntry,
} from "@/lib/history";

import { OutputPreview } from "@/components/OutputPreview";
import { cn } from "@/lib/utils";


type Props = { family: Family | null; onClose: () => void; initialFiles?: File[] | null };

type FileStatus =
  | { kind: "pending" }
  | { kind: "working" }
  | { kind: "done"; url: string; filename: string; size: number; blob: Blob }
  | { kind: "error"; message: string }
  | { kind: "rejected"; reason: string };

type QueueItem = { id: string; file: File; status: FileStatus; preview?: string | null };

type CombineState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; filename: string; size: number; blob: Blob }
  | { kind: "error"; message: string };

type NameMode = "keep" | "suffix" | "timestamp";
type ZipState = { kind: "idle" } | { kind: "working"; percent: number } | { kind: "error"; message: string };

let uid = 0;
const nextId = () => `${Date.now()}-${uid++}`;

const getExt = (name: string) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : "";
};

type ZipStructure = "flat" | "subfolders";

function applyNameMode(filename: string, mode: NameMode, suffix: string): string {
  if (mode === "keep") return filename;
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  if (mode === "timestamp") {
    const t = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    return `${base}_${t}${ext}`;
  }
  const s = (suffix || "converted").replace(/[^\w.-]+/g, "-");
  return `${base}-${s}${ext}`;
}

const stripExt = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};


export function ConverterDialog({ family, onClose, initialFiles }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [outputIndex, setOutputIndex] = useState(0);
  const [combineState, setCombineState] = useState<CombineState>({ kind: "idle" });
  const [nameMode, setNameMode] = useState<NameMode>("keep");
  const [nameSuffix, setNameSuffix] = useState("converted");
  const [zipState, setZipState] = useState<ZipState>({ kind: "idle" });
  const [pageRange, setPageRange] = useState("all");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [previewFor, setPreviewFor] = useState<{ blob: Blob; filename: string } | null>(null);
  const [zipStructure, setZipStructure] = useState<ZipStructure>("flat");
  const [historyQuery, setHistoryQuery] = useState("");
  const autoSelectedRef = useRef(false);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);


  const perFileOutputs: OutputOption[] = family?.mode === "per-file" ? family.outputs : [];
  const selectedOutput = perFileOutputs[outputIndex];
  const isPdfSplit = family?.id === "pdf-split";
  const pageRangeError = isPdfSplit ? validatePageRange(pageRange) : null;

  // Load history for this family
  useEffect(() => {
    if (!family) return;
    const refresh = () => setHistory(loadHistory().filter((e) => e.familyId === family.id));
    refresh();
    window.addEventListener("monochrome:history", refresh);
    return () => window.removeEventListener("monochrome:history", refresh);
  }, [family]);

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => {
        if (i.status.kind === "done") URL.revokeObjectURL(i.status.url);
        if (i.preview) URL.revokeObjectURL(i.preview);
      });
      return [];
    });
    setCombineState((prev) => {
      if (prev.kind === "done") URL.revokeObjectURL(prev.blob ? "" : "");
      return { kind: "idle" };
    });
    setZipState({ kind: "idle" });
    setOutputIndex(0);
    autoSelectedRef.current = false;
  }, []);

  useEffect(() => {
    if (!family) reset();
  }, [family, reset]);

  useEffect(() => {
    return () => {
      setItems((prev) => {
        prev.forEach((i) => {
          if (i.status.kind === "done") URL.revokeObjectURL(i.status.url);
          if (i.preview) URL.revokeObjectURL(i.preview);
        });
        return prev;
      });
    };
  }, []);

  const summary = useMemo(() => {
    const done = items.filter((i) => i.status.kind === "done").length;
    const failed = items.filter((i) => i.status.kind === "error").length;
    const rejected = items.filter((i) => i.status.kind === "rejected").length;
    const working = items.filter((i) => i.status.kind === "working").length;
    const valid = items.filter((i) => i.status.kind !== "rejected").length;
    const progress = valid === 0 ? 0 : Math.round(((done + failed) / valid) * 100);
    return { done, failed, rejected, working, valid, progress };
  }, [items]);

  // Detect filename collisions on the current output names
  const collisions = useMemo(() => {
    if (!family || family.mode !== "per-file") return [] as string[];
    const seen = new Map<string, number>();
    for (const it of items) {
      if (it.status.kind !== "done") continue;
      const name = applyNameMode(it.status.filename, nameMode, nameSuffix);
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  }, [items, nameMode, nameSuffix, family]);

  // Keyboard shortcut: Enter to convert (unless typing in input/select)
  useEffect(() => {
    if (!family) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Prevent triggering when a nested dialog is open
      if (previewFor) return;
      e.preventDefault();
      if (family.mode === "per-file") {
        if (items.some((i) => i.status.kind === "pending" || i.status.kind === "error")) runPerFile();
      } else if (items.some((i) => i.status.kind !== "rejected") && combineState.kind !== "done") {
        runCombine();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, items, combineState, previewFor]);

  if (!family) return null;

  const autoPickOutput = (files: File[]) => {
    if (family.mode !== "per-file" || autoSelectedRef.current) return;
    const first = files.find((f) => isAcceptedFile(family, f));
    if (!first) return;
    const ext = getExt(first.name);
    const diffIdx = family.outputs.findIndex(
      (o) => o.ext.toUpperCase() !== ext && o.ext.toUpperCase() !== "AUTO",
    );
    const sameIdx = family.outputs.findIndex((o) => o.ext.toUpperCase() === ext);
    const pick = diffIdx >= 0 ? diffIdx : sameIdx >= 0 ? sameIdx : 0;
    setOutputIndex(pick);
    autoSelectedRef.current = true;
  };

  const generatePreviews = (queued: QueueItem[]) => {
    queued.forEach((it) => {
      if (it.status.kind === "rejected") return;
      if (!canPreview(it.file)) return;
      makePreview(it.file).then((url) => {
        if (!url) return;
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, preview: url } : p)));
      });
    });
  };

  const acceptFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    const mapped: QueueItem[] = arr.map((file) => ({
      id: nextId(),
      file,
      status: isAcceptedFile(family, file)
        ? { kind: "pending" }
        : { kind: "rejected", reason: `Unsupported type — expected ${family.inputExts.join(", ")}` },
    }));
    autoPickOutput(arr);
    if (family.mode === "combine") {
      setItems((prev) => {
        prev.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
        return mapped;
      });
      setCombineState({ kind: "idle" });
    } else {
      setItems((prev) => [...prev, ...mapped]);
    }
    generatePreviews(mapped);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const it = prev.find((i) => i.id === id);
      if (it) {
        if (it.status.kind === "done") URL.revokeObjectURL(it.status.url);
        if (it.preview) URL.revokeObjectURL(it.preview);
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  // Wrap Split PDF run to respect the page range setting.
  const runWithRange = async (file: File): Promise<{ blob: Blob; filename: string }> => {
    if (!isPdfSplit) return selectedOutput.run(file);
    if (pageRangeError) throw new Error(pageRangeError);
    const { PDFDocument } = await import("pdf-lib");
    const { default: JSZip } = await import("jszip");
    const src = await PDFDocument.load(await file.arrayBuffer());
    const total = src.getPageCount();
    const pages = parsePageRange(pageRange, total);
    if (pages.length === 0) throw new Error("Page range matched 0 pages");
    if (pages.length === 1) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [pages[0] - 1]);
      doc.addPage(page);
      const bytes = await doc.save();
      const base = file.name.replace(/\.[^.]+$/, "");
      return {
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        filename: `${base}-page-${pages[0]}.pdf`,
      };
    }
    const zip = new JSZip();
    for (const p of pages) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [p - 1]);
      doc.addPage(page);
      zip.file(`page-${p}.pdf`, await doc.save());
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const base = file.name.replace(/\.[^.]+$/, "");
    return { blob, filename: `${base}-pages.zip` };
  };

  const logHistory = (
    input: File,
    result: { blob: Blob; filename: string },
    ext: string,
    label: string,
  ) => {
    const id = saveEntry({
      familyId: family.id,
      familyTitle: family.title,
      category: family.category,
      inputName: input.name,
      inputSize: input.size,
      outputExt: ext,
      outputLabel: label,
      outputFilename: applyNameMode(result.filename, nameMode, nameSuffix),
      outputSize: result.blob.size,
      nameMode,
      nameSuffix: nameMode === "suffix" ? nameSuffix : undefined,
      pageRange: isPdfSplit ? pageRange : undefined,
      hasBlob: true,
    });
    void saveBlob(id, result.blob);
  };

  const convertOne = async (item: QueueItem) => {
    if (family.mode !== "per-file" || !selectedOutput) return;
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== item.id) return i;
        if (i.status.kind === "done") URL.revokeObjectURL(i.status.url);
        return { ...i, status: { kind: "working" } };
      }),
    );
    try {
      const result = await runWithRange(item.file);
      const url = URL.createObjectURL(result.blob);
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: { kind: "done", url, filename: result.filename, size: result.blob.size, blob: result.blob } }
            : i,
        ),
      );
      logHistory(item.file, result, selectedOutput.ext, selectedOutput.label);
    } catch (e) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: { kind: "error", message: e instanceof Error ? e.message : String(e) } }
            : i,
        ),
      );
    }
  };

  const runPerFile = async () => {
    if (family.mode !== "per-file" || !selectedOutput) return;
    cancelRef.current = false;
    const pending = items.filter((i) => i.status.kind === "pending" || i.status.kind === "error");
    for (const item of pending) {
      if (cancelRef.current) {
        // Restore any files that never got processed back to pending
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id && i.status.kind !== "done" && i.status.kind !== "rejected"
              ? { ...i, status: { kind: "error", message: "Canceled" } }
              : i,
          ),
        );
        break;
      }
      await convertOne(item);
    }
    cancelRef.current = false;
  };

  const cancelBatch = () => {
    cancelRef.current = true;
  };


  const runCombine = async () => {
    if (family.mode !== "combine") return;
    const valid = items.filter((i) => i.status.kind !== "rejected").map((i) => i.file);
    if (valid.length === 0) return;
    setCombineState({ kind: "working" });
    try {
      const { blob, filename } = await family.run(valid);
      setCombineState({ kind: "done", filename, size: blob.size, blob });
      const id = saveEntry({
        familyId: family.id,
        familyTitle: family.title,
        category: family.category,
        inputName: `${valid.length} files`,
        inputSize: valid.reduce((s, f) => s + f.size, 0),
        outputExt: family.outputExt,
        outputLabel: family.outputLabel,
        outputFilename: applyNameMode(filename, nameMode, nameSuffix),
        outputSize: blob.size,
        nameMode,
        nameSuffix: nameMode === "suffix" ? nameSuffix : undefined,
        hasBlob: true,
      });
      void saveBlob(id, blob);
    } catch (e) {
      setCombineState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };


  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };

  const downloadAllSeparate = async () => {
    const done = items.filter(
      (i): i is QueueItem & { status: Extract<FileStatus, { kind: "done" }> } => i.status.kind === "done",
    );
    for (let idx = 0; idx < done.length; idx++) {
      const it = done[idx];
      const name = applyNameMode(it.status.filename, nameMode, nameSuffix);
      triggerDownload(it.status.blob, name);
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  const downloadAllZip = async () => {
    const done = items.filter(
      (i): i is QueueItem & { status: Extract<FileStatus, { kind: "done" }> } => i.status.kind === "done",
    );
    if (done.length === 0) return;
    setZipState({ kind: "working", percent: 0 });
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const seen = new Map<string, number>();
      for (const it of done) {
        let name = applyNameMode(it.status.filename, nameMode, nameSuffix);
        if (zipStructure === "subfolders") {
          const folder = stripExt(it.file.name).replace(/[\\/:*?"<>|]+/g, "_") || "file";
          name = `${folder}/${name}`;
        }
        const n = seen.get(name) ?? 0;
        if (n > 0) {
          const dot = name.lastIndexOf(".");
          name = dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
        }
        seen.set(name, n + 1);
        zip.file(name, it.status.blob);
      }

      const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setZipState({ kind: "working", percent: Math.round(meta.percent) });
      });
      triggerDownload(blob, `converted-${Date.now()}.zip`);
      setZipState({ kind: "idle" });
    } catch (e) {
      setZipState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const rerunFromHistory = (entry: HistoryEntry) => {
    if (family.mode === "per-file") {
      const idx = family.outputs.findIndex((o) => o.ext === entry.outputExt);
      if (idx >= 0) {
        setOutputIndex(idx);
        autoSelectedRef.current = true;
      }
    }
    setNameMode(entry.nameMode);
    if (entry.nameSuffix) setNameSuffix(entry.nameSuffix);
    if (entry.pageRange) setPageRange(entry.pageRange);
    inputRef.current?.click();
  };

  const redownloadFromHistory = async (entry: HistoryEntry) => {
    const blob = await getBlob(entry.id);
    if (!blob) return;
    triggerDownload(blob, entry.outputFilename);
  };

  const previewFromHistory = async (entry: HistoryEntry) => {
    const blob = await getBlob(entry.id);
    if (!blob) return;
    setPreviewFor({ blob, filename: entry.outputFilename });
  };

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        h.outputFilename.toLowerCase().includes(q) ||
        h.inputName.toLowerCase().includes(q) ||
        h.outputExt.toLowerCase().includes(q) ||
        h.outputLabel.toLowerCase().includes(q),
    );
  }, [history, historyQuery]);


  const isCombine = family.mode === "combine";
  const hasValid = items.some((i) => i.status.kind !== "rejected");
  const isRunning = combineState.kind === "working" || items.some((i) => i.status.kind === "working");
  const anyDone = items.some((i) => i.status.kind === "done");
  const allDone =
    family.mode === "per-file" &&
    hasValid &&
    items.every((i) => i.status.kind === "done" || i.status.kind === "rejected");

  return (
    <>
      <Dialog open={!!family} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto border-foreground/10 bg-background">
          <DialogHeader>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {family.category}
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{family.title}</DialogTitle>
            <DialogDescription className="text-muted-foreground">{family.description}</DialogDescription>
          </DialogHeader>

          {/* Format info + output picker */}
          <div className="grid grid-cols-1 gap-3 rounded-md border border-foreground/10 bg-foreground/[0.02] p-3 sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Accepted input
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {family.inputExts.map((e) => (
                  <span
                    key={e}
                    className="rounded border border-foreground/20 px-1.5 py-0.5 font-mono text-[11px] uppercase"
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Output format
              </div>
              {family.mode === "per-file" ? (
                <div className="mt-1">
                  <Select
                    value={String(outputIndex)}
                    onValueChange={(v) => {
                      setOutputIndex(Number(v));
                      autoSelectedRef.current = true;
                    }}
                    disabled={isRunning}
                  >
                    <SelectTrigger className="h-9" aria-label="Output format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {family.outputs.map((o, i) => (
                        <SelectItem key={i} value={String(i)}>
                          <span className="font-mono text-xs mr-2">.{o.ext.toLowerCase()}</span>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedOutput && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{selectedOutput.description}</p>
                  )}
                </div>
              ) : (
                <div className="mt-1">
                  <div className="flex h-9 items-center rounded-md border border-foreground/15 bg-background px-3 text-sm">
                    <span className="font-mono text-xs mr-2">.{family.outputExt.toLowerCase()}</span>
                    {family.outputLabel}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{family.outputDescription}</p>
                </div>
              )}
            </div>
          </div>

          {/* Filename options */}
          <div className="grid grid-cols-1 gap-2 rounded-md border border-foreground/10 bg-foreground/[0.02] p-3 sm:grid-cols-[1fr_1fr]">
            <div>
              <label
                htmlFor="filename-mode"
                className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
              >
                Output filename
              </label>
              <Select value={nameMode} onValueChange={(v) => setNameMode(v as NameMode)} disabled={isRunning}>
                <SelectTrigger id="filename-mode" className="mt-1 h-9" aria-label="Output filename mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep original name</SelectItem>
                  <SelectItem value="suffix">Add suffix</SelectItem>
                  <SelectItem value="timestamp">Add timestamp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {nameMode === "suffix" && (
              <div>
                <label
                  htmlFor="filename-suffix"
                  className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
                >
                  Suffix
                </label>
                <Input
                  id="filename-suffix"
                  className="mt-1 h-9 font-mono text-xs"
                  value={nameSuffix}
                  onChange={(e) => setNameSuffix(e.target.value)}
                  placeholder="converted"
                  disabled={isRunning}
                />
              </div>
            )}
          </div>

          {/* PDF page range (Split PDF only) */}
          {isPdfSplit && (
            <div className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-3">
              <label
                htmlFor="pdf-range"
                className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
              >
                Pages to extract
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Input
                  id="pdf-range"
                  className="h-9 max-w-xs font-mono text-xs"
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  disabled={isRunning}
                  aria-invalid={!!pageRangeError}
                  aria-describedby="pdf-range-help"
                />
                <div className="flex gap-1" role="group" aria-label="Range presets">
                  {["all", "first", "1-5"].map((p) => (
                    <Button
                      key={p}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 font-mono text-[11px]"
                      onClick={() => setPageRange(p)}
                      disabled={isRunning}
                    >
                      {p}
                    </Button>
                  ))}
                </div>
              </div>
              <p id="pdf-range-help" className={cn("mt-1 text-[11px]", pageRangeError ? "text-destructive" : "text-muted-foreground")}>
                {pageRangeError ?? "Examples: all · first · 1-3,5,7-9"}
              </p>
            </div>
          )}

          {/* Collision warning */}
          {collisions.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Duplicate output filenames detected</p>
                <p className="text-xs text-muted-foreground break-words">
                  {collisions.slice(0, 3).join(", ")}
                  {collisions.length > 3 && ` +${collisions.length - 3} more`}. Choose{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => setNameMode("timestamp")}
                  >
                    Add timestamp
                  </button>{" "}
                  or{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => setNameMode("suffix")}
                  >
                    Add suffix
                  </button>{" "}
                  to avoid overwrites. ZIP downloads auto-rename duplicates.
                </p>
              </div>
            </div>
          )}

          {/* Dropzone */}
          <div
            role="button"
            tabIndex={0}
            aria-label={isCombine ? "Drop or select files to combine" : "Drop or select files to convert"}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              acceptFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            className={cn(
              "group relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/25 bg-foreground/[0.02] px-6 py-8 text-center transition-colors cursor-pointer hover:border-foreground/60 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              dragOver && "border-foreground bg-foreground/[0.06]",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept={family.accept}
              multiple
              className="hidden"
              onChange={(e) => {
                acceptFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Upload className="h-7 w-7 text-foreground/70 transition-transform group-hover:-translate-y-0.5" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {isCombine
                  ? "Drop files here to combine — click to browse"
                  : "Drop one or many files — click to browse"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isCombine
                  ? "All files merged into a single output"
                  : "Batch mode: each file converted independently"} · runs in your browser · press <kbd className="rounded border border-foreground/20 px-1 font-mono text-[10px]">Enter</kbd> to convert
              </p>
            </div>
          </div>

          {/* Progress bar (per-file batch) */}
          {family.mode === "per-file" && items.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                <span aria-live="polite">
                  {summary.done}/{summary.valid} done
                  {summary.failed > 0 && ` · ${summary.failed} failed`}
                  {summary.rejected > 0 && ` · ${summary.rejected} rejected`}
                </span>
                <span>{summary.progress}%</span>
              </div>
              <Progress value={summary.progress} className="h-1.5" />
            </div>
          )}

          {/* ZIP progress */}
          {zipState.kind === "working" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                <span aria-live="polite">Building ZIP…</span>
                <span>{zipState.percent}%</span>
              </div>
              <Progress value={zipState.percent} className="h-1.5" />
            </div>
          )}
          {zipState.kind === "error" && (
            <div role="alert" className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              ZIP failed: {zipState.message}
            </div>
          )}

          {/* Combine state banner */}
          {family.mode === "combine" && combineState.kind === "working" && (
            <div className="flex items-center gap-2 rounded border border-foreground/15 bg-foreground/[0.04] px-3 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Processing {items.filter((i) => i.status.kind !== "rejected").length} files…
            </div>
          )}
          {family.mode === "combine" && combineState.kind === "error" && (
            <div role="alert" className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="break-words">{combineState.message}</span>
            </div>
          )}
          {family.mode === "combine" && combineState.kind === "done" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background">
                  <Check className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-medium">Ready</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {applyNameMode(combineState.filename, nameMode, nameSuffix)} · {formatSize(combineState.size)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewFor({ blob: combineState.blob, filename: applyNameMode(combineState.filename, nameMode, nameSuffix) })}
                >
                  <Eye className="mr-2 h-4 w-4" aria-hidden /> Preview
                </Button>
                <Button
                  size="sm"
                  onClick={() => triggerDownload(combineState.blob, applyNameMode(combineState.filename, nameMode, nameSuffix))}
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                  Download
                </Button>
              </div>
            </div>
          )}

          {/* File list */}
          {items.length > 0 && (
            <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="File queue">
              {items.map((it) => (
                <li
                  key={it.id}
                  className={cn(
                    "flex items-center gap-3 rounded border border-foreground/10 bg-background px-3 py-2 text-xs",
                    it.status.kind === "rejected" && "border-destructive/30 bg-destructive/5",
                  )}
                >
                  <Thumb item={it} />
                  <StatusIcon status={it.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono">{it.file.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatSize(it.file.size)}</span>
                    </div>
                    <StatusLabel
                      status={it.status}
                      displayName={
                        it.status.kind === "done"
                          ? applyNameMode(it.status.filename, nameMode, nameSuffix)
                          : undefined
                      }
                    />
                  </div>
                  {it.status.kind === "done" && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          it.status.kind === "done" &&
                          setPreviewFor({
                            blob: it.status.blob,
                            filename: applyNameMode(it.status.filename, nameMode, nameSuffix),
                          })
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                        aria-label={`Preview ${it.file.name}`}
                        title="Preview output"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          it.status.kind === "done" &&
                          triggerDownload(it.status.blob, applyNameMode(it.status.filename, nameMode, nameSuffix))
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                        aria-label={`Download ${it.file.name}`}
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </>
                  )}
                  {(it.status.kind === "error" || it.status.kind === "done") && family.mode === "per-file" && (
                    <button
                      type="button"
                      onClick={() => convertOne(it)}
                      disabled={isRunning}
                      className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                      aria-label={`Retry ${it.file.name}`}
                      title="Retry"
                    >
                      <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  {it.status.kind !== "working" && (
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                      aria-label={`Remove ${it.file.name}`}
                      title="Remove"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Actions */}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              aria-controls="history-panel"
            >
              <HistoryIcon className="mr-2 h-4 w-4" aria-hidden />
              History {history.length > 0 && `(${history.length})`}
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {items.length > 0 && !isRunning && (
              <Button variant="ghost" onClick={reset}>
                Clear
              </Button>
            )}
            {family.mode === "per-file" && anyDone && summary.done > 1 && (
              <>
                <Select
                  value={zipStructure}
                  onValueChange={(v) => setZipStructure(v as ZipStructure)}
                  disabled={zipState.kind === "working"}
                >
                  <SelectTrigger className="h-9 w-[180px]" aria-label="ZIP folder structure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">ZIP: flat files</SelectItem>
                    <SelectItem value="subfolders">ZIP: per-input subfolders</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={downloadAllSeparate} disabled={zipState.kind === "working"}>
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                  Download separately
                </Button>
                <Button variant="outline" onClick={downloadAllZip} disabled={zipState.kind === "working"}>
                  <Archive className="mr-2 h-4 w-4" aria-hidden />
                  {zipState.kind === "working" ? `Zipping ${zipState.percent}%` : "Download as ZIP"}
                </Button>
              </>
            )}
            {isRunning && (
              <Button variant="outline" onClick={cancelBatch} aria-label="Cancel active conversion">
                <StopCircle className="mr-2 h-4 w-4" aria-hidden />
                Cancel
              </Button>
            )}
            {family.mode === "per-file" ? (
              <Button
                onClick={runPerFile}
                disabled={
                  isRunning ||
                  !!pageRangeError ||
                  !items.some((i) => i.status.kind === "pending" || i.status.kind === "error")
                }
              >
                {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {isRunning
                  ? "Converting…"
                  : allDone
                    ? "All converted"
                    : `Convert ${items.filter((i) => i.status.kind === "pending" || i.status.kind === "error").length || ""}`.trim()}
              </Button>
            ) : (
              <Button
                onClick={runCombine}
                disabled={isRunning || !hasValid || combineState.kind === "done"}
              >
                {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {isRunning ? "Processing…" : "Convert"}
              </Button>
            )}
          </div>


          {/* History panel */}
          {showHistory && (
            <div
              id="history-panel"
              className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Recent conversions ({family.title})
                </p>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Clear all history for this converter? Stored outputs will be deleted.")) {
                        history.forEach((h) => removeEntry(h.id));
                      }
                    }}

                    className="flex items-center gap-1 rounded border border-foreground/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                    aria-label="Clear history for this converter"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Clear all
                  </button>
                )}
              </div>
              {history.length > 0 && (
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    placeholder="Search by filename or format…"
                    aria-label="Search history"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
              )}
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No history yet. Conversions you run here are saved locally so you can re-download or re-run with the same settings.
                </p>
              ) : filteredHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground">No entries match "{historyQuery}".</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {filteredHistory.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center gap-2 rounded border border-foreground/10 bg-background px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono">{h.outputFilename}</p>
                        <p className="text-[10px] text-muted-foreground">
                          from <span className="font-mono">{h.inputName}</span> · .{h.outputExt.toLowerCase()} ·{" "}
                          {formatSize(h.outputSize)} · {new Date(h.timestamp).toLocaleString()}
                          {h.pageRange && ` · pages ${h.pageRange}`}
                        </p>
                      </div>
                      {h.hasBlob && (
                        <button
                          type="button"
                          onClick={() => previewFromHistory(h)}
                          className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                          aria-label={`Preview ${h.outputFilename}`}
                          title="Preview"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {h.hasBlob && (
                        <button
                          type="button"
                          onClick={() => redownloadFromHistory(h)}
                          className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                          aria-label={`Download ${h.outputFilename}`}
                          title="Download stored output"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => rerunFromHistory(h)}
                        className="rounded border border-foreground/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                        aria-label={`Re-run conversion for ${h.inputName}`}
                        title="Re-run with same settings"
                      >
                        Re-run
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(h.id)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                        aria-label={`Delete ${h.outputFilename} from history`}
                        title="Delete entry"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

            </div>
          )}
        </DialogContent>
      </Dialog>

      <OutputPreview
        open={!!previewFor}
        onClose={() => setPreviewFor(null)}
        blob={previewFor?.blob ?? null}
        filename={previewFor?.filename ?? ""}
        onDownload={() => {
          if (previewFor) triggerDownload(previewFor.blob, previewFor.filename);
        }}
      />
    </>
  );
}

function Thumb({ item }: { item: QueueItem }) {
  const box =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded border border-foreground/10 bg-foreground/[0.03] overflow-hidden";
  if (item.preview) {
    return (
      <div className={box}>
        <img src={item.preview} alt={`Preview of ${item.file.name}`} className="h-full w-full object-cover" />
      </div>
    );
  }
  if (canPreview(item.file)) {
    return (
      <div className={box} aria-label="Generating preview">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  return (
    <div className={box} aria-hidden>
      <FileText className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function StatusIcon({ status }: { status: FileStatus }) {
  const cls = "h-4 w-4 shrink-0";
  switch (status.kind) {
    case "pending":
      return <Clock className={cn(cls, "text-muted-foreground")} aria-label="Queued" />;
    case "working":
      return <Loader2 className={cn(cls, "animate-spin")} aria-label="Converting" />;
    case "done":
      return <Check className={cn(cls, "text-foreground")} aria-label="Ready" />;
    case "error":
      return <X className={cn(cls, "text-destructive")} aria-label="Error" />;
    case "rejected":
      return <FileWarning className={cn(cls, "text-destructive")} aria-label="Rejected" />;
  }
}

function StatusLabel({ status, displayName }: { status: FileStatus; displayName?: string }) {
  const base = "font-mono text-[10px] uppercase tracking-widest";
  switch (status.kind) {
    case "pending":
      return <p className={cn(base, "text-muted-foreground")}>Queued</p>;
    case "working":
      return <p className={cn(base, "text-foreground")}>Converting…</p>;
    case "done":
      return (
        <p className={cn(base, "text-muted-foreground")}>
          Ready · {displayName ?? status.filename} · {formatSize(status.size)}
        </p>
      );
    case "error":
      return <p className={cn(base, "text-destructive normal-case tracking-normal")}>{status.message}</p>;
    case "rejected":
      return <p className={cn(base, "text-destructive normal-case tracking-normal")}>{status.reason}</p>;
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
