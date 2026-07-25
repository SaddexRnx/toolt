import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Calculator, CalcField } from "@/lib/calculators";

type Props = { calc: Calculator | null; onClose: () => void };

export function CalculatorDialog({ calc, onClose }: Props) {
  const defaults = useMemo<Record<string, string>>(() => {
    if (!calc) return {};
    const out: Record<string, string> = {};
    for (const f of calc.fields) {
      if (f.type === "select") out[f.id] = f.default ?? f.options[0]?.value ?? "";
      else if (f.type === "number") out[f.id] = String(f.default ?? 0);
      else out[f.id] = f.default ?? "";
    }
    return out;
  }, [calc]);

  const [values, setValues] = useState<Record<string, string>>(defaults);
  const current = { ...defaults, ...values };

  const results = useMemo(() => {
    if (!calc) return [];
    try { return calc.compute(current); }
    catch (e) { return [{ label: "Error", value: e instanceof Error ? e.message : "Failed to compute" }]; }
  }, [calc, current]);

  if (!calc) return null;

  const setVal = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  return (
    <Dialog open={!!calc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{calc.title}</DialogTitle>
          <DialogDescription>{calc.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Inputs */}
          <div className="space-y-4">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Inputs</div>
            {calc.fields.map((f) => (
              <FieldRow key={f.id} field={f} value={current[f.id] ?? ""} onChange={(v) => setVal(f.id, v)} />
            ))}
          </div>

          {/* Results */}
          <div className="space-y-3 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-5">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Results</div>
            {results.map((r, i) => (
              <div key={i} className="space-y-2 border-b border-foreground/5 pb-2 last:border-0">
                {r.preview ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{r.label}</span>
                      <span className="flex items-center gap-2 min-w-0">
                        {r.value && <span className="truncate text-xs font-mono text-muted-foreground" title={r.value}>{r.value}</span>}
                        <CopyButton text={styleToCss(r.value, r.preview.style)} label={`${r.label} CSS`} />
                      </span>
                    </div>
                    <div
                      className="flex min-h-[140px] w-full items-center justify-center overflow-hidden rounded-md border border-foreground/10 p-4"
                      style={{ background: r.preview.bg ?? "#ffffff" }}
                    >
                      {r.preview.children ? (
                        <div style={{ ...(r.preview.style as React.CSSProperties), width: "100%" }}>
                          {Array.from({ length: r.preview.children }).map((_, k) => (
                            <div
                              key={k}
                              style={{
                                background: `hsl(${(k * 47) % 360} 70% 60%)`,
                                color: "#fff",
                                padding: "12px 16px",
                                borderRadius: "6px",
                                fontSize: "13px",
                                fontWeight: 600,
                                textAlign: "center",
                                minWidth: "48px",
                              }}
                            >
                              {k + 1}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          style={{
                            ...(r.preview.style as React.CSSProperties),
                            minWidth: r.preview.text && r.preview.text.trim() ? undefined : "120px",
                            minHeight: r.preview.text && r.preview.text.trim() ? undefined : "80px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {r.preview.text ?? ""}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{r.label}</span>
                    <span className="flex items-center gap-2 text-right">
                      {r.swatch && (
                        <span
                          aria-hidden
                          className="inline-block h-5 w-5 rounded border border-foreground/20"
                          style={{ backgroundColor: r.swatch }}
                        />
                      )}
                      <span className="whitespace-pre-wrap text-left text-sm font-mono tabular-nums break-all">{r.value}</span>
                      {r.hint && <span className="ml-1 text-xs text-muted-foreground">{r.hint}</span>}
                      <CopyButton text={r.value} label={r.label} />
                    </span>
                  </div>
                )}
                {r.swatches && r.swatches.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.swatches.map((c, j) => (
                      <button
                        key={j}
                        type="button"
                        title={`Copy ${c}`}
                        onClick={() => navigator.clipboard?.writeText(c)}
                        className="h-8 w-8 rounded border border-foreground/20 transition hover:scale-110"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <CopyButton text={r.swatches.join(", ")} label="palette" compact />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ field, value, onChange }: { field: CalcField; value: string; onChange: (v: string) => void }) {
  const unit = "unit" in field && field.unit ? field.unit : null;
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">
        {field.label}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">({unit})</span>}
      </span>
      {field.type === "select" ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : field.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
        />
      ) : field.type === "date" ? (
        <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "number" ? (
        <Input type="number" value={value} min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input type="text" value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function CopyButton({ text, label, compact }: { text: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy ${label ?? "value"}`}
      title={copied ? "Copied!" : "Copy"}
      className={
        "inline-flex shrink-0 items-center justify-center rounded border border-foreground/15 bg-background text-muted-foreground transition hover:border-foreground/40 hover:text-foreground " +
        (compact ? "h-6 w-6" : "h-7 w-7")
      }
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
