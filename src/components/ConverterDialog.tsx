import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Check, X, ArrowRight, Download } from "lucide-react";
import type { Converter } from "@/lib/converters";
import { cn } from "@/lib/utils";

type Props = { converter: Converter | null; onClose: () => void };

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; url: string; filename: string; size: number }
  | { kind: "error"; message: string };

export function ConverterDialog({ converter, onClose }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFiles([]);
    setState((prev) => {
      if (prev.kind === "done") URL.revokeObjectURL(prev.url);
      return { kind: "idle" };
    });
  }, []);

  useEffect(() => {
    if (!converter) reset();
  }, [converter, reset]);

  useEffect(() => {
    return () => {
      setState((prev) => {
        if (prev.kind === "done") URL.revokeObjectURL(prev.url);
        return prev;
      });
    };
  }, []);

  if (!converter) return null;

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    setFiles(converter.multiple ? arr : [arr[0]]);
    setState({ kind: "idle" });
  };

  const run = async () => {
    if (files.length === 0) return;
    setState({ kind: "working" });
    try {
      const { blob, filename } = await converter.run(files);
      const url = URL.createObjectURL(blob);
      setState({ kind: "done", url, filename, size: blob.size });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={!!converter} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg border-foreground/10 bg-background">
        <DialogHeader>
          <div className="flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-muted-foreground">
            <span>{converter.from}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="text-foreground">{converter.to}</span>
          </div>
          <DialogTitle className="text-2xl font-semibold tracking-tight">{converter.label}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{converter.description}</DialogDescription>
        </DialogHeader>

        {state.kind !== "done" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "group relative flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-foreground/25 bg-foreground/[0.02] px-6 py-12 text-center transition-colors cursor-pointer hover:border-foreground/60 hover:bg-foreground/[0.04]",
              dragOver && "border-foreground bg-foreground/[0.06]",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept={converter.accept}
              multiple={converter.multiple}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Upload className="h-8 w-8 text-foreground/70 transition-transform group-hover:-translate-y-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {files.length === 0
                  ? "Drop file here or click to upload"
                  : `${files.length} file${files.length > 1 ? "s" : ""} selected`}
              </p>
              <p className="text-xs text-muted-foreground">
                {converter.multiple ? "Multiple files supported" : "Single file"} • runs entirely in your browser
              </p>
            </div>

            {files.length > 0 && (
              <ul className="mt-2 w-full max-w-full space-y-1 text-left">
                {files.slice(0, 4).map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded border border-foreground/10 bg-background px-3 py-1.5 text-xs">
                    <span className="truncate font-mono">{f.name}</span>
                    <span className="shrink-0 text-muted-foreground">{formatSize(f.size)}</span>
                  </li>
                ))}
                {files.length > 4 && (
                  <li className="px-3 text-xs text-muted-foreground">+ {files.length - 4} more…</li>
                )}
              </ul>
            )}
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{state.message}</span>
          </div>
        )}

        {state.kind === "done" && (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-foreground/15 bg-foreground/[0.03] px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Ready to download</p>
              <p className="font-mono text-xs text-muted-foreground">
                {state.filename} · {formatSize(state.size)}
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {state.kind === "done" ? (
            <>
              <Button variant="ghost" onClick={reset}>
                Convert another
              </Button>
              <Button asChild>
                <a href={state.url} download={state.filename}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={run} disabled={files.length === 0 || state.kind === "working"}>
                {state.kind === "working" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {state.kind === "working" ? "Converting…" : "Convert"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
