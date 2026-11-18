import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Moon, Sun, Check, Search } from "lucide-react";
import { LANGUAGES, useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export function TopBarControls() {
  const { lang, setLang, t } = useI18n();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Open with roving focus on the current language; focus the listboxicated
  // after paint so screen readers announce the list context.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => listRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const openList = () => {
    setActiveIdx(
      Math.max(
        0,
        LANGUAGES.findIndex((l) => l.code === lang),
      ),
    );
    setOpen(true);
  };

  const onKeyDownList = useCallback(
    (e: React.KeyboardEvent) => {
      const n = LANGUAGES.length;
      let next: number;
      switch (e.key) {
        case "ArrowDown":
          next = (activeIdx + 1) % n;
          break;
        case "ArrowUp":
          next = (activeIdx - 1 + n) % n;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = n - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      setActiveIdx(next);
      const target = listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]")[next];
      target?.focus();
    },
    [activeIdx],
  );

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("toolt:open-palette"))}
        aria-label={t("ui.search")}
        title={`${t("ui.search")} (⌘K)`}
        className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden font-mono text-[10px] uppercase tracking-widest sm:inline">⌘K</span>
      </button>
      <div className="relative" ref={ref}>
        <button
          ref={btnRef}
          type="button"
          onClick={openList}
          aria-label={t("ui.language")}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="font-mono uppercase">{current.code}</span>
        </button>
        {open && (
          <ul
            ref={listRef}
            tabIndex={-1}
            role="listbox"
            aria-label={t("ui.language")}
            aria-activedescendant={`lang-opt-${LANGUAGES[activeIdx]?.code}`}
            onKeyDown={onKeyDownList}
            className="absolute end-0 z-50 mt-2 max-h-80 w-48 overflow-auto rounded-md border border-foreground/15 bg-background py-1 text-sm shadow-lg outline-none"
          >
            {LANGUAGES.map((l, i) => {
              const active = l.code === lang;
              return (
                <li key={l.code}>
                  <button
                    id={`lang-opt-${l.code}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onFocus={() => setActiveIdx(i)}
                    onClick={() => {
                      setLang(l.code);
                      setOpen(false);
                      btnRef.current?.focus();
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 ${
                      active ? "text-foreground" : "text-foreground/70"
                    }`}
                  >
                    <span>
                      <span className="font-medium">{l.native}</span>
                      <span className="ms-2 text-xs text-muted-foreground">{l.label}</span>
                    </span>
                    {active && <Check className="h-3.5 w-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={t("ui.theme")}
        title={theme === "dark" ? t("ui.theme.light") : t("ui.theme.dark")}
        className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">
          {theme === "dark" ? t("ui.theme.light") : t("ui.theme.dark")}
        </span>
      </button>
    </div>
  );
}
