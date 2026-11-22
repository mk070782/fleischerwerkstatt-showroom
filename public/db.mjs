// Speicher auf dem Gerät (IndexedDB). Alle Daten bleiben auf dem Handy, bis man eine Sicherung exportiert.

const DB_NAME = 'airkneipi-fleischerwerkstatt';
const DB_VERSION = 1;
export const STORES = ['products', 'customers', 'orders'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
    const r = fn(tx);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
  });
}

export const all = (store) => run([store], 'readonly', (tx) => tx.objectStore(store).getAll());
export const put = (store, value) => run([store], 'readwrite', (tx) => tx.objectStore(store).put(value));
export const remove = (store, id) => run([store], 'readwrite', (tx) => tx.objectStore(store).delete(id));
export const getMeta = (key) => run(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(key));
export const setMeta = (key, value) => run(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(value, key));

/** Ersetzt alle Daten auf einmal (Sicherung, Abgleich, alles löschen). Die angefangene Bestellung bleibt. */
export function replaceAll(data) {
  return run([...STORES, 'meta'], 'readwrite', (tx) => {
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      for (const row of data[name] || []) store.put(row);
    }
    const meta = tx.objectStore('meta');
    meta.put(data.settings || {}, 'settings');
    meta.put(data.tombstones || {}, 'tombstones');
  });
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen (wichtig auf dem iPhone). */
export async function askPersistent() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* nicht unterstützt */ }
}
