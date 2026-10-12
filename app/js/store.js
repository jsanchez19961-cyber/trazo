// Estado de la aplicación en memoria + guardado en la base de datos local.
import { db } from './db.js';
import { uid } from './util.js';

export const PAGE_SIZES = {
  a4: { name: 'A4 vertical', w: 794, h: 1123 },
  a4l: { name: 'A4 horizontal', w: 1123, h: 794 },
  a5: { name: 'A5', w: 559, h: 794 },
  letter: { name: 'Carta', w: 816, h: 1056 },
  wide: { name: 'Panorámica 16:9', w: 1280, h: 720 },
};

export const PAPERS = {
  blank: 'En blanco',
  lined: 'Rayado',
  grid: 'Cuadrícula',
  dots: 'Puntos',
  cornell: 'Cornell',
};

export const PAPER_COLORS = { '#ffffff': 'Blanco', '#fbf7ec': 'Crema', '#f2f4f7': 'Gris claro', '#eef6ee': 'Verde suave' };

export const KINDS = { notebook: 'Cuaderno', board: 'Pizarra', pdf: 'PDF', file: 'Archivo' };

export const DEFAULT_SETTINGS = {
  fingerDraw: false,
  theme: 'system',
  defaultPaper: 'lined',
  defaultPaperColor: '#ffffff',
  defaultSize: 'a4',
  autoOcr: true,
  aiKey: '',
  aiModel: 'claude-opus-5-5',
  lastBackup: 0,
  backupDays: 7,
  libraryView: 'grid',
  librarySort: 'updated',
  twoFingerUndo: true,
  penColors: ['#1d1d1f', '#1f4fd1', '#d12a2a', '#13804a'],
  hlColors: ['#ffe14d', '#7ee081', '#ff9ccf', '#7cc8ff'],
  tool: null,
};

export const state = {
  items: new Map(),
  folders: new Map(),
  projects: new Map(),
  collections: new Map(),
  tags: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
};

// ---------- Eventos ----------
const bus = new EventTarget();
export function on(type, fn) {
  const l = e => fn(e.detail);
  bus.addEventListener(type, l);
  return () => bus.removeEventListener(type, l);
}
export function emit(type, detail) { bus.dispatchEvent(new CustomEvent(type, { detail })); }

// ---------- Carga ----------
export async function loadAll() {
  const [items, folders, projects, collections, tags, settings] = await Promise.all(
    ['items', 'folders', 'projects', 'collections', 'tags', 'settings'].map(s => db.getAll(s)));
  state.items = new Map(items.map(x => [x.id, x]));
  state.folders = new Map(folders.map(x => [x.id, x]));
  state.projects = new Map(projects.map(x => [x.id, x]));
  state.collections = new Map(collections.map(x => [x.id, x]));
  state.tags = new Map(tags.map(x => [x.id, x]));
  state.settings = { ...DEFAULT_SETTINGS };
  for (const s of settings) state.settings[s.key] = s.value;
  state.loaded = true;
  await purgeTrash();
}

export async function setSetting(key, value) {
  state.settings[key] = value;
  await db.put('settings', { key, value });
  emit('settings', { key, value });
}

// Pide al navegador que no borre los datos por falta de espacio.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  } catch { return false; }
}

// ---------- Documentos ----------
export function newPage(docId, { w, h, paper, paperColor, bg } = {}) {
  return {
    id: uid(), docId, w, h,
    bg: bg || { type: paper || 'lined', color: paperColor || '#ffffff' },
    strokes: [], texts: [], images: [],
  };
}

export async function createItem(data) {
  const t = Date.now();
  const item = {
    id: uid(), kind: 'notebook', title: 'Sin título', folderId: null, projectId: null,
    tags: [], favorite: false, created: t, updated: t, opened: t, trashed: null,
    pageIds: [], thumb: null, audio: [],
    ...data,
  };
  state.items.set(item.id, item);
  await db.put('items', item);
  emit('items', { id: item.id, type: 'create' });
  requestPersistence();
  return item;
}

