import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ConverterDialog } from "@/components/ConverterDialog";
import { families } from "@/lib/converters";
import { Button } from "@/components/ui/button";

const TITLE = "PDF to Word Converter — Free, In-Browser .docx | To_olT";
const DESCRIPTION =
  "Convert PDF to Word (.docx) free in your browser. No uploads, no accounts, no watermarks — your files never leave your device. Also exports Rich Text (.rtf).";
const URL = "https://toolt.lovable.app/pdf-to-word";

export const Route = createFileRoute("/pdf-to-word")({
  component: PdfToWordPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "SoftwareApplication",
              name: "PDF to Word Converter",
              url: URL,
              applicationCategory: "UtilitiesApplication",
              operatingSystem: "Windows, macOS, Linux, Android, iOS",
              browserRequirements: "Requires JavaScript. Runs entirely in the browser.",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
              description: DESCRIPTION,
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "To_olT", item: "https://toolt.lovable.app/" },
                { "@type": "ListItem", position: 2, name: "PDF to Word", item: URL },
              ],
            },
            {
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "Is the PDF to Word converter really free?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Yes. To_olT is 100% free with no signup, no watermark and no file-size limit — everything runs locally in your browser.",
                  },
                },
                {
                  "@type": "Question",
                  name: "Are my PDF files uploaded anywhere?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "No. Files are processed entirely on your device using WebAssembly. Nothing is sent to a server.",
                  },
                },
                {
                  "@type": "Question",
                  name: "Does it work on scanned PDFs?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "This tool extracts the PDF's text layer. For scanned images, use the OCR tool first, then convert the recognized text to Word.",
                  },
                },
              ],
            },
          ],
        }),
      },
    ],
  }),
});

function PdfToWordPage() {
  const family = families.find((f) => f.id === "pdf-to-word")!;
  const [open, setOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.png?v=3" alt="To_olT logo" className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight">To_olT</span>
          </Link>
          <Link to="/" className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">
            All tools
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-16 md:py-20">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          PDF · Free · In-browser
        </p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          PDF to Word converter.
          <br />
          <span className="text-muted-foreground">Editable .docx in seconds.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
          Drop a PDF and get a fully editable Microsoft Word (.docx) document — or a universal Rich Text (.rtf) file.
          100% private: your PDF never leaves your browser. No accounts, no watermarks, no upload limits.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" onClick={() => setOpen(true)}>Convert PDF to Word</Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/">Browse all 100+ tools</Link>
          </Button>
        </div>

        <ul className="mt-10 grid grid-cols-1 gap-4 border-t border-foreground/10 pt-8 text-sm sm:grid-cols-3">
          <li><strong className="block">Private by design</strong><span className="text-muted-foreground">Files stay on your device.</span></li>
          <li><strong className="block">Editable output</strong><span className="text-muted-foreground">Real .docx and .rtf, not images.</span></li>
          <li><strong className="block">Batch friendly</strong><span className="text-muted-foreground">Queue many PDFs, download as ZIP.</span></li>
        </ul>

        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">How to convert a PDF to Word</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>Click <em>Convert PDF to Word</em> and drop your PDF file (or many).</li>
            <li>Pick <strong>Word document (.docx)</strong> or <strong>Rich Text (.rtf)</strong> as the output.</li>
            <li>Download the converted Word file — everything happens locally.</li>
          </ol>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight">Frequently asked questions</h2>
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <h3 className="font-medium">Is this PDF to Word converter really free?</h3>
              <p className="text-muted-foreground">Yes — no signup, no watermark, no file size limit.</p>
            </div>
            <div>
              <h3 className="font-medium">Are my PDFs uploaded anywhere?</h3>
              <p className="text-muted-foreground">No. Conversion happens in your browser via WebAssembly.</p>
            </div>
            <div>
              <h3 className="font-medium">Does it work on scanned PDFs?</h3>
              <p className="text-muted-foreground">This tool reads the PDF text layer. For scans, run the OCR tool first, then convert the recognized text.</p>
            </div>
          </div>
        </section>
      </section>

      <footer className="border-t border-foreground/10">
        <div className="mx-auto max-w-4xl px-6 py-8 text-xs text-muted-foreground">
          © To_olT — every file tool, in your browser.
        </div>
      </footer>

      <ConverterDialog family={open ? family : null} onClose={() => setOpen(false)} />
    </main>
  );
}
