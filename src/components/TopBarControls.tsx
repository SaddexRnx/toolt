import { useEffect, useRef, useState } from "react";
import { Globe, Moon, Sun, Check } from "lucide-react";
import { LANGUAGES, useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export function TopBarControls() {
  const { lang, setLang, t } = useI18n();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div className="flex items-center gap-1">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
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
            role="listbox"
            aria-label={t("ui.language")}
            className="absolute right-0 z-50 mt-2 max-h-80 w-48 overflow-auto rounded-md border border-foreground/15 bg-background py-1 text-sm shadow-lg"
          >
            {LANGUAGES.map((l) => {
              const active = l.code === lang;
              return (
                <li key={l.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setLang(l.code);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-foreground/5 ${
                      active ? "text-foreground" : "text-foreground/70"
                    }`}
                  >
                    <span>
                      <span className="font-medium">{l.native}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{l.label}</span>
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
