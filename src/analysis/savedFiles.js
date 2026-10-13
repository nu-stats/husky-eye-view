/**
 * Your saved files for Merge & Export: uploaded files kept in this browser
 * (IndexedDB) so they can be picked again later. They never leave the
 * computer. Every call fails soft (private windows, blocked storage): the
 * list is then empty and saving reports that it could not.
 */
const DB_NAME = 'hev-merge-files';
const STORE = 'files';
/** Keep the store modest: browsers cap a site's storage. */
export const MAX_SAVED_BYTES = 100 * 1024 * 1024;

function open(indexedDb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!indexedDb) return reject(new Error('This browser cannot keep files.'));
    const request = indexedDb.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('This browser cannot keep files.'));
  });
}

async function run(mode, work, indexedDb) {
  const db = await open(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      // The request's own result: undefined when get() finds nothing.
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          tx.error || new Error('Saving was stopped (is the disk full?).'),
        );
    });
  } finally {
    db.close();
  }
}

/** The saved files, newest first: [{id, name, size, savedAt}]. */
export async function listSavedFiles(indexedDb) {
  try {
    const all = await run('readonly', (store) => store.getAll(), indexedDb);
    return (all || [])
      .map(({ id, name, size, savedAt }) => ({ id, name, size, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Keep a file; returns {ok, id, problem}. */
export async function saveFile(name, bytes, indexedDb) {
  if (bytes.length > MAX_SAVED_BYTES)
    return {
      ok: false,
      problem: `Files over ${MAX_SAVED_BYTES / 1048576} MB are not kept; upload it again next time.`,
    };
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await run(
      'readwrite',
      (store) =>
        store.put({ id, name, size: bytes.length, savedAt: Date.now(), bytes }),
      indexedDb,
    );
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      problem: error?.message || 'The file could not be kept.',
    };
  }
}

/** A saved file's {name, bytes}, or null. */
export async function loadSavedFile(id, indexedDb) {
  try {
    const entry = await run('readonly', (store) => store.get(id), indexedDb);
    return entry
      ? { name: entry.name, bytes: new Uint8Array(entry.bytes) }
      : null;
  } catch {
    return null;
  }
}

/** Forget a saved file. */
export async function deleteSavedFile(id, indexedDb) {
  try {
    await run('readwrite', (store) => store.delete(id), indexedDb);
    return true;
  } catch {
    return false;
  }
}
