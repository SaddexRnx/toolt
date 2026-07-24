// Parse page range strings like "1-3,5,7-9" against a total page count.
// Returns unique, sorted, 1-based page numbers within [1, total].
export function parsePageRange(input: string, total: number): number[] {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed === "all") return Array.from({ length: total }, (_, i) => i + 1);
  if (trimmed === "first") return total > 0 ? [1] : [];
  if (trimmed === "last") return total > 0 ? [total] : [];
  const out = new Set<number>();
  for (const raw of trimmed.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Invalid range "${part}"`);
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i++) {
      if (i >= 1 && i <= total) out.add(i);
    }
  }
  return [...out].sort((x, y) => x - y);
}

export function validatePageRange(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (["all", "first", "last"].includes(trimmed)) return null;
  for (const raw of trimmed.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (!/^\d+(\s*-\s*\d+)?$/.test(part)) return `Invalid range "${part}"`;
  }
  return null;
}
