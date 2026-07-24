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
import { Upload, Loader2, Check, X, Download, FileWarning, Clock, Archive } from "lucide-react";
import type { Family, OutputOption } from "@/lib/converters";
import { isAcceptedFile } from "@/lib/converters";
import { cn } from "@/lib/utils";

type Props = { family: Family | null; onClose: () => void };

type FileStatus =
  | { kind: "pending" }
  | { kind: "working" }
  | { kind: "done"; url: string; filename: string; size: number; blob: Blob }
  | { kind: "error"; message: string }
  | { kind: "rejected"; reason: string };

type QueueItem = { id: string; file: File; status: FileStatus };

type CombineState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; url: string; filename: string; size: number }
  | { kind: "error"; message: string };

let uid = 0;
const nextId = () => `${Date.now()}-${uid++}`;

export function ConverterDialog({ family, onClose }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [outputIndex, setOutputIndex] = useState(0);
  const [combineState, setCombineState] = useState<CombineState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const perFileOutputs: OutputOption[] = family?.mode === "per-file" ? family.outputs : [];
  const selectedOutput = perFileOutputs[outputIndex];

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => i.status.kind === "done" && URL.revokeObjectURL(i.status.url));
      return [];
    });
    setCombineState((prev) => {
      if (prev.kind === "done") URL.revokeObjectURL(prev.url);
      return { kind: "idle" };
    });
    setOutputIndex(0);
  }, []);

  useEffect(() => {
    if (!family) reset();
  }, [family, reset]);

  useEffect(() => {
    return () => {
      // cleanup blob URLs on unmount
      setItems((prev) => {
        prev.forEach((i) => i.status.kind === "done" && URL.revokeObjectURL(i.status.url));
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

  if (!family) return null;

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
    if (family.mode === "combine") {
      // combine: replace list with all valid ones
      setItems(mapped);
      setCombineState({ kind: "idle" });
    } else {
      setItems((prev) => [...prev, ...mapped]);
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const it = prev.find((i) => i.id === id);
      if (it && it.status.kind === "done") URL.revokeObjectURL(it.status.url);
      return prev.filter((i) => i.id !== id);
    });
  };

  const runPerFile = async () => {
    if (family.mode !== "per-file" || !selectedOutput) return;
    const pending = items.filter((i) => i.status.kind === "pending" || i.status.kind === "error");
    for (const item of pending) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: { kind: "working" } } : i)));
      try {
        const { blob, filename } = await selectedOutput.run(item.file);
        const url = URL.createObjectURL(blob);
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: { kind: "done", url, filename, size: blob.size, blob } } : i,
          ),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: { kind: "error", message: e instanceof Error ? e.message : String(e) } }
              : i,
          ),
        );
      }
    }
  };

  const runCombine = async () => {
    if (family.mode !== "combine") return;
    const valid = items.filter((i) => i.status.kind !== "rejected").map((i) => i.file);
    if (valid.length === 0) return;
    setCombineState({ kind: "working" });
    try {
      const { blob, filename } = await family.run(valid);
      const url = URL.createObjectURL(blob);
      setCombineState({ kind: "done", url, filename, size: blob.size });
    } catch (e) {
      setCombineState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const downloadAllZip = async () => {
    const done = items.filter((i): i is QueueItem & { status: Extract<FileStatus, { kind: "done" }> } => i.status.kind === "done");
    if (done.length === 0) return;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const seen = new Map<string, number>();
    for (const it of done) {
      let name = it.status.filename;
      const n = seen.get(name) ?? 0;
      if (n > 0) {
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
      }
      seen.set(it.status.filename, n + 1);
      zip.file(name, it.status.blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `converted-${Date.now()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };

  const isCombine = family.mode === "combine";
  const hasValid = items.some((i) => i.status.kind !== "rejected");
  const isRunning = combineState.kind === "working" || items.some((i) => i.status.kind === "working");
  const allDone = family.mode === "per-file" && hasValid && items.every((i) => i.status.kind === "done" || i.status.kind === "rejected");

  return (
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
                  onValueChange={(v) => setOutputIndex(Number(v))}
                  disabled={isRunning}
                >
                  <SelectTrigger className="h-9">
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

        {/* Dropzone */}
        <div
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
          className={cn(
            "group relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/25 bg-foreground/[0.02] px-6 py-8 text-center transition-colors cursor-pointer hover:border-foreground/60 hover:bg-foreground/[0.04]",
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
          <Upload className="h-7 w-7 text-foreground/70 transition-transform group-hover:-translate-y-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {isCombine
                ? "Drop files here to combine — click to browse"
                : "Drop one or many files — click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isCombine
                ? "All files merged into a single output"
                : "Batch mode: each file converted independently"} · runs in your browser
            </p>
          </div>
        </div>

        {/* Progress bar (per-file batch) */}
        {family.mode === "per-file" && items.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              <span>
                {summary.done}/{summary.valid} done
                {summary.failed > 0 && ` · ${summary.failed} failed`}
                {summary.rejected > 0 && ` · ${summary.rejected} rejected`}
              </span>
              <span>{summary.progress}%</span>
            </div>
            <Progress value={summary.progress} className="h-1.5" />
          </div>
        )}

        {/* Combine state banner */}
        {family.mode === "combine" && combineState.kind === "working" && (
          <div className="flex items-center gap-2 rounded border border-foreground/15 bg-foreground/[0.04] px-3 py-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Processing {items.filter((i) => i.status.kind !== "rejected").length} files…
          </div>
        )}
        {family.mode === "combine" && combineState.kind === "error" && (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{combineState.message}</span>
          </div>
        )}
        {family.mode === "combine" && combineState.kind === "done" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background">
                <Check className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Ready</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {combineState.filename} · {formatSize(combineState.size)}
                </p>
              </div>
            </div>
            <Button asChild size="sm">
              <a href={combineState.url} download={combineState.filename}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
          </div>
        )}

        {/* File list */}
        {items.length > 0 && (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {items.map((it) => (
              <li
                key={it.id}
                className={cn(
                  "flex items-center gap-2 rounded border border-foreground/10 bg-background px-3 py-2 text-xs",
                  it.status.kind === "rejected" && "border-destructive/30 bg-destructive/5",
                )}
              >
                <StatusIcon status={it.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono">{it.file.name}</span>
                    <span className="shrink-0 text-muted-foreground">{formatSize(it.file.size)}</span>
                  </div>
                  <StatusLabel status={it.status} />
                </div>
                {it.status.kind === "done" && (
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                    <a href={it.status.url} download={it.status.filename}>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                {it.status.kind !== "working" && (
                  <button
                    onClick={() => removeItem(it.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {items.length > 0 && !isRunning && (
            <Button variant="ghost" onClick={reset}>
              Clear
            </Button>
          )}
          {family.mode === "per-file" && allDone && summary.done > 1 && (
            <Button variant="outline" onClick={downloadAllZip}>
              <Archive className="mr-2 h-4 w-4" />
              Download all as ZIP
            </Button>
          )}
          {family.mode === "per-file" ? (
            <Button
              onClick={runPerFile}
              disabled={
                isRunning ||
                !items.some((i) => i.status.kind === "pending" || i.status.kind === "error")
              }
            >
              {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRunning ? "Converting…" : `Convert ${summary.valid || ""}`.trim()}
            </Button>
          ) : (
            <Button
              onClick={runCombine}
              disabled={isRunning || !hasValid || combineState.kind === "done"}
            >
              {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRunning ? "Processing…" : "Convert"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusIcon({ status }: { status: FileStatus }) {
  const cls = "h-4 w-4 shrink-0";
  switch (status.kind) {
    case "pending":
      return <Clock className={cn(cls, "text-muted-foreground")} />;
    case "working":
      return <Loader2 className={cn(cls, "animate-spin")} />;
    case "done":
      return <Check className={cn(cls, "text-foreground")} />;
    case "error":
      return <X className={cn(cls, "text-destructive")} />;
    case "rejected":
      return <FileWarning className={cn(cls, "text-destructive")} />;
  }
}

function StatusLabel({ status }: { status: FileStatus }) {
  const base = "font-mono text-[10px] uppercase tracking-widest";
  switch (status.kind) {
    case "pending":
      return <p className={cn(base, "text-muted-foreground")}>Queued</p>;
    case "working":
      return <p className={cn(base, "text-foreground")}>Converting…</p>;
    case "done":
      return (
        <p className={cn(base, "text-muted-foreground")}>
          Ready · {status.filename} · {formatSize(status.size)}
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
