// Local (localStorage) conversion history — metadata + IndexedDB blob store
// for one-click re-download from previous entries.

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
  hasBlob?: boolean;
};

const KEY = "monochrome:history:v1";
const MAX = 50;

const DB_NAME = "monochrome-history";
const STORE = "blobs";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
  });
}

export async function saveBlob(id: string, blob: Blob): Promise<boolean> {
  const r = await withStore<IDBValidKey>("readwrite", (s) => s.put(blob, id));
  return r !== null;
}

export async function getBlob(id: string): Promise<Blob | null> {
  const r = await withStore<Blob | undefined>("readonly", (s) => s.get(id));
  return r ?? null;
}

export async function deleteBlob(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

export async function clearBlobs(): Promise<void> {
  await withStore("readwrite", (s) => s.clear());
}

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

export function saveEntry(entry: Omit<HistoryEntry, "id" | "timestamp">): string {
  const list = loadHistory();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next: HistoryEntry = { ...entry, id, timestamp: Date.now() };
  list.unshift(next);
  const trimmed = list.slice(0, MAX);
  // Drop blobs for entries that got trimmed off
  const droppedIds = list.slice(MAX).map((e) => e.id);
  droppedIds.forEach((did) => void deleteBlob(did));
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent("monochrome:history"));
  } catch {
    // ignore quota errors
  }
  return id;
}

export function removeEntry(id: string) {
  const list = loadHistory().filter((e) => e.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    void deleteBlob(id);
    window.dispatchEvent(new CustomEvent("monochrome:history"));
  } catch {
    // ignore
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
    void clearBlobs();
    window.dispatchEvent(new CustomEvent("monochrome:history"));
  } catch {
    // ignore
  }
}
