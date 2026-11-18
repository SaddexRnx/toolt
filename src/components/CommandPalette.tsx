import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Calculator as CalcIcon, CornerDownLeft, Search } from "lucide-react";
import { catalog, type CatalogTool } from "@/lib/catalog";
import { useCategoryLabel, useT } from "@/lib/i18n";

const MAX_RESULTS = 40;

export function CommandPalette() {
  const navigate = useNavigate();
  const t = useT();
  const categoryLabel = useCategoryLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIdx(0);
  }, []);

  // Two ways in: ⌘K / Ctrl+K anywhere, or the search button in the top bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onRequest = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("toolt:open-palette", onRequest);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("toolt:open-palette", onRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long result set.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const scored: { tool: CatalogTool; score: number }[] = [];
    for (const tool of catalog) {
      if (terms.length === 0) {
        scored.push({ tool, score: 0 });
        continue;
      }
      let score = 0;
      let matchedAll = true;
      for (const term of terms) {
        const inTitle = tool.title.toLowerCase().includes(term);
        const inKeywords = tool.keywords.includes(term);
        if (!inTitle && !inKeywords) {
          matchedAll = false;
          break;
        }
        score += inTitle ? 3 : 1;
        if (tool.title.toLowerCase().startsWith(term)) score += 4;
      }
      if (matchedAll) scored.push({ tool, score });
    }
    if (terms.length > 0) scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map((s) => s.tool);
  }, [query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  if (!open) return null;

  const go = (tool: CatalogTool | undefined) => {
    if (!tool) return;
    close();
    navigate({ to: "/tools/$id", params: { id: tool.id } });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) =>
        results.length === 0 ? 0 : (i - 1 + results.length) % results.length,
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(Math.max(0, results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[activeIdx]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("ui.search")}
        className="w-full max-w-xl overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("ui.search")}
            aria-controls="palette-results"
            aria-activedescendant={results[activeIdx] ? `palette-${results[activeIdx].id}` : undefined}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-foreground/15 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label={t("catalog.title")}
          className="max-h-[50vh] overflow-y-auto py-1"
        >
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("palette.empty", { q: query })}
            </p>
          ) : (
            results.map((tool, i) => {
              const active = i === activeIdx;
              return (
                <button
                  key={tool.id}
                  id={`palette-${tool.id}`}
                  data-idx={i}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseMove={() => setActiveIdx(i)}
                  onClick={() => go(tool)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-start text-sm transition-colors ${
                    active ? "bg-foreground/[0.06]" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{tool.title}</span>
                    <span className="block truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {categoryLabel(tool.category)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {tool.kind === "calculator" && <CalcIcon className="h-3 w-3" />}
                    {active && <CornerDownLeft className="h-3 w-3" />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <p className="border-t border-foreground/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("palette.hint")} · {t("palette.count", { n: catalog.length })}
        </p>
      </div>
    </div>
  );
}