export async function createNotebook({ title, folderId = null, projectId = null, paper, paperColor, size } = {}) {
  const s = state.settings;
  const sz = PAGE_SIZES[size || s.defaultSize] || PAGE_SIZES.a4;
  const item = await createItem({
    kind: 'notebook', title: title || 'Cuaderno sin título', folderId, projectId,
    paper: paper || s.defaultPaper, paperColor: paperColor || s.defaultPaperColor, size: size || s.defaultSize,
  });
  const page = newPage(item.id, { w: sz.w, h: sz.h, paper: item.paper, paperColor: item.paperColor });
  await db.put('pages', page);
  item.pageIds = [page.id];
  await saveItem(item);
  return item;
}

export async function createBoard({ title, folderId = null, projectId = null } = {}) {
  const item = await createItem({ kind: 'board', title: title || 'Pizarra sin título', folderId, projectId, paper: 'dots' });
  const page = newPage(item.id, { w: 0, h: 0, bg: { type: 'infinite', color: '#ffffff' } });
  page.infinite = true;
  await db.put('pages', page);
  item.pageIds = [page.id];
  await saveItem(item);
  return item;
}

// rev: marca de cualquier cambio (la usa la sincronización). norev para cambios sin importancia.
export async function saveItem(item, { silent = false, norev = false } = {}) {
  if (!norev) item.rev = Date.now();
  state.items.set(item.id, item);
  await db.put('items', item);
  if (!silent) emit('items', { id: item.id, type: 'update' });
}

export async function updateItem(id, patch, { touch = true, silent = false } = {}) {
  const item = state.items.get(id);
  if (!item) return;
  Object.assign(item, patch);
  if (touch) item.updated = Date.now();
  await saveItem(item, { silent });
  return item;
}

export async function updateItems(ids, patchFn) {
  const list = [];
  const t = Date.now();
  for (const id of ids) {
    const it = state.items.get(id);
    if (!it) continue;
    patchFn(it);
    it.rev = t;
    list.push(it);
  }
  await db.putMany('items', list);
  emit('items', { ids, type: 'update' });
}

export async function trashItems(ids) {
  const t = Date.now();
  await updateItems(ids, it => { it.trashed = t; });
}

export async function restoreItems(ids) {
  await updateItems(ids, it => {
    it.trashed = null;
    if (it.folderId && !state.folders.has(it.folderId)) it.folderId = null;
  });
}

// Lo borrado para siempre se apunta para que la sincronización lo borre también en los demás.
export async function addTombstones(ids) {
  if (!ids.length) return;
  const t = { ...(state.settings.tombstones || {}) };
  const now = Date.now();
  for (const id of ids) t[id] = now;
  for (const [k, v] of Object.entries(t)) if (now - v > 120 * 86400000) delete t[k];
  state.settings.tombstones = t;
  await db.put('settings', { key: 'tombstones', value: t });
}

export async function deleteItemsForever(ids, { tombstone = true } = {}) {
  if (tombstone) await addTombstones(ids);
  for (const id of ids) {
    const pages = await db.byIndex('pages', 'docId', id);
    await db.delMany('pages', pages.map(p => p.id));
    const texts = await db.byIndex('texts', 'docId', id);
    await db.delMany('texts', texts.map(t => t.id));
    await db.del('items', id);
    state.items.delete(id);
    for (const c of state.collections.values()) {
      if (c.itemIds && c.itemIds.includes(id)) {
        c.itemIds = c.itemIds.filter(x => x !== id);
        await db.put('collections', c);
      }
    }
  }
  emit('items', { ids, type: 'delete' });
  emit('texts', {});
  await gcBlobs();
}

async function purgeTrash() {
  const limit = Date.now() - 30 * 86400000;
  const old = [...state.items.values()].filter(i => i.trashed && i.trashed < limit).map(i => i.id);
  if (old.length) await deleteItemsForever(old);
}

