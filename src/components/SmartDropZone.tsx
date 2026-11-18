import { useMemo, useState } from "react";
import { Upload, X, ArrowRight, FileIcon, Search } from "lucide-react";
import { families, type Family } from "@/lib/converters";
import { useCategoryLabel, useT } from "@/lib/i18n";

const getExt = (name: string) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : "";
};

type Props = {
  onPick: (family: Family, files: File[]) => void;
  onHide?: () => void;
};

export function SmartDropZone({ onPick, onHide }: Props) {
  const t = useT();
  const categoryLabel = useCategoryLabel();
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

  // Multi-hop routes: for each directly matching family, look one step further
  // for families that consume its intermediate outputs to reach formats the
  // first family alone cannot produce.
  const hopChains = useMemo(() => {
    const map = new Map<string, Family[]>();
    if (matches.length === 0) return map;
    const outs = (f: Family) =>
      f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt];
    const directOuts = new Set(matches.flatMap(outs));
    for (const first of matches) {
      const intermediates = outs(first);
      const follows: Family[] = [];
      for (const next of families) {
        if (next.id === first.id) continue;
        if (next.inputExts.includes("ANY")) continue;
        if (!next.inputExts.some((e) => intermediates.includes(e))) continue;
        if (!outs(next).some((e) => !directOuts.has(e))) continue;
        follows.push(next);
        if (follows.length >= 3) break;
      }
      if (follows.length > 0) map.set(first.id, follows);
    }
    return map;
  }, [matches]);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles(Array.from(list));
    setActiveCat("All");
    setQuery("");
  };

  const clear = () => setFiles([]);

  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 sm:p-6 md:p-10">
      <div className="mb-4 flex items-center justify-between gap-3 sm:mb-6">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
            {t("smart.title")}
          </h2>
          <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:text-xs">
            {t("smart.subtitle")}
          </span>
        </div>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            aria-label={t("smart.hide")}
            title={t("smart.hide")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
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
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-6 text-center transition-colors sm:p-10 ${
            dragOver
              ? "border-foreground bg-foreground/5"
              : "border-foreground/20 hover:border-foreground/50 hover:bg-foreground/[0.03]"
          }`}
        >
          <Upload className="h-7 w-7 opacity-60 sm:h-8 sm:w-8" />
          <div className="text-sm font-medium sm:text-base">{t("smart.drop.label")}</div>
          <div className="text-xs text-muted-foreground sm:text-sm">{t("smart.drop.hint")}</div>
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
          {/* File bar - grid on mobile, flex on desktop */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-foreground/10 px-3 py-2.5 sm:flex sm:flex-wrap sm:justify-between sm:px-4 sm:py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm">
              <FileIcon className="h-4 w-4 shrink-0 opacity-60" />
              <span className="font-medium">
                {t("smart.files", { n: files.length })}
              </span>
              <span className="hidden text-muted-foreground sm:inline">·</span>
              <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-widest">
                {droppedExts.slice(0, 4).map((e) => (
                  <span key={e} className="rounded border border-foreground/20 px-1.5 py-0.5">
                    {e || "?"}
                  </span>
                ))}
                {droppedExts.length > 4 && (
                  <span className="opacity-60">+{droppedExts.length - 4}</span>
                )}
              </div>
              <span className="hidden text-muted-foreground sm:inline">·</span>
              <span className="w-full text-muted-foreground sm:w-auto">
                {t("smart.matching", { n: matches.length })}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label
                htmlFor="smart-drop-input"
                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                {t("smart.change")}
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
                aria-label={t("smart.clear")}
              >
                <X className="h-3.5 w-3.5" />{" "}
                <span className="hidden sm:inline">{t("smart.clear")}</span>
              </button>
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground sm:p-8">
              {t("smart.none.ext", { exts: droppedExts.join(", ") })}
            </div>
          ) : (
            <div className="grid md:grid-cols-[200px_1fr]">
              {/* Category rail */}
              <div className="flex gap-1 overflow-x-auto border-b border-foreground/10 p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-e">
                {categories.map(([cat, count]) => {
                  const active = cat === activeCat;
                  const label = categoryLabel(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => setActiveCat(cat)}
                      className={`flex shrink-0 items-center justify-between gap-3 rounded px-3 py-1.5 text-start text-xs transition-colors md:text-sm ${
                        active
                          ? "bg-foreground text-background"
                          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      <span
                        className={`font-mono text-[10px] ${active ? "opacity-70" : "opacity-50"}`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Results list */}
              <div className="flex min-w-0 flex-col">
                <div className="relative border-b border-foreground/10 p-2">
                  <Search className="pointer-events-none absolute start-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("smart.filter.placeholder")}
                    className="w-full rounded border border-transparent bg-transparent py-1.5 ps-8 pe-3 text-sm outline-none focus:border-foreground/20"
                  />
                </div>
                <div className="max-h-[60vh] overflow-y-auto md:max-h-[420px]">
                  {filtered.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground sm:p-8">
                      {t("smart.none.query", { q: query })}
                    </div>
                  ) : (
                    <ul className="divide-y divide-foreground/5">
                      {filtered.map((f) => {
                        const outs =
                          f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt];
                        const chain = hopChains.get(f.id);
                        return (
                          <li key={f.id}>
                            <button
                              onClick={() => onPick(f, files)}
                              className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/5 sm:px-4"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="truncate text-sm font-medium">{f.title}</span>
                                  <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
                                    {f.category}
                                  </span>
                                </div>
                                <p className="line-clamp-1 text-xs text-muted-foreground">
                                  {f.description}
                                </p>
                                {chain && chain.length > 0 && (
                                  <p className="line-clamp-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/80">
                                    {t("smart.chain", {
                                      chain: chain
                                        .slice(0, 2)
                                        .map((c) => c.title)
                                        .join(" \u2192 "),
                                    })}
                                  </p>
                                )}
                              </div>
                              <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1 font-mono text-[10px] uppercase tracking-widest sm:flex">
                                {outs.slice(0, 4).map((e) => (
                                  <span key={e} className="rounded bg-foreground/10 px-1.5 py-0.5">
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
