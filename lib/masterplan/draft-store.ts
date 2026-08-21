// Local draft storage for the master plan import tool, so a half-finished
// review survives closing the tab and can be picked up later.
//
// Reviewing a few hundred site numbers is the expensive part of the job
// and realistically gets done across more than one sitting - resorts are
// built out in stages over months, so this tool gets revisited a lot.
//
// IndexedDB rather than localStorage: the rendered plan image runs to a
// couple of MB as a data URL, which is uncomfortably close to
// localStorage's typical ~5MB origin quota (and would throw
// QuotaExceededError on some browsers). IndexedDB has a far larger
// allowance and is available on iOS Safari.
//
// Note this is per-browser, not synced: it's a "come back to it later on
// this device" convenience, not a substitute for finishing the import,
// which is what actually writes the sites to the database.

const DB_NAME = "masterplan-drafts";
const DB_VERSION = 1;
const STORE = "drafts";

export interface MasterplanDraft {
  resortId: string;
  fileName: string | null;
  savedAt: number;
  /** When these sites were last pushed to the database, if ever. The draft
   *  deliberately outlives the import: a first pass is often partial, and
   *  the reviewed numbers plus calibration are exactly what you need to
   *  carry on afterwards. */
  lastImportedAt?: number;
  step: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  labels: { id: string; text: string; x: number; y: number }[];
  pairs: { plan: { x: number; y: number }; world: { x: number; y: number } }[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "resortId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Every operation is best-effort: a browser in private mode, with storage
// disabled, or over quota should degrade to "no draft available" rather
// than breaking the import tool itself.
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

// Returns false if the draft could not be stored (private mode, storage
// disabled, over quota). Callers surface that rather than letting staff
// believe hours of review are safely saved when they aren't.
export async function saveDraft(draft: MasterplanDraft): Promise<boolean> {
  const result = await withStore<IDBValidKey>("readwrite", (store) => store.put(draft));
  return result !== null;
}

export async function loadDraft(resortId: string): Promise<MasterplanDraft | null> {
  return withStore<MasterplanDraft>("readonly", (store) => store.get(resortId));
}

export async function clearDraft(resortId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(resortId));
}

export function describeSavedAt(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