// Borra archivos internos que ya no usa ningún documento.
export async function gcBlobs() {
  const used = new Set();
  for (const it of state.items.values()) {
    if (it.blobId) used.add(it.blobId);
    for (const a of it.audio || []) used.add(a.blobId);
  }
  const pages = await db.getAll('pages');
  for (const p of pages) {
    if (p.bg && p.bg.blobId) used.add(p.bg.blobId);
    for (const im of p.images || []) used.add(im.blobId);
  }
  const keys = await db.keys('blobs');
  const unused = keys.filter(k => !used.has(k));
  await db.delMany('blobs', unused);
  for (const k of unused) revokeBlobURL(k);
}

export async function duplicateItem(id) {
  const src = state.items.get(id);
  if (!src) return;
  const pages = await getPages(id);
  const copy = await createItem({
    ...structuredClone({ ...src, thumb: null }), id: uid(), title: src.title + ' (copia)',
    created: Date.now(), updated: Date.now(), favorite: false, trashed: null, pageIds: [],
  });
  copy.thumb = src.thumb;
  const newPages = pages.map(p => ({ ...structuredClone(p), id: uid(), docId: copy.id }));
  await db.putMany('pages', newPages);
  copy.pageIds = newPages.map(p => p.id);
  await saveItem(copy);
  const texts = await db.byIndex('texts', 'docId', id);
  const map = new Map(pages.map((p, i) => [p.id, newPages[i].id]));
  await db.putMany('texts', texts.map(t => {
    const pageId = t.pageId ? map.get(t.pageId) : null;
    return { ...t, docId: copy.id, pageId, id: textId(copy.id, pageId, t.source) };
  }));
  emit('texts', { docId: copy.id });
  return copy;
}

export function liveItems() {
  return [...state.items.values()].filter(i => !i.trashed);
}

// ---------- Páginas ----------
export async function getPages(docId) {
  const item = state.items.get(docId);
  const pages = await db.byIndex('pages', 'docId', docId);
  const byId = new Map(pages.map(p => [p.id, p]));
  const ordered = (item?.pageIds || []).map(id => byId.get(id)).filter(Boolean);
  // Páginas huérfanas (por si algo se quedó a medias): se añaden al final.
  for (const p of pages) if (!ordered.includes(p)) ordered.push(p);
  return ordered;
}

export async function savePages(pages) { await db.putMany('pages', pages); }
export async function deletePages(ids) { await db.delMany('pages', ids); }

// ---------- Archivos internos ----------
const blobUrls = new Map();

export async function putBlob(data, { name = '', type = '' } = {}) {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const id = uid();
  await db.put('blobs', { id, data: buf, type: type || (data instanceof Blob ? data.type : ''), name, size: buf.byteLength });
  return id;
}

export async function getBlobRecord(id) { return db.get('blobs', id); }

export async function getBlob(id) {
  const r = await db.get('blobs', id);
  return r ? new Blob([r.data], { type: r.type }) : null;
}

export async function getBlobURL(id) {
  if (blobUrls.has(id)) return blobUrls.get(id);
  const b = await getBlob(id);
  if (!b) return null;
  const url = URL.createObjectURL(b);
  blobUrls.set(id, url);
  return url;
}

function revokeBlobURL(id) {
  const u = blobUrls.get(id);
  if (u) { URL.revokeObjectURL(u); blobUrls.delete(id); }
}

// ---------- Textos para la búsqueda ----------
export const textId = (docId, pageId, source) => `${docId}|${pageId || 'doc'}|${source}`;

export async function setText(docId, pageId, source, text) {
  const id = textId(docId, pageId, source);
  if (!text || !text.trim()) await db.del('texts', id);
  else await db.put('texts', { id, docId, pageId: pageId || null, source, text, updated: Date.now() });
  await touchRev(docId);
  emit('texts', { docId });
}

// El texto reconocido también tiene que sincronizarse.
async function touchRev(docId) {
  const it = state.items.get(docId);
  if (!it) return;
  it.rev = Date.now();
  await db.put('items', it);
}

