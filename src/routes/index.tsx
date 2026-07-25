import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ShieldCheck, Zap, Layers, Search, Calculator as CalcIcon } from "lucide-react";
import { groups, families, type Family } from "@/lib/converters";
import { calculators, type Calculator } from "@/lib/calculators";
import { ConverterDialog } from "@/components/ConverterDialog";
import { CalculatorDialog } from "@/components/CalculatorDialog";
import { SmartDropZone } from "@/components/SmartDropZone";
import { TopBarControls } from "@/components/TopBarControls";
import { useT } from "@/lib/i18n";
import tooltLogo from "@/assets/toolt-logo.png.asset.json";


export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "To_olT — Every file tool, in your browser" },
      {
        name: "description",
        content:
          "To_olT is the all-in-one browser toolkit: convert PDFs, images, video, audio, docs & data, plus format, hash, scan and generate — no uploads, no accounts, no limits.",
      },
      { property: "og:title", content: "To_olT — Every file tool, in your browser" },
      {
        property: "og:description",
        content:
          "To_olT is the all-in-one browser toolkit: convert PDFs, images, video, audio, docs & data, plus format, hash, scan and generate — no uploads, no accounts, no limits.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://toolt.lovable.app/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "To_olT — Every file tool, in your browser" },
      { name: "twitter:description", content: "To_olT — every file tool, in your browser. No uploads, no accounts, no limits." },
    ],
    links: [{ rel: "canonical", href: "https://toolt.lovable.app/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: "To_olT",
              url: "https://toolt.lovable.app/",
              logo: "https://toolt.lovable.app/favicon.png",
            },
            {
              "@type": "WebSite",
              name: "To_olT",
              url: "https://toolt.lovable.app/",
            },
            {
              "@type": "WebApplication",
              name: "To_olT",
              url: "https://toolt.lovable.app/",
              applicationCategory: "UtilitiesApplication",
              operatingSystem: "Windows, macOS, Linux, Android, iOS",
              browserRequirements: "Requires JavaScript. Runs entirely in the browser.",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
              description:
                "Browser-based all-in-one file toolkit: convert, compress, merge, split, extract, format, hash, scan and generate PDFs, images, video, audio, documents, data and code.",
            },
          ],
        }),
      },
    ],
  }),
});

