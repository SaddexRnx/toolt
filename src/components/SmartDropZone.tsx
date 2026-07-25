import { useMemo, useState } from "react";
import { Upload, X, ArrowRight, FileIcon, Search } from "lucide-react";
import { families, type Family } from "@/lib/converters";
import { useT } from "@/lib/i18n";

const getExt = (name: string) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : "";
};

type Props = {
  onPick: (family: Family, files: File[]) => void;
};

export function SmartDropZone({ onPick }: Props) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("All");

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

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    matches.forEach((f) => map.set(f.category, (map.get(f.category) ?? 0) + 1));
    return [["All", matches.length] as [string, number], ...Array.from(map)];
  }, [matches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matches.filter((f) => {
      if (activeCat !== "All" && f.category !== activeCat) return false;
      if (!q) return true;
      if (f.title.toLowerCase().includes(q)) return true;
      if (f.description.toLowerCase().includes(q)) return true;
      const outs = f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt];
      return outs.some((e) => e.toLowerCase().includes(q));
    });
  }, [matches, activeCat, query]);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles(Array.from(list));
    setActiveCat("All");
    setQuery("");
  };

  const clear = () => setFiles([]);

  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-6 md:p-10">
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{t("smart.title")}</h2>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {t("smart.subtitle")}
        </span>
      </div>

      {files.length === 0 ? (
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
          <div className="text-base font-medium">{t("smart.drop.label")}</div>
          <div className="text-sm text-muted-foreground">
            {t("smart.drop.hint")}
          </div>
          <input
            id="smart-drop-input"
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      ) : (
        <div className="overflow-hidden rounded-md border border-foreground/10 bg-background">
          {/* File bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <FileIcon className="h-4 w-4 shrink-0 opacity-60" />
              <span className="font-medium">
                {files.length} file{files.length > 1 ? "s" : ""}
              </span>
              <span className="text-muted-foreground">·</span>
              <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-widest">
                {droppedExts.map((e) => (
                  <span key={e} className="rounded border border-foreground/20 px-1.5 py-0.5">
                    {e || "?"}
                  </span>
                ))}
              </div>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {matches.length} matching tool{matches.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="smart-drop-input"
                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                Change files
              </label>
              <input
                id="smart-drop-input"
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <button
                onClick={clear}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Clear files"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              To_olT has no tool for <span className="font-mono">{droppedExts.join(", ")}</span> yet.
            </div>
          ) : (
            <div className="grid md:grid-cols-[200px_1fr]">
              {/* Category rail */}
              <div className="flex gap-1 overflow-x-auto border-b border-foreground/10 p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-r">
                {categories.map(([cat, count]) => {
                  const active = cat === activeCat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setActiveCat(cat)}
                      className={`flex shrink-0 items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-xs transition-colors md:text-sm ${
                        active
                          ? "bg-foreground text-background"
                          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{cat}</span>
                      <span className={`font-mono text-[10px] ${active ? "opacity-70" : "opacity-50"}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Results list */}
              <div className="flex flex-col">
                <div className="relative border-b border-foreground/10 p-2">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
                  <input
                    autoFocus
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter tools or output format…"
                    className="w-full rounded border border-transparent bg-transparent py-1.5 pl-8 pr-3 text-sm outline-none focus:border-foreground/20"
                  />
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  {filtered.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      No To_olT tools match "{query}".
                    </div>
                  ) : (
                    <ul className="divide-y divide-foreground/5">
                      {filtered.map((f) => {
                        const outs =
                          f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt];
                        return (
                          <li key={f.id}>
                            <button
                              onClick={() => onPick(f, files)}
                              className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-foreground hover:text-background"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="truncate text-sm font-medium">{f.title}</span>
                                  <span className="hidden font-mono text-[10px] uppercase tracking-widest opacity-50 sm:inline">
                                    {f.category}
                                  </span>
                                </div>
                                <p className="line-clamp-1 text-xs opacity-60">{f.description}</p>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 font-mono text-[10px] uppercase tracking-widest">
                                {outs.slice(0, 4).map((e) => (
                                  <span
                                    key={e}
                                    className="rounded bg-foreground/10 px-1.5 py-0.5 group-hover:bg-background/20"
                                  >
                                    {e}
                                  </span>
                                ))}
                                {outs.length > 4 && (
                                  <span className="opacity-60">+{outs.length - 4}</span>
                                )}
                              </div>
                              <ArrowRight className="h-4 w-4 shrink-0 opacity-30 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