export async function setTexts(entries) {
  const put = [], del = [];
  for (const e of entries) {
    const id = textId(e.docId, e.pageId, e.source);
    if (!e.text || !e.text.trim()) del.push(id);
    else put.push({ id, docId: e.docId, pageId: e.pageId || null, source: e.source, text: e.text, updated: Date.now() });
  }
  await db.putMany('texts', put);
  await db.delMany('texts', del);
  for (const d of new Set(entries.map(e => e.docId))) await touchRev(d);
  if (entries.length) emit('texts', { docId: entries[0].docId });
}

export async function getDocTexts(docId) { return db.byIndex('texts', 'docId', docId); }
export async function getAllTexts() { return db.getAll('texts'); }

// ---------- Carpetas, proyectos, colecciones, etiquetas ----------
async function saveEntity(storeName, map, obj, evt) {
  obj.updated = Date.now();
  map.set(obj.id, obj);
  await db.put(storeName, obj);
  emit(evt, { id: obj.id });
  return obj;
}

export function saveFolder(f) {
  return saveEntity('folders', state.folders, { id: uid(), name: 'Carpeta', parentId: null, color: null, created: Date.now(), ...f }, 'folders');
}

export async function deleteFolder(id) {
  const f = state.folders.get(id);
  if (!f) return;
  for (const sub of state.folders.values()) if (sub.parentId === id) { sub.parentId = f.parentId; sub.updated = Date.now(); await db.put('folders', sub); }
  await updateItems([...state.items.values()].filter(i => i.folderId === id).map(i => i.id), it => { it.folderId = f.parentId; });
  await addTombstones([id]);
  state.folders.delete(id);
  await db.del('folders', id);
  emit('folders', { id });
}

export function folderPath(id) {
  const path = [];
  let f = state.folders.get(id);
  const seen = new Set();
  while (f && !seen.has(f.id)) { seen.add(f.id); path.unshift(f); f = state.folders.get(f.parentId); }
  return path;
}

export function isDescendant(folderId, ancestorId) {
  return folderPath(folderId).some(f => f.id === ancestorId);
}

export function saveProject(p) {
  return saveEntity('projects', state.projects, { id: uid(), name: 'Proyecto', color: '#3a6df0', status: 'activo', description: '', due: '', created: Date.now(), ...p }, 'projects');
}

export async function deleteProject(id) {
  await updateItems([...state.items.values()].filter(i => i.projectId === id).map(i => i.id), it => { it.projectId = null; });
  await addTombstones([id]);
  state.projects.delete(id);
  await db.del('projects', id);
  emit('projects', { id });
}

export function saveCollection(c) {
  return saveEntity('collections', state.collections, { id: uid(), name: 'Colección', kind: 'manual', itemIds: [], query: '', created: Date.now(), ...c }, 'collections');
}

export async function deleteCollection(id) {
  await addTombstones([id]);
  state.collections.delete(id);
  await db.del('collections', id);
  emit('collections', { id });
}

export async function addToCollection(colId, itemIds) {
  const c = state.collections.get(colId);
  if (!c) return;
  c.itemIds = [...new Set([...(c.itemIds || []), ...itemIds])];
  await saveEntity('collections', state.collections, c, 'collections');
}

export async function removeFromCollection(colId, itemIds) {
  const c = state.collections.get(colId);
  if (!c) return;
  c.itemIds = (c.itemIds || []).filter(x => !itemIds.includes(x));
  await saveEntity('collections', state.collections, c, 'collections');
}

export const TAG_COLORS = ['#e5484d', '#f76b15', '#f5b40b', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d8d'];

export function saveTag(t) {
  return saveEntity('tags', state.tags, { id: uid(), name: 'etiqueta', color: TAG_COLORS[state.tags.size % TAG_COLORS.length], ...t }, 'tags');
}

export async function deleteTag(id) {
  await updateItems([...state.items.values()].filter(i => i.tags?.includes(id)).map(i => i.id), it => { it.tags = it.tags.filter(t => t !== id); });
  await addTombstones([id]);
  state.tags.delete(id);
  await db.del('tags', id);
  emit('tags', { id });
}

export function tagByName(name) {
  const n = name.trim().toLowerCase();
  return [...state.tags.values()].find(t => t.name.toLowerCase() === n);
}
