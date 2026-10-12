// Copias de seguridad (.zip) y restauración. También sirve para pasar
// documentos entre dispositivos (tablet, oficina, casa).
import { loadJSZip } from './libs.js';
import { db } from './db.js';
import { state, loadAll, emit, setSetting } from './store.js';

const FORMAT = 'trazo-backup';

export function packPage(p) {
  return {
    ...p,
    strokes: p.strokes.map(s => ({ ...s, pts: Array.from(s.pts, v => Math.round(v * 100) / 100) })),
  };
}

export function unpackPage(p) {
  return { ...p, strokes: (p.strokes || []).map(s => ({ ...s, pts: new Float32Array(s.pts) })), texts: p.texts || [], images: p.images || [] };
}

// itemIds = null → copia completa (incluida la papelera).
export async function exportBackup({ itemIds = null, onProgress } = {}) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const full = !itemIds;
  const items = full ? [...state.items.values()] : itemIds.map(id => state.items.get(id)).filter(Boolean);
  const pages = [], texts = [];
  const blobIds = new Set();
  for (const it of items) {
    const ps = await db.byIndex('pages', 'docId', it.id);
    for (const p of ps) {
      pages.push(packPage(p));
      if (p.bg?.blobId) blobIds.add(p.bg.blobId);
      for (const im of p.images || []) blobIds.add(im.blobId);
    }
    texts.push(...(await db.byIndex('texts', 'docId', it.id)));
    if (it.blobId) blobIds.add(it.blobId);
    for (const a of it.audio || []) blobIds.add(a.blobId);
  }
  let folders = [...state.folders.values()], projects = [...state.projects.values()], tags = [...state.tags.values()], collections = [...state.collections.values()];
  if (!full) {
    const fset = new Set();
    for (const it of items) { let f = state.folders.get(it.folderId); while (f && !fset.has(f.id)) { fset.add(f.id); f = state.folders.get(f.parentId); } }
    folders = folders.filter(f => fset.has(f.id));
    projects = projects.filter(p => items.some(i => i.projectId === p.id));
    tags = tags.filter(t => items.some(i => (i.tags || []).includes(t.id)));
    collections = [];
  }
  const settings = full ? Object.entries(state.settings).filter(([k]) => k !== 'aiKey').map(([key, value]) => ({ key, value })) : [];
  const blobsMeta = [];
  let n = 0;
  for (const id of blobIds) {
    const rec = await db.get('blobs', id);
    if (!rec) continue;
    blobsMeta.push({ id, type: rec.type, name: rec.name, size: rec.size });
    zip.file('blobs/' + id, rec.data, { compression: 'STORE' });
    onProgress?.(++n, blobIds.size);
  }
  const data = {
    format: FORMAT, version: 1, created: Date.now(), full,
    items: items.map(i => ({ ...i })), pages, texts, folders, projects, tags, collections, settings, blobs: blobsMeta,
  };
  zip.file('trazo.json', JSON.stringify(data));
  zip.file('LEEME.txt', 'Copia de seguridad de Trazo.\nPara recuperarla: Trazo > Ajustes > Restaurar copia.\nNo hace falta descomprimirla.\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (full) await setSetting('lastBackup', Date.now());
  return blob;
}

export async function readBackup(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const f = zip.file('trazo.json');
  if (!f) throw new Error('Este archivo no es una copia de Trazo.');
  const data = JSON.parse(await f.async('string'));
  if (data.format !== FORMAT) throw new Error('Formato de copia desconocido.');
  return { zip, data };
}

// mode: 'merge' (añade y actualiza lo más reciente) o 'replace' (borra todo antes).
export async function restoreBackup({ zip, data }, mode = 'merge', onProgress) {
  if (mode === 'replace') {
    const keepKey = state.settings.aiKey;
    for (const s of ['items', 'pages', 'blobs', 'folders', 'projects', 'collections', 'tags', 'texts']) await db.clear(s);
    if (data.settings?.length) {
      await db.clear('settings');
      await db.putMany('settings', data.settings);
      if (keepKey) await db.put('settings', { key: 'aiKey', value: keepKey });
    }
  }
  const existing = mode === 'replace' ? new Map() : new Map((await db.getAll('items')).map(i => [i.id, i]));
  const accept = new Set();
  for (const it of data.items) {
    const cur = existing.get(it.id);
    if (!cur || (it.updated || 0) > (cur.updated || 0)) accept.add(it.id);
  }
  // Archivos internos que faltan.
  const have = new Set(mode === 'replace' ? [] : await db.keys('blobs'));
  let n = 0;
  for (const b of data.blobs || []) {
    if (have.has(b.id)) continue;
    const zf = zip.file('blobs/' + b.id);
    if (!zf) continue;
    const buf = await zf.async('arraybuffer');
    await db.put('blobs', { id: b.id, data: buf, type: b.type, name: b.name, size: buf.byteLength });
    onProgress?.(++n, data.blobs.length);
  }
  for (const id of accept) {
    const old = await db.byIndex('pages', 'docId', id);
    await db.delMany('pages', old.map(p => p.id));
    const oldT = await db.byIndex('texts', 'docId', id);
    await db.delMany('texts', oldT.map(t => t.id));
  }
  await db.putMany('items', data.items.filter(i => accept.has(i.id)));
  await db.putMany('pages', data.pages.filter(p => accept.has(p.docId)).map(unpackPage));
  await db.putMany('texts', (data.texts || []).filter(t => accept.has(t.docId)));
  for (const [store, list] of [['folders', data.folders], ['projects', data.projects], ['tags', data.tags], ['collections', data.collections]]) {
    if (!list?.length) continue;
    const ids = new Set(mode === 'replace' ? [] : await db.keys(store));
    await db.putMany(store, list.filter(x => mode === 'replace' || !ids.has(x.id)));
  }
  await loadAll();
  for (const e of ['items', 'folders', 'projects', 'tags', 'collections', 'settings', 'texts']) emit(e, {});
  return { added: accept.size, skipped: data.items.length - accept.size };
}
