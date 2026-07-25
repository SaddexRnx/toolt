// Client-side abuse-prevention primitives.
//
// This app has no backend, so there is nothing to protect from a
// server-cost point of view. These limits exist to:
//   1. Stop a user from accidentally crashing their own tab (giant files,
//      100 parallel WASM engines).
//   2. Absorb rapid double-clicks / stuck keys.
//   3. Keep heavy engines (FFmpeg, Tesseract, background removal) from
//      running many copies at once and thrashing memory.
//
// Everything runs in the browser; treat these as UX guardrails, not
// security controls.

// ------------------------- Size limits -------------------------

/**
 * Default per-category upload caps (bytes). Chosen to keep even low-end
 * mobile browsers responsive.
 */
export const DEFAULT_SIZE_LIMITS: Record<string, number> = {
  PDF: 200 * 1024 * 1024,        // 200 MB
  Images: 50 * 1024 * 1024,      // 50 MB
  Video: 500 * 1024 * 1024,      // 500 MB
  Audio: 200 * 1024 * 1024,      // 200 MB
  Documents: 25 * 1024 * 1024,   // 25 MB
  Data: 50 * 1024 * 1024,        // 50 MB
  AI: 20 * 1024 * 1024,          // 20 MB — models are heavy, keep input tight
  Encoding: 10 * 1024 * 1024,    // 10 MB
  Text: 10 * 1024 * 1024,        // 10 MB
  Code: 5 * 1024 * 1024,         // 5 MB
  Config: 5 * 1024 * 1024,       // 5 MB
};

export const HARD_MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB absolute ceiling

export function limitForFamily(opts: {
  category: string;
  familyId?: string;
  override?: number;
}): number {
  if (opts.override) return Math.min(opts.override, HARD_MAX_SIZE);
  const perTool: Record<string, number> = {
    // Tools that are exceptionally memory-heavy — tighten the default.
    "remove-bg": 15 * 1024 * 1024,
    "ocr-image": 15 * 1024 * 1024,
    "ocr-pdf": 50 * 1024 * 1024,
    "upscale-image": 20 * 1024 * 1024,
  };
  if (opts.familyId && perTool[opts.familyId]) return perTool[opts.familyId];
  return DEFAULT_SIZE_LIMITS[opts.category] ?? 50 * 1024 * 1024;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export class FileTooLargeError extends Error {
  constructor(public readonly size: number, public readonly limit: number) {
    super(`File is ${formatBytes(size)} — this tool accepts up to ${formatBytes(limit)}.`);
    this.name = "FileTooLargeError";
  }
}

export function guardFileSize(file: File, limit: number): void {
  if (file.size > limit) throw new FileTooLargeError(file.size, limit);
}

// ------------------------- Cooldown -------------------------

const lastRun = new Map<string, number>();

/** Returns 0 if allowed to run now, otherwise the ms the caller must wait. */
export function cooldownRemaining(key: string, ms: number): number {
  const now = Date.now();
  const last = lastRun.get(key) ?? 0;
  const wait = last + ms - now;
  return wait > 0 ? wait : 0;
}

export function markRan(key: string): void {
  lastRun.set(key, Date.now());
}

/** Convenience: throws if still cooling down. */
export function guardCooldown(key: string, ms: number): void {
  const wait = cooldownRemaining(key, ms);
  if (wait > 0) {
    throw new Error(`Please wait ${Math.ceil(wait / 100) / 10}s before running this again.`);
  }
}

// ------------------------- Concurrency limiter -------------------------

type Slot = { queue: Array<() => void>; active: number; max: number };
const slots = new Map<string, Slot>();

function getSlot(key: string, max: number): Slot {
  let s = slots.get(key);
  if (!s) {
    s = { queue: [], active: 0, max };
    slots.set(key, s);
  }
  s.max = max;
  return s;
}

/**
 * Serialize / rate-limit heavy work under a shared key. Waits until fewer
 * than `max` runs are active, then invokes `fn`. Useful for wrapping calls
 * into ffmpeg.wasm / tesseract / bg-removal so a bulk queue doesn't spawn
 * 20 engines at once and OOM the tab.
 */
export function withConcurrency<T>(
  key: string,
  max: number,
  fn: () => Promise<T>,
): Promise<T> {
  const slot = getSlot(key, max);
  return new Promise<T>((resolve, reject) => {
    const attempt = () => {
      if (slot.active >= slot.max) {
        slot.queue.push(attempt);
        return;
      }
      slot.active++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          slot.active--;
          const next = slot.queue.shift();
          if (next) next();
        });
    };
    attempt();
  });
}

// Well-known keys — keep in one place so callers can't drift.
export const LIMITS = {
  ffmpeg: { key: "ffmpeg", max: 1, cooldownMs: 300 },
  tesseract: { key: "tesseract", max: 1, cooldownMs: 300 },
  bgRemoval: { key: "bg-removal", max: 1, cooldownMs: 500 },
  upscale: { key: "upscale", max: 2, cooldownMs: 200 },
  pdfHeavy: { key: "pdf-heavy", max: 2, cooldownMs: 100 },
} as const;
