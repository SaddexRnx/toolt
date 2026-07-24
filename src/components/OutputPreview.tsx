import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { makePreview } from "@/lib/preview";

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
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<"image" | "pdf" | "text" | "binary">("binary");

  useEffect(() => {
    if (!open || !blob) return;
    let revoke: string | null = null;
    setLoading(true);
    setUrl(null);
    setText(null);

    (async () => {
      const isImage = blob.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|svg)$/i.test(filename);
      const isPdf = blob.type === "application/pdf" || /\.pdf$/i.test(filename);
      const isText = TEXT_MIME.test(blob.type) || TEXT_EXT.test(filename);

      if (isImage) {
        const u = URL.createObjectURL(blob);
        revoke = u;
        setUrl(u);
        setKind("image");
      } else if (isPdf) {
        const file = new File([blob], filename, { type: "application/pdf" });
        const u = await makePreview(file);
        revoke = u;
        setUrl(u);
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
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [open, blob, filename]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden border-foreground/10 bg-background flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Preview output</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{filename}</DialogDescription>
        </DialogHeader>

        <div className="min-h-[240px] flex-1 overflow-auto rounded border border-foreground/10 bg-foreground/[0.03] p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering preview…
            </div>
          ) : kind === "image" && url ? (
            <img src={url} alt="Output preview" className="mx-auto max-h-[60vh] object-contain" />
          ) : kind === "pdf" && url ? (
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">First page</p>
              <img src={url} alt="First page of PDF" className="mx-auto max-h-[60vh] rounded border border-foreground/10 object-contain" />
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
