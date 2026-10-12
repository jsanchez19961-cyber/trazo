// Sincronización con Google Drive.
// En Drive, carpeta «Trazo»: un archivo por documento (comprimido), los archivos originales
// (PDF, imágenes, audios) aparte, y un índice con carpetas, proyectos, colecciones y etiquetas.
// Regla: gana el cambio más reciente; si un documento cambió en los dos sitios, se guardan los dos.
import { db } from './db.js';
import { state, emit, setSetting, deleteItemsForever, textId } from './store.js';
import { drive as realDrive, hasToken, NeedAuth, driveConfigured } from './drive.js';
import { packPage, unpackPage } from './backup.js';
import { uid, debounce, safeFileName } from './util.js';

const FOLDER = 'Trazo';
const LIB_NAME = 'trazo-biblioteca.json';
const LISTS = ['folders', 'projects', 'collections', 'tags'];

let status = { state: 'off', msg: '', at: 0 };
let running = null;
let openDoc = null;
let applying = false;

export const syncEnabled = () => !!state.settings.driveEnabled && driveConfigured();
export const getSyncStatus = () => status;
export const isApplying = () => applying;
export function setOpenDoc(id) { openDoc = id; }

export function setStatus(s, msg = '') {
  status = { state: s, msg, at: Date.now() };
  emit('sync', status);
}

export function syncNow({ adapter } = {}) {
  if (running) return running;
  running = doSync(adapter || realDrive).finally(() => { running = null; });
  return running;
}

export const syncSoon = debounce(() => {
  if (syncEnabled() && hasToken()) syncNow().catch(() => {});
}, 8000);

// ---------- Utilidades ----------
async function gzip(str) {
  if (typeof CompressionStream === 'undefined') return { blob: new Blob([str], { type: 'application/json' }), gz: false };
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' }), gz: true };
}

async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function refBlobs(item, pages) {
  const s = new Set();
  if (item.blobId) s.add(item.blobId);
  for (const a of item.audio || []) s.add(a.blobId);
  for (const p of pages) {
    if (p.bg?.blobId) s.add(p.bg.blobId);
    for (const im of p.images || []) s.add(im.blobId);
  }
  return s;
}

const stamp = x => x.updated || x.created || 0;

function mergeList(a = [], b = [], tomb) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    const cur = m.get(x.id);
    if (!cur || stamp(x) > stamp(cur)) m.set(x.id, x);
  }
  for (const [id, x] of m) if (tomb[id] && tomb[id] >= stamp(x)) m.delete(id);
  return [...m.values()].sort((p, q) => (p.id < q.id ? -1 : 1));
}

export function mergeLibrary(local, remote) {
  const tomb = { ...(remote?.tombstones || {}) };
  for (const [k, v] of Object.entries(local.tombstones || {})) tomb[k] = Math.max(tomb[k] || 0, v);
  const out = { format: 'trazo-lib', v: 1, tombstones: tomb };
  for (const k of LISTS) out[k] = mergeList(local[k], remote?.[k], tomb);
  return out;
}

function localLibrary() {
  const lib = { tombstones: state.settings.tombstones || {} };
  for (const k of LISTS) lib[k] = [...state[k].values()];
  return lib;
}

async function applyLibrary(merged) {
  let changed = false;
  for (const k of LISTS) {
    const map = state[k];
    const ids = new Set(merged[k].map(x => x.id));
    for (const x of merged[k]) {
      if (JSON.stringify(map.get(x.id)) !== JSON.stringify(x)) { await db.put(k, x); map.set(x.id, x); changed = true; }
    }
    for (const id of [...map.keys()]) if (!ids.has(id)) { await db.del(k, id); map.delete(id); changed = true; }
  }
  if (JSON.stringify(state.settings.tombstones || {}) !== JSON.stringify(merged.tombstones)) {
    state.settings.tombstones = merged.tombstones;
    await db.put('settings', { key: 'tombstones', value: merged.tombstones });
  }
  return changed;
}

