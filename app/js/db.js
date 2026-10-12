// Base de datos local del navegador (IndexedDB).

const NAME = 'trazo';
const VERSION = 1;
export const STORES = ['items', 'pages', 'blobs', 'folders', 'projects', 'collections', 'tags', 'texts', 'settings'];

let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      const mk = (name, opts, indexes = []) => {
        if (d.objectStoreNames.contains(name)) return;
        const s = d.createObjectStore(name, opts);
        for (const ix of indexes) s.createIndex(ix, ix, { unique: false });
      };
      mk('items', { keyPath: 'id' }, ['folderId', 'updated']);
      mk('pages', { keyPath: 'id' }, ['docId']);
      mk('blobs', { keyPath: 'id' });
      mk('folders', { keyPath: 'id' });
      mk('projects', { keyPath: 'id' });
      mk('collections', { keyPath: 'id' });
      mk('tags', { keyPath: 'id' });
      mk('texts', { keyPath: 'id' }, ['docId']);
      mk('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => { d.close(); location.reload(); };
      resolve(d);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está abierta en otra pestaña con otra versión. Cierra las demás pestañas de Trazo.'));
  });
  return dbp;
}

function done(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

function txDone(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transacción cancelada'));
  });
}

async function store(name, mode = 'readonly') {
  const d = await openDB();
  return d.transaction(name, mode).objectStore(name);
}

export const db = {
  async get(name, key) { return done((await store(name)).get(key)); },
  async getAll(name) { return done((await store(name)).getAll()); },
  async byIndex(name, index, value) { return done((await store(name)).index(index).getAll(value)); },
  async put(name, value) {
    const d = await openDB();
    const tx = d.transaction(name, 'readwrite');
    tx.objectStore(name).put(value);
    return txDone(tx);
  },
  async putMany(name, values) {
    if (!values.length) return;
    const d = await openDB();
    const tx = d.transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    for (const v of values) s.put(v);
    return txDone(tx);
  },
  async del(name, key) {
    const d = await openDB();
    const tx = d.transaction(name, 'readwrite');
    tx.objectStore(name).delete(key);
    return txDone(tx);
  },
  async delMany(name, keys) {
    if (!keys.length) return;
    const d = await openDB();
    const tx = d.transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    for (const k of keys) s.delete(k);
    return txDone(tx);
  },
  async keys(name) { return done((await store(name)).getAllKeys()); },
  async clear(name) {
    const d = await openDB();
    const tx = d.transaction(name, 'readwrite');
    tx.objectStore(name).clear();
    return txDone(tx);
  },
};
