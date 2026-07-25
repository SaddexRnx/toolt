import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { renderPdfPages } from "@/lib/preview";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  blob: Blob | null;
  filename: string;
  onDownload: () => void;
};

const TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript))/;
const TEXT_EXT = /\.(txt|json|xml|ya?ml|md|csv|tsv|html?|svg|log)$/i;

export function OutputPreview({ open, onClose, blob, filename, onDownload }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<"image" | "pdf" | "text" | "binary">("binary");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open || !blob) return;
    const revokes: string[] = [];
    setLoading(true);
    setUrl(null);
    setPdfPages([]);
    setActivePage(0);
    setText(null);
    setZoom(1);

    (async () => {
      const isImage = blob.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|svg)$/i.test(filename);
      const isPdf = blob.type === "application/pdf" || /\.pdf$/i.test(filename);
      const isText = TEXT_MIME.test(blob.type) || TEXT_EXT.test(filename);

      if (isImage) {
        const u = URL.createObjectURL(blob);
        revokes.push(u);
        setUrl(u);
        setKind("image");
      } else if (isPdf) {
        const pages = await renderPdfPages(blob, 30, 1.5);
        pages.forEach((p) => revokes.push(p));
        setPdfPages(pages);
        setKind("pdf");
      } else if (isText) {
        const slice = blob.slice(0, 20_000);
        setText(await slice.text());
        setKind("text");
      } else {
        setKind("binary");
      }
      setLoading(false);
    })();

    return () => {
      revokes.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [open, blob, filename]);

  const zoomIn = () => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
  const zoomReset = () => setZoom(1);
  const showZoom = kind === "image" || (kind === "pdf" && pdfPages.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden border-foreground/10 bg-background flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold tracking-tight">Preview output</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">{filename}</DialogDescription>
            </div>
            {showZoom && (
              <div className="flex shrink-0 items-center gap-1 rounded border border-foreground/10 p-0.5" role="group" aria-label="Zoom controls">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={zoomOut} aria-label="Zoom out">
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="w-10 text-center font-mono text-[11px] tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={zoomIn} aria-label="Zoom in">
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={zoomReset} aria-label="Reset zoom">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-[240px] flex-1 overflow-auto rounded border border-foreground/10 bg-foreground/[0.03] p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering preview…
            </div>
          ) : kind === "image" && url ? (
            <div className="flex items-start justify-center overflow-auto">
              <img
                src={url}
                alt="Converted output image"
                style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
                className="max-h-none transition-transform"
              />
            </div>
          ) : kind === "pdf" && pdfPages.length > 0 ? (
            <div className="flex h-full gap-3">
              {pdfPages.length > 1 && (
                <div className="w-24 shrink-0 space-y-1 overflow-y-auto" aria-label="PDF page thumbnails">
                  {pdfPages.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActivePage(i)}
                      className={cn(
                        "w-full rounded border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground",
                        i === activePage
                          ? "border-foreground bg-foreground/5"
                          : "border-foreground/10 hover:border-foreground/40",
                      )}
                      aria-label={`Go to page ${i + 1}`}
                      aria-current={i === activePage}
                    >
                      <img src={p} alt={`Page ${i + 1}`} className="w-full object-contain" />
                      <div className="mt-0.5 text-center font-mono text-[10px] text-muted-foreground">
                        {i + 1}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1 overflow-auto">
                <div className="flex justify-center">
                  <img
                    src={pdfPages[activePage]}
                    alt={`Page ${activePage + 1}`}
                    style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
                    className="rounded border border-foreground/10 transition-transform"
                  />
                </div>
              </div>
            </div>
          ) : kind === "text" && text !== null ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
              {text}
              {text.length >= 20_000 && "\n\n… (truncated preview)"}
            </pre>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <p>No inline preview available for this file type.</p>
              <p className="text-xs">Download the file to inspect it.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={onDownload}>
            <Download className="mr-2 h-4 w-4" /> Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