// ---------- Sincronizar ----------
async function doSync(drive) {
  if (!hasToken() && drive === realDrive) { setStatus('auth', 'Toca para conectar con Google Drive'); throw new NeedAuth(); }
  setStatus('syncing', 'Sincronizando…');
  applying = true;
  const stats = { up: 0, down: 0, del: 0, conflicts: 0, skipped: 0 };
  let touched = false;
  try {
    const st = JSON.parse(JSON.stringify(state.settings.driveSync || {}));
    st.docs = st.docs || {};
    if (!st.folderId || !(await drive.folderExists(st.folderId))) {
      st.folderId = (await drive.findFolder(FOLDER)) || (await drive.createFolder(FOLDER));
      st.docs = {};
    }
    const files = await drive.list(st.folderId);
    const remoteDocs = new Map(), remoteBlobs = new Map(), extra = [];
    let libFile = null;
    for (const f of files) {
      const ap = f.appProperties || {};
      if (ap.t === 'doc' && ap.tid) {
        const cur = remoteDocs.get(ap.tid);
        if (!cur) remoteDocs.set(ap.tid, f);
        else if (Number(ap.rev) > Number(cur.appProperties.rev)) { extra.push(cur); remoteDocs.set(ap.tid, f); } else extra.push(f);
      } else if (ap.t === 'blob' && ap.bid) remoteBlobs.set(ap.bid, f);
      else if (ap.t === 'lib') { if (libFile) extra.push(libFile); libFile = f; }
    }
    for (const f of extra) await drive.remove(f.id);

    // Índice de la biblioteca
    let remoteLibText = null;
    if (libFile) remoteLibText = new TextDecoder().decode(await drive.download(libFile.id));
    const merged = mergeLibrary(localLibrary(), remoteLibText ? JSON.parse(remoteLibText) : null);
    if (await applyLibrary(merged)) touched = true;
    const mergedText = JSON.stringify(merged);
    if (mergedText !== remoteLibText) {
      await drive.upload({ fileId: libFile?.id, name: LIB_NAME, mimeType: 'application/json', parent: st.folderId, appProperties: { t: 'lib' }, data: new Blob([mergedText], { type: 'application/json' }) });
    }
    const tomb = merged.tombstones;

    // Documentos borrados para siempre en algún dispositivo
    for (const id of Object.keys(tomb)) {
      if (state.items.has(id) && id !== openDoc) { await deleteItemsForever([id], { tombstone: false }); stats.del++; touched = true; }
      const rf = remoteDocs.get(id);
      if (rf) { await drive.remove(rf.id); remoteDocs.delete(id); }
      delete st.docs[id];
    }

    const localBlobs = new Set(await db.keys('blobs'));
    const ctx = { drive, st, remoteBlobs, localBlobs };
    const ids = new Set([...state.items.keys(), ...remoteDocs.keys()]);
    for (const id of ids) {
      if (tomb[id]) continue;
      if (id === openDoc) { stats.skipped++; continue; }
      const local = state.items.get(id), rf = remoteDocs.get(id), s = st.docs[id];
      const lrev = local ? (local.rev || local.updated || 0) : 0;
      const rrev = rf ? Number(rf.appProperties.rev || 0) : 0;
      if (local && !rf) { await uploadDoc(ctx, id, null); stats.up++; continue; }
      if (!local && rf) { await downloadDoc(ctx, rf); stats.down++; touched = true; continue; }
      if (!s) {
        if (lrev === rrev) st.docs[id] = { fileId: rf.id, lr: lrev, rr: rrev };
        else if (lrev > rrev) { await uploadDoc(ctx, id, rf.id); stats.up++; } else { await downloadDoc(ctx, rf); stats.down++; touched = true; }
        continue;
      }
      const localChanged = lrev > (s.lr || 0);
      const remoteChanged = rrev !== (s.rr || 0);
      if (localChanged && remoteChanged) {
        await downloadDoc(ctx, rf, { asCopy: true });
        await uploadDoc(ctx, id, rf.id);
        stats.conflicts++;
        touched = true;
      } else if (localChanged) { await uploadDoc(ctx, id, rf.id); stats.up++; } else if (remoteChanged) { await downloadDoc(ctx, rf); stats.down++; touched = true; } else if (s.fileId !== rf.id) s.fileId = rf.id;
    }
    for (const id of Object.keys(st.docs)) if (!state.items.has(id) && !remoteDocs.has(id) && id !== openDoc) delete st.docs[id];

    // Archivos originales que ya no usa nadie
    if (!stats.skipped) {
      const used = new Set();
      for (const it of state.items.values()) {
        if (it.blobId) used.add(it.blobId);
        for (const a of it.audio || []) used.add(a.blobId);
      }
      for (const p of await db.getAll('pages')) {
        if (p.bg?.blobId) used.add(p.bg.blobId);
        for (const im of p.images || []) used.add(im.blobId);
      }
      for (const [bid, f] of remoteBlobs) if (!used.has(bid)) await drive.remove(f.id);
    }

    st.last = Date.now();
    state.settings.driveSync = st;
    await db.put('settings', { key: 'driveSync', value: st });
    const parts = [];
    if (stats.up) parts.push(`${stats.up} subidos`);
    if (stats.down) parts.push(`${stats.down} recibidos`);
    if (stats.del) parts.push(`${stats.del} borrados`);
    if (stats.conflicts) parts.push(`${stats.conflicts} con cambios en dos sitios (se guardan las dos versiones)`);
    setStatus('ok', parts.length ? parts.join(', ') : 'Todo al día');
    return stats;
  } catch (e) {
    if (e instanceof NeedAuth) setStatus('auth', e.message);
    else { console.error(e); setStatus('error', e.message); }
    throw e;
  } finally {
    applying = false;
    if (touched) {
      for (const ev of ['items', ...LISTS, 'texts']) emit(ev, { fromSync: true });
    }
    emit('settings', { key: 'driveSync' });
  }
}

