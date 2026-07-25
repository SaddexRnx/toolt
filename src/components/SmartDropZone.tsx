import { useMemo, useState } from "react";
import { Upload, X, ArrowRight, FileIcon } from "lucide-react";
import { families, type Family } from "@/lib/converters";

const getExt = (name: string) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : "";
};

type Props = {
  onPick: (family: Family, files: File[]) => void;
};

export function SmartDropZone({ onPick }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const droppedExts = useMemo(() => {
    const s = new Set<string>();
    files.forEach((f) => s.add(getExt(f.name)));
    return Array.from(s);
  }, [files]);

  const matches = useMemo(() => {
    if (droppedExts.length === 0) return [] as Family[];
    return families.filter((fam) =>
      droppedExts.some((ext) => fam.inputExts.includes(ext) || fam.inputExts.includes("ANY")),
    );
  }, [droppedExts]);

  const grouped = useMemo(() => {
    const map = new Map<string, Family[]>();
    matches.forEach((f) => {
      const arr = map.get(f.category) ?? [];
      arr.push(f);
      map.set(f.category, arr);
    });
    return Array.from(map);
  }, [matches]);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles(Array.from(list));
  };

  const clear = () => setFiles([]);

  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-6 md:p-10">
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Smart drop</h2>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          drop → detect → choose
        </span>
      </div>

      <label
        htmlFor="smart-drop-input"
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "border-foreground bg-foreground/5"
            : "border-foreground/20 hover:border-foreground/50 hover:bg-foreground/[0.03]"
        }`}
      >
        <Upload className="h-8 w-8 opacity-60" />
        <div className="text-base font-medium">Drop any file here — we'll detect it</div>
        <div className="text-sm text-muted-foreground">
          or click to browse. Then pick from every matching tool below.
        </div>
        <input
          id="smart-drop-input"
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {files.length > 0 && (
        <div className="mt-6">
          <div className="mb-4 flex items-center justify-between border-b border-foreground/10 pb-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileIcon className="h-4 w-4 opacity-60" />
              <span className="font-medium">{files.length} file{files.length > 1 ? "s" : ""}</span>
              <span className="text-muted-foreground">·</span>
              <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-widest">
                {droppedExts.map((e) => (
                  <span key={e} className="rounded border border-foreground/20 px-1.5 py-0.5">
                    {e || "?"}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={clear}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Clear files"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          </div>

          {matches.length === 0 ? (
            <div className="rounded-md border border-foreground/10 p-6 text-center text-sm text-muted-foreground">
              No tools accept <span className="font-mono">{droppedExts.join(", ")}</span> yet. Try a different file
              or browse the catalog below.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="text-sm text-muted-foreground">
                Convert to — {matches.length} matching tool{matches.length > 1 ? "s" : ""}:
              </div>
              {grouped.map(([cat, items]) => (
                <div key={cat}>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {cat}
                  </div>
                  <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-foreground/10 bg-foreground/10 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((f) => {
                      const outs = f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt];
                      return (
                        <button
                          key={f.id}
                          onClick={() => onPick(f, files)}
                          className="group flex flex-col justify-between gap-3 bg-background p-4 text-left transition-colors hover:bg-foreground hover:text-background"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">{f.title}</div>
                            <ArrowRight className="h-4 w-4 opacity-40 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
                          </div>
                          <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-widest">
                            <span className="mx-0.5 opacity-40">→</span>
                            {outs.slice(0, 4).map((e) => (
                              <span
                                key={e}
                                className="rounded bg-current px-1.5 py-0.5 text-background group-hover:text-foreground"
                              >
                                {e}
                              </span>
                            ))}
                            {outs.length > 4 && <span className="opacity-60">+{outs.length - 4}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
