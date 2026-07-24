// Local (localStorage) conversion history — metadata only. Blobs are not kept.

export type HistoryEntry = {
  id: string;
  familyId: string;
  familyTitle: string;
  category: string;
  inputName: string;
  inputSize: number;
  outputExt: string;
  outputLabel: string;
  outputFilename: string;
  outputSize: number;
  nameMode: "keep" | "suffix" | "timestamp";
  nameSuffix?: string;
  pageRange?: string;
  timestamp: number;
};

const KEY = "monochrome:history:v1";
const MAX = 50;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveEntry(entry: Omit<HistoryEntry, "id" | "timestamp">) {
  const list = loadHistory();
  const next: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  list.unshift(next);
  const trimmed = list.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent("monochrome:history"));
  } catch {
    // ignore quota errors
  }
}

export function removeEntry(id: string) {
  const list = loadHistory().filter((e) => e.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("monochrome:history"));
  } catch {
    // ignore
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("monochrome:history"));
  } catch {
    // ignore
  }
}
