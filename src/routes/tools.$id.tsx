import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Calculator as CalcIcon, Play } from "lucide-react";
import { relatedTools, toolById } from "@/lib/catalog";
import { ConverterDialog } from "@/components/ConverterDialog";
import { CalculatorDialog } from "@/components/CalculatorDialog";
import { TopBarControls } from "@/components/TopBarControls";
import { useT } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";

const BASE_URL = siteUrl("/").replace(/\/$/, "");

export const Route = createFileRoute("/tools/$id")({
  loader: ({ params }) => {
    const tool = toolById(params.id);
    return tool
      ? { found: true, id: tool.id, title: tool.title, description: tool.description }
      : { found: false, id: params.id, title: "Tool not found", description: "" };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const title = loaderData.found
      ? `${loaderData.title} - free, in your browser · To_olT`
      : "Tool not found · To_olT";
    const description = loaderData.found
      ? `${loaderData.description} Runs 100% locally in your browser - no uploads, no accounts, no limits.`
      : "This tool does not exist. Browse every To_olT tool.";
    const canonical = `${BASE_URL}/tools/${loaderData.id}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(loaderData.found ? [] : [{ name: "robots", content: "noindex" }]),
      ],
      links: loaderData.found ? [{ rel: "canonical", href: canonical }] : [],
    };
  },
  component: ToolPage,
});

function ToolPage() {
  const { id } = Route.useParams();
  const t = useT();
  const tool = useMemo(() => toolById(id), [id]);
  const relatives = useMemo(() => (tool ? relatedTools(tool) : []), [tool]);
  // Opening a tool page starts the tool immediately; closing the dialog reveals
  // the landing page (formats, related tools) with a button to reopen it.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(true);
  }, [id]);

  if (!tool) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("tool.notfound")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{t("tool.notfound.body")}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1.5 text-xs transition-colors hover:border-foreground/40"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t("tool.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.png" alt="To_olT logo" className="h-6 w-6 dark:invert" />
            <span className="text-sm font-semibold tracking-tight">To_olT</span>
            <span className="brand-dot-sm ml-1" aria-hidden />
          </Link>
          <div className="flex items-center gap-3">
            <TopBarControls />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> {t("tool.back")}
        </Link>

        <div className="mt-6 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="rounded border border-foreground/20 px-1.5 py-0.5">{tool.category}</span>
          {tool.kind === "calculator" && (
            <span className="flex items-center gap-1 rounded border border-foreground/20 px-1.5 py-0.5">
              <CalcIcon className="h-3 w-3" /> {t("catalog.interactive")}
            </span>
          )}
        </div>

        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          {tool.title}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">{tool.description}</p>

        {(tool.inputs.length > 0 || tool.outputs.length > 0) && (
          <div className="mt-8 grid gap-6 border-t border-foreground/10 pt-6 sm:grid-cols-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {t("tool.inputs")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-widest">
                {tool.inputs.map((e) => (
                  <span key={e} className="rounded border border-foreground/20 px-1.5 py-0.5">
                    {e}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {t("tool.outputs")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-widest">
                {tool.outputs.map((e) => (
                  <span key={e} className="rounded bg-foreground/10 px-1.5 py-0.5">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Play className="h-3.5 w-3.5" /> {t("tool.open")}
        </button>

        {relatives.length > 0 && (
          <section className="mt-16">
            <h2 className="border-b border-foreground/10 pb-3 text-lg font-semibold tracking-tight">
              {t("tool.related")}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-foreground/10 bg-foreground/10 sm:grid-cols-2">
              {relatives.map((r) => (
                <Link
                  key={r.id}
                  to="/tools/$id"
                  params={{ id: r.id }}
                  className="group flex items-center justify-between gap-4 bg-background p-4 text-left transition-colors hover:bg-foreground/[0.03]"
                >
                  <span>
                    <span className="block text-sm font-medium">{r.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {r.description}
                    </span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[color:var(--brand)]" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {tool.kind === "family" ? (
        <ConverterDialog
          // Remount per tool: without the key React reuses the dialog when
          // moving between /tools/:id routes, so the previous tool's queue and
          // results leaked into the next tool.
          key={tool.id}
          family={open ? (tool.family ?? null) : null}
          onClose={() => setOpen(false)}
        />
      ) : (
        <CalculatorDialog
          key={tool.id}
          calc={open ? (tool.calculator ?? null) : null}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
