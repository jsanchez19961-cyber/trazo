// Importar archivos: PDF, imágenes, documentos y cualquier otro.
import {
  state, createItem, saveItem, newPage, savePages, putBlob, setText, setTexts, getBlobURL, updateItem,
} from './store.js';
import { openPdfData, pdfPageSizes, pdfPageText } from './pdfdoc.js';
import { makeThumb } from './render.js';
import { readAsArrayBuffer, loadImage, uid } from './util.js';
import { loadMammoth } from './libs.js';
import { ocr } from './ocr.js';
import { toast } from './ui.js';

const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'log', 'ini', 'yaml', 'yml', 'rtf'];

export const ext = name => (String(name).split('.').pop() || '').toLowerCase();
export const baseName = name => String(name).replace(/\.[^.]+$/, '');

export function fileKind(file) {
  const e = ext(file.name), t = file.type || '';
  if (t === 'application/pdf' || e === 'pdf') return 'pdf';
  if (t.startsWith('image/') && !['svg'].includes(e)) return 'image';
  if (e === 'zip' && /trazo/i.test(file.name)) return 'backup';
  return 'file';
}

export async function importFiles(files, ctx = {}) {
  const created = [];
  for (const f of files) {
    try {
      const k = fileKind(f);
      let item;
      if (k === 'pdf') item = await importPdf(f, ctx);
      else if (k === 'image') item = await importImage(f, ctx);
      else item = await importOther(f, ctx);
      if (item) created.push(item);
    } catch (e) {
      console.error(e);
      toast(`No se pudo importar «${f.name}»: ${e.message}`, { type: 'error', duration: 7000 });
    }
  }
  return created;
}

// ---------- PDF ----------
export async function importPdf(file, ctx = {}) {
  const t = toast(`Importando «${file.name}»…`, { duration: 0 });
  try {
    const data = await readAsArrayBuffer(file);
    const pdf = await openPdfData(data);
    const sizes = await pdfPageSizes(pdf);
    const blobId = await putBlob(data, { name: file.name, type: 'application/pdf' });
    const item = await createItem({
      kind: 'pdf', title: baseName(file.name), blobId, fileName: file.name, size: data.byteLength,
      folderId: ctx.folderId || null, projectId: ctx.projectId || null,
    });
    const pages = sizes.map((s, i) => newPage(item.id, { w: s.w, h: s.h, bg: { type: 'pdf', blobId, page: i + 1, color: '#ffffff' } }));
    await savePages(pages);
    item.pageIds = pages.map(p => p.id);
    await saveItem(item);
    t.close();
    makeThumb(pages[0]).then(th => updateItem(item.id, { thumb: th }, { touch: false })).catch(e => console.warn('Miniatura', e));
    extractPdfText(item, pdf, pages);
    return item;
  } catch (e) {
    t.close();
    throw e;
  }
}

// Saca el texto de cada página para la búsqueda (en segundo plano).
async function extractPdfText(item, pdf, pages) {
  let total = 0, batch = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const text = await pdfPageText(pdf, pages[i].bg.page);
      total += text.length;
      batch.push({ docId: item.id, pageId: pages[i].id, source: 'pdf', text });
      if (batch.length >= 25) { await setTexts(batch); batch = []; }
    }
    if (batch.length) await setTexts(batch);
    if (total < 30 * pages.length) {
      await updateItem(item.id, { scanned: true }, { touch: false });
      toast(`«${item.title}» parece escaneado. Para poder buscar en él, ábrelo y usa «Reconocer texto».`, { duration: 7000 });
    }
  } catch (e) { console.warn('Texto del PDF', e); }
}

// Páginas de un PDF para insertar dentro de un cuaderno ya abierto.
export async function pdfPagesForDoc(file, docId) {
  const data = await readAsArrayBuffer(file);
  const pdf = await openPdfData(data);
  const sizes = await pdfPageSizes(pdf);
  const blobId = await putBlob(data, { name: file.name, type: 'application/pdf' });
  const pages = sizes.map((s, i) => newPage(docId, { w: s.w, h: s.h, bg: { type: 'pdf', blobId, page: i + 1, color: '#ffffff' } }));
  (async () => {
    const entries = [];
    for (let i = 0; i < pages.length; i++) entries.push({ docId, pageId: pages[i].id, source: 'pdf', text: await pdfPageText(pdf, i + 1) });
    await setTexts(entries);
  })().catch(e => console.warn(e));
  return pages;
}

// ---------- Imágenes ----------
export async function importImage(file, ctx = {}) {
  const blobId = await putBlob(file, { name: file.name, type: file.type });
  const url = await getBlobURL(blobId);
  const img = await loadImage(url);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const W = iw >= ih ? 1123 : 794;
  const H = Math.round(Math.max(300, Math.min(4000, (W * ih) / iw)));
  const item = await createItem({
    kind: 'notebook', title: baseName(file.name), folderId: ctx.folderId || null, projectId: ctx.projectId || null,
    paper: 'blank', paperColor: '#ffffff', fromImage: true,
  });
  const page = newPage(item.id, { w: W, h: H, paper: 'blank', paperColor: '#ffffff' });
  const im = { id: uid(), blobId, x: 0, y: 0, w: W, h: Math.round((W * ih) / iw), name: file.name };
  page.images.push(im);
  await savePages([page]);
  item.pageIds = [page.id];
  try { item.thumb = await makeThumb(page); } catch { /* nada */ }
  await saveItem(item);
  if (state.settings.autoOcr) ocrImageToIndex(item.id, page.id, im.id, url, file.name);
  return item;
}

export function ocrImageToIndex(docId, pageId, imageId, source, name = 'la imagen') {
  const t = toast(`Leyendo el texto de ${name}…`, { duration: 0 });
  return ocr(source, (msg, p) => t.update(`${msg} ${p ? Math.round(p * 100) + '%' : ''}`))
    .then(async text => {
      await setText(docId, pageId, 'img:' + imageId, text);
      t.close();
      if (text) toast(`Texto reconocido en ${name}: ya se puede buscar.`);
    })
    .catch(e => { t.close(); console.warn('OCR', e); toast('No se pudo leer el texto de la imagen: ' + e.message, { type: 'error' }); });
}

// ---------- Otros archivos ----------
export async function importOther(file, ctx = {}) {
  const data = await readAsArrayBuffer(file);
  const blobId = await putBlob(data, { name: file.name, type: file.type });
  const item = await createItem({
    kind: 'file', title: baseName(file.name) || file.name, blobId, fileName: file.name, mime: file.type, size: data.byteLength,
    folderId: ctx.folderId || null, projectId: ctx.projectId || null,
  });
  extractFileText(item, file, data).catch(e => console.warn('Texto del archivo', e));
  return item;
}

async function extractFileText(item, file, data) {
  const e = ext(file.name);
  let text = '';
  if (TEXT_EXT.includes(e) || (file.type || '').startsWith('text/')) {
    if (data.byteLength < 8e6) text = new TextDecoder('utf-8').decode(data);
    if (e === 'html' || e === 'htm') { const d = document.createElement('div'); d.innerHTML = text; text = d.textContent; }
    if (e === 'rtf') text = text.replace(/\\[a-z]+-?\d* ?|[{}]/g, ' ');
  } else if (e === 'docx') {
    const m = await loadMammoth();
    text = (await m.extractRawText({ arrayBuffer: data.slice(0) })).value;
  }
  if (text) await setText(item.id, null, 'file', text.slice(0, 2e6));
}
