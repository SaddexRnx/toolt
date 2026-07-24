import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUpRight, ShieldCheck, Zap, Layers } from "lucide-react";
import { groups, type Family } from "@/lib/converters";
import { ConverterDialog } from "@/components/ConverterDialog";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Monochrome — Free browser-based file converter" },
      {
        name: "description",
        content:
          "Convert PDF, images, spreadsheets, documents, data and archives — instantly, in your browser. No uploads, no accounts, no limits.",
      },
      { property: "og:title", content: "Monochrome — Free browser-based file converter" },
      {
        property: "og:description",
        content:
          "Convert PDF, images, spreadsheets, documents, data and archives instantly in your browser. Private by design.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Home() {
  const [active, setActive] = useState<Family | null>(null);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const totalOutputs = groups.reduce(
    (n, g) => n + g.items.reduce((m, f) => m + (f.mode === "per-file" ? f.outputs.length : 1), 0),
    0,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-sm bg-foreground" />
            <span className="text-sm font-semibold tracking-tight">monochrome</span>
          </div>
          <span className="hidden text-xs font-mono uppercase tracking-widest text-muted-foreground md:block">
            {total} tools · {totalOutputs} formats · 100% in-browser
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <h1 className="text-5xl font-semibold leading-[0.95] tracking-tight md:text-7xl">
          Convert anything.
          <br />
          <span className="text-muted-foreground">Nothing leaves your device.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
          A minimal, fast file converter. Choose a format below, drop your file, get the result — all
          processed locally in your browser.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-6 border-t border-foreground/10 pt-8 sm:grid-cols-3">
          <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Private">
            Files never touch a server. Everything runs in your browser.
          </Feature>
          <Feature icon={<Zap className="h-4 w-4" />} title="Instant">
            No queue, no wait. Conversion starts the moment you drop.
          </Feature>
          <Feature icon={<Layers className="h-4 w-4" />} title="Open source">
            Powered by open-source libraries. No API keys, no accounts, no limits.
          </Feature>
        </div>
      </section>

      {/* Converter grid */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        {groups.map((group) => (
          <div key={group.title} className="mb-16">
            <div className="mb-6 flex items-baseline justify-between border-b border-foreground/10 pb-3">
              <h2 className="text-xl font-semibold tracking-tight">{group.title}</h2>
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {group.items.length} tools
              </span>
            </div>

            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-foreground/10 bg-foreground/10 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((f) => {
                const outs =
                  f.mode === "per-file" ? f.outputs.map((o) => o.ext) : [f.outputExt];
                return (
                  <button
                    key={f.id}
                    onClick={() => setActive(f)}
                    className="group flex flex-col justify-between gap-6 bg-background p-6 text-left transition-colors hover:bg-foreground hover:text-background"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-widest">
                        {f.inputExts.slice(0, 3).map((e) => (
                          <span key={e} className="rounded border border-current px-1.5 py-0.5">
                            {e}
                          </span>
                        ))}
                        {f.inputExts.length > 3 && (
                          <span className="opacity-60">+{f.inputExts.length - 3}</span>
                        )}
                        <span className="mx-1 opacity-40">→</span>
                        {outs.slice(0, 3).map((e) => (
                          <span
                            key={e}
                            className="rounded bg-current px-1.5 py-0.5 text-background group-hover:text-foreground"
                          >
                            {e}
                          </span>
                        ))}
                        {outs.length > 3 && <span className="opacity-60">+{outs.length - 3}</span>}
                      </div>
                      <ArrowUpRight className="h-4 w-4 opacity-40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </div>
                    <div>
                      <div className="text-base font-medium">{f.title}</div>
                      <p className="mt-1 line-clamp-2 text-sm opacity-60">{f.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="border-t border-foreground/10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-8 text-xs text-muted-foreground md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} monochrome. Built with open-source libraries.</p>
          <p className="font-mono uppercase tracking-widest">no uploads · no tracking · no limits</p>
        </div>
      </footer>

      <ConverterDialog family={active} onClose={() => setActive(null)} />
    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span className="flex h-6 w-6 items-center justify-center rounded border border-foreground/20">
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
