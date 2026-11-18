// Local (localStorage) conversion history - metadata + IndexedDB blob store
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

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    try {
      const tx = db.transaction(STORE, mode);
      // Aborted transactions (e.g. quota exceeded on a large put) must still
      // settle the promise and release the connection.
      tx.onabort = () => finish(null);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => finish(req.result as T);
      req.onerror = () => finish(null);
    } catch {
      finish(null);
    }
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

export function saveEntry(
  entry: Omit<HistoryEntry, "id" | "timestamp" | "hasBlob">,
  blob?: Blob,
): string {
  const list = loadHistory();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // hasBlob is the result of the actual write, never an assumption: a quota
  // failure must not leave a download button that silently does nothing.
  const next: HistoryEntry = { ...entry, id, timestamp: Date.now(), hasBlob: false };
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
  if (blob) {
    void saveBlob(id, blob).then((ok) => {
      if (!ok) return;
      const patched = loadHistory().map((e) => (e.id === id ? { ...e, hasBlob: true } : e));
      try {
        localStorage.setItem(KEY, JSON.stringify(patched));
        window.dispatchEvent(new CustomEvent("monochrome:history"));
      } catch {
        // The entry still lists the filename/settings; only re-download is missing.
      }
    });
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
