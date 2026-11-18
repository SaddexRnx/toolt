import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The pre-hydration script in __root already applied the correct theme class
  // before React mounted. Read it back on the very first render: initialising
  // to "light" would let the `.dark` class be stripped for one frame (a visible
  // flash for every dark-mode visitor) before the effect restores it.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  useEffect(() => {
    const sync = () => {
      try {
        const saved = localStorage.getItem("toolt.theme") as Theme | null;
        if (saved === "light" || saved === "dark") {
          setThemeState(saved);
        } else {
          // Dark is the primary theme; only an explicitly saved choice wins.
          setThemeState("dark");
        }
      } catch {
        /* ignore */
      }
    };
    // Defer the initial localStorage read to a task so the pre-hydration
    // theme class painted by __root stays authoritative and the effect body
    // itself carries no synchronous setState.
    const id = window.setTimeout(sync, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem("toolt.theme", t);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((cur) => {
      const next: Theme = cur === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("toolt.theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
