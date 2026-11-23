/**
 * Keeps the drawing a take-off was made on in this browser (IndexedDB), so reopening the work on the same
 * computer does not ask for the file again. Nothing is uploaded. Every call fails quietly: a private window
 * or blocked storage only means the file has to be chosen again.
 */
const DB_NAME = 'ktec-boq-takeoff';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheTakeoffFile(takeoffId: string, file: File): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ name: file.name, blob: file, savedAt: Date.now() }, takeoffId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // storage unavailable or full
  }
}

export async function readCachedTakeoffFile(takeoffId: string): Promise<File | null> {
  try {
    const db = await open();
    const hit = await new Promise<{ name: string; blob: Blob } | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(takeoffId);
      req.onsuccess = () => resolve(req.result as { name: string; blob: Blob } | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return hit ? new File([hit.blob], hit.name, { type: 'application/pdf' }) : null;
  } catch {
    return null;
  }
}
