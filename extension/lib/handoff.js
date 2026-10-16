// Passes PDF bytes from the service worker to the signer tab. IndexedDB is
// shared by every page of the extension and stores ArrayBuffers without the
// size limits of chrome.storage or runtime messaging.
const DB = 'yepsign';
const STORE = 'handoff';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

export function putHandoff(token, value) {
  return tx('readwrite', (s) => s.put({ ...value, at: Date.now() }, token));
}

/** Read and delete in one step, so a reload can't resurrect an old file. */
export async function takeHandoff(token) {
  const value = await tx('readonly', (s) => s.get(token));
  await tx('readwrite', (s) => s.delete(token));
  return value;
}

/** Drop handoffs older than an hour that no tab claimed. */
export function sweepHandoffs() {
  const cutoff = Date.now() - 3600_000;
  return tx('readwrite', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if (!cur.value?.at || cur.value.at < cutoff) cur.delete();
      cur.continue();
    };
    return req;
  });
}