function Home() {
  const t = useT();
  const [active, setActive] = useState<Family | null>(null);
  const [activeCalc, setActiveCalc] = useState<Calculator | null>(null);
  const [initialFiles, setInitialFiles] = useState<File[] | null>(null);
  const [category, setCategory] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [smartOpen, setSmartOpen] = useState(true);
  useEffect(() => {
    try {
      const hidden = localStorage.getItem("toolt.smartHidden") === "1";
      if (hidden) setSmartOpen(false);
    } catch { /* ignore */ }
  }, []);
  const hideSmart = () => {
    setSmartOpen(false);
    try { localStorage.setItem("toolt.smartHidden", "1"); } catch { /* ignore */ }
  };
  const showSmart = () => {
    setSmartOpen(true);
    try { localStorage.setItem("toolt.smartHidden", "0"); } catch { /* ignore */ }
  };
  // Compute year on client only to avoid SSR/client mismatch across year rollovers.
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => setYear(new Date().getFullYear()), []);

  const total = families.length + calculators.length;
  const totalOutputs =
    families.reduce((n, f) => n + (f.mode === "per-file" ? f.outputs.length : 1), 0) +
    calculators.length;

  // Merge converter families and calculators into a unified item list per category.
  type CatalogItem =
    | { kind: "family"; family: Family }
    | { kind: "calc"; calc: Calculator };

  const mergedGroups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const g of groups) map.set(g.title, g.items.map((f) => ({ kind: "family" as const, family: f })));
    for (const c of calculators) {
      const arr = map.get(c.category) ?? [];
      arr.push({ kind: "calc", calc: c });
      map.set(c.category, arr);
    }
    return Array.from(map, ([title, items]) => ({ title, items }));
  }, []);

  const categories = useMemo(() => ["All", ...mergedGroups.map((g) => g.title)], [mergedGroups]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mergedGroups
      .filter((g) => category === "All" || g.title === category)
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          if (!q) return true;
          if (item.kind === "family") {
            const f = item.family;
            if (f.title.toLowerCase().includes(q)) return true;
            if (f.description.toLowerCase().includes(q)) return true;
            if (f.inputExts.some((e) => e.toLowerCase().includes(q))) return true;
            const outs = f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt];
            return outs.some((e) => e.toLowerCase().includes(q));
          }
          return item.calc.title.toLowerCase().includes(q) || item.calc.description.toLowerCase().includes(q);
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [mergedGroups, category, query]);

  const totalFiltered = filteredGroups.reduce((n, g) => n + g.items.length, 0);

  const openFamily = (family: Family, files?: File[]) => {
    setInitialFiles(files && files.length > 0 ? files : null);
    setActive(family);
  };
  const openCalc = (c: Calculator) => setActiveCalc(c);

  const close = () => {
    setActive(null);
    setInitialFiles(null);
  };
  const closeCalc = () => setActiveCalc(null);


  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <img src={tooltLogo.url} alt="To_olT logo" className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight">To_olT</span>
            <span className="brand-dot-sm ml-1" aria-hidden />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground md:flex">
              <span className="brand-dot-sm" aria-hidden />
              {total} · {totalOutputs} · {t("brand.tagline")}
            </span>
            <TopBarControls />
          </div>
        </div>
      </header>


      {/* Hero */}
      <main>
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="brand-rise mb-5 inline-flex items-center gap-2 rounded-full border border-foreground/15 px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <span className="brand-dot-sm" aria-hidden />
          {t("hero.badge")}
        </div>
        <h1 className="brand-rise text-5xl font-semibold leading-[0.95] tracking-tight md:text-7xl">
          To_olT<span style={{ color: "var(--brand)" }}>.</span>
          <br />
          <span className="text-muted-foreground">{t("hero.title.suffix")}</span>
        </h1>

        <p className="mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
          {t("hero.desc", { tools: total, outputs: totalOutputs })}
        </p>

        <div className="mt-8 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {[
            "PDF","Images","Video","Audio","Documents","Spreadsheets","Data","Archives",
            "Encoders","Hashes","JSON","YAML / TOML","HTML / CSS","SQL","Regex","JWT","UUID",
            "Cron","Kubernetes","Git","Barcodes / QR","OCR","Background removal","Upscale","Secrets scanner",
          ].map((tag) => (
            <span key={tag} className="rounded border border-foreground/15 px-1.5 py-0.5">
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 border-t border-foreground/10 pt-8 sm:grid-cols-3">
          <Feature icon={<ShieldCheck className="h-4 w-4" />} title={t("features.private.title")}>
            {t("features.private.body")}
          </Feature>
          <Feature icon={<Zap className="h-4 w-4" />} title={t("features.instant.title")}>
            {t("features.instant.body")}
          </Feature>
          <Feature icon={<Layers className="h-4 w-4" />} title={t("features.oss.title")}>
            {t("features.oss.body")}
          </Feature>
        </div>
      </section>

      {/* Smart drop */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        {smartOpen ? (
          <SmartDropZone
            onPick={(fam, files) => openFamily(fam, files)}
            onHide={hideSmart}
          />
        ) : (
          <button
            onClick={showSmart}
            className="w-full rounded-lg border border-dashed border-foreground/15 px-4 py-3 text-xs font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            + {t("smart.show")}
          </button>
        )}
      </section>

      {/* Catalog with filter + search */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="mb-6 flex items-baseline justify-between border-b border-foreground/10 pb-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="brand-dot-sm" aria-hidden />
            {t("catalog.title")}
          </h2>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {t("catalog.shown", { n: totalFiltered })}
          </span>
        </div>


        {/* Filter bar */}
        <div className="sticky top-0 z-10 -mx-6 mb-8 border-b border-foreground/10 bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const isActive = cat === category;
                const count =
                  cat === "All"
                    ? total
                    : mergedGroups.find((g) => g.title === cat)?.items.length ?? 0;
                const label = cat === "All" ? t("catalog.category.all") : cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/15 text-foreground/70 hover:border-foreground/40 hover:text-foreground"
                    }`}
                  >
                    {label}
                    <span className={`ml-1.5 font-mono text-[10px] ${isActive ? "opacity-70" : "opacity-50"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full md:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("catalog.search.placeholder")}
                aria-label={t("catalog.search.placeholder")}
                className="w-full rounded-full border border-foreground/15 bg-background py-1.5 pl-9 pr-3 text-sm outline-none focus:border-foreground"
              />
            </div>
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <div className="rounded-md border border-foreground/10 p-10 text-center text-sm text-muted-foreground">
            {t("catalog.empty")}
          </div>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.title} className="mb-16">
              <div className="mb-6 flex items-baseline justify-between border-b border-foreground/10 pb-3">
                <h3 className="text-lg font-semibold tracking-tight">{group.title}</h3>
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  {t("catalog.tools.count", { n: group.items.length })}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-foreground/10 bg-foreground/10 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => {
                  if (item.kind === "calc") {
                    const c = item.calc;
                    return (
                      <button
                        key={`calc-${c.id}`}
                        onClick={() => openCalc(c)}
                        className="tool-card group flex flex-col justify-between gap-6 bg-background p-6 text-left"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            <span className="flex items-center gap-1 rounded border border-foreground/20 px-1.5 py-0.5">
                              <CalcIcon className="h-3 w-3" />
                              {t("catalog.interactive")}
                            </span>
                          </div>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[color:var(--brand)]" />
                        </div>
                        <div>
                          <div className="text-base font-medium">{c.title}</div>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
                        </div>
                      </button>
                    );
                  }
                  const f = item.family;
                  const outs = Array.from(new Set(f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt]));
                  const ins = Array.from(new Set(f.inputExts));
                  return (
                    <button
                      key={f.id}
                      onClick={() => openFamily(f)}
                      className="tool-card group flex flex-col justify-between gap-6 bg-background p-6 text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {ins.slice(0, 3).map((e) => (
                            <span key={`in-${e}`} className="rounded border border-foreground/20 px-1.5 py-0.5">{e}</span>
                          ))}
                          {ins.length > 3 && <span className="opacity-60">+{ins.length - 3}</span>}
                          <span className="mx-1 opacity-40">→</span>
                          {outs.slice(0, 3).map((e) => (
                            <span key={`out-${e}`} className="rounded bg-foreground/10 px-1.5 py-0.5 text-foreground">{e}</span>
                          ))}
                          {outs.length > 3 && <span className="opacity-60">+{outs.length - 3}</span>}
                        </div>

                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[color:var(--brand)]" />
                      </div>
                      <div>
                        <div className="text-base font-medium">{f.title}</div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

          ))
        )}
      </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-foreground/10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-8 text-xs text-muted-foreground md:flex-row md:items-center">
          <p suppressHydrationWarning>{t("footer.rights", { year: year ?? "" })}</p>
          <p className="font-mono uppercase tracking-widest">{t("footer.motto")}</p>
        </div>
      </footer>

      <ConverterDialog family={active} onClose={close} initialFiles={initialFiles} />
      <CalculatorDialog calc={activeCalc} onClose={closeCalc} />

    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span
          className="flex h-6 w-6 items-center justify-center rounded border"
          style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
        >
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