async function uploadDoc({ drive, st, remoteBlobs }, id, fileId) {
  const item = state.items.get(id);
  const pages = await db.byIndex('pages', 'docId', id);
  const texts = await db.byIndex('texts', 'docId', id);
  const rev = item.rev || item.updated || Date.now();
  for (const b of refBlobs(item, pages)) {
    if (remoteBlobs.has(b)) continue;
    const rec = await db.get('blobs', b);
    if (!rec) continue;
    const type = rec.type || 'application/octet-stream';
    const f = await drive.upload({
      name: `archivo-${b.slice(0, 8)}-${safeFileName(rec.name || 'archivo')}`, mimeType: type, parent: st.folderId,
      appProperties: { t: 'blob', bid: b }, data: new Blob([rec.data], { type }),
    });
    remoteBlobs.set(b, f);
  }
  const json = JSON.stringify({ format: 'trazo-doc', v: 1, item, pages: pages.map(packPage), texts });
  const { blob, gz } = await gzip(json);
  const f = await drive.upload({
    fileId, name: `${safeFileName(item.title).slice(0, 80)} · ${id.slice(0, 8)}.trazo${gz ? '.gz' : '.json'}`, mimeType: blob.type, parent: st.folderId,
    appProperties: { t: 'doc', tid: id, rev: String(rev), z: gz ? '1' : '0' }, data: blob,
  });
  st.docs[id] = { fileId: f.id, lr: rev, rr: rev };
}

async function downloadDoc({ drive, st, remoteBlobs, localBlobs }, rf, { asCopy = false } = {}) {
  const buf = await drive.download(rf.id);
  const text = rf.appProperties.z === '1' ? await gunzip(buf) : new TextDecoder().decode(buf);
  const data = JSON.parse(text);
  if (data.format !== 'trazo-doc') throw new Error('Archivo de Drive desconocido: ' + rf.name);
  let item = data.item;
  let pages = (data.pages || []).map(unpackPage);
  let texts = data.texts || [];
  for (const b of refBlobs(item, pages)) {
    if (localBlobs.has(b)) continue;
    const bf = remoteBlobs.get(b);
    if (!bf) continue;
    const d = await drive.download(bf.id);
    await db.put('blobs', { id: b, data: d, type: bf.mimeType, name: bf.name, size: d.byteLength });
    localBlobs.add(b);
  }
  if (asCopy) {
    const newId = uid();
    const map = new Map(pages.map(p => [p.id, uid()]));
    pages = pages.map(p => ({ ...p, id: map.get(p.id), docId: newId }));
    texts = texts.map(t => {
      const pageId = t.pageId ? map.get(t.pageId) || null : null;
      return { ...t, docId: newId, pageId, id: textId(newId, pageId, t.source) };
    });
    item = { ...item, id: newId, title: item.title + ' (versión de otro dispositivo)', pageIds: (item.pageIds || []).map(x => map.get(x)).filter(Boolean), rev: Date.now() };
  } else {
    const old = await db.byIndex('pages', 'docId', item.id);
    await db.delMany('pages', old.map(p => p.id));
    const oldT = await db.byIndex('texts', 'docId', item.id);
    await db.delMany('texts', oldT.map(t => t.id));
  }
  await db.putMany('pages', pages);
  await db.putMany('texts', texts);
  await db.put('items', item);
  state.items.set(item.id, item);
  if (!asCopy) st.docs[item.id] = { fileId: rf.id, lr: item.rev || item.updated || 0, rr: Number(rf.appProperties.rev || 0) };
}

export { NeedAuth };
