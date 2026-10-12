// Lectura de PDF con pdf.js: abrir, dibujar páginas y sacar el texto.
import { loadPdfjs } from './libs.js';
import { getBlobRecord } from './store.js';

const docs = new Map();
export const PDF_SCALE = 96 / 72; // 1 punto PDF = 1,333 px de pantalla

export async function openPdfData(data) {
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(data instanceof ArrayBuffer ? data.slice(0) : data);
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: false }).promise;
}

export function getPdf(blobId) {
  if (!docs.has(blobId)) {
    const p = (async () => {
      const rec = await getBlobRecord(blobId);
      if (!rec) throw new Error('No se encuentra el PDF original');
      return openPdfData(rec.data);
    })();
    p.catch(() => docs.delete(blobId));
    docs.set(blobId, p);
  }
  return docs.get(blobId);
}

export async function closePdf(blobId) {
  const p = docs.get(blobId);
  docs.delete(blobId);
  if (p) try { (await p).destroy(); } catch { /* nada */ }
}

// Cola para no dibujar demasiadas páginas a la vez.
let running = 0;
const queue = [];
function schedule(fn) {
  return new Promise((res, rej) => {
    queue.push({ fn, res, rej });
    pump();
  });
}
function pump() {
  while (running < 2 && queue.length) {
    const { fn, res, rej } = queue.shift();
    running++;
    fn().then(res, rej).finally(() => { running--; pump(); });
  }
}

// Dibuja la página en el canvas. `token.cancelled = true` la cancela.
// intent 'print': no depende de que la pantalla se esté pintando (miniaturas, OCR, exportar).
export function renderPdfPage(blobId, pageNum, canvas, scale, token = {}, intent = 'display') {
  return schedule(async () => {
    if (token.cancelled) return false;
    const pdf = await getPdf(blobId);
    const page = await pdf.getPage(pageNum);
    if (token.cancelled) return false;
    const vp = page.getViewport({ scale: PDF_SCALE * scale });
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.floor(vp.width));
    tmp.height = Math.max(1, Math.floor(vp.height));
    const task = page.render({ canvasContext: tmp.getContext('2d'), viewport: vp, background: 'white', intent });
    token.task = task;
    try { await task.promise; } catch (e) { if (token.cancelled) return false; throw e; }
    if (token.cancelled) return false;
    canvas.width = tmp.width;
    canvas.height = tmp.height;
    canvas.getContext('2d').drawImage(tmp, 0, 0);
    return true;
  });
}

export async function pdfPageSizes(pdf) {
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const vp = p.getViewport({ scale: PDF_SCALE });
    out.push({ w: Math.round(vp.width), h: Math.round(vp.height) });
  }
  return out;
}

export async function pdfPageText(pdf, n) {
  const page = await pdf.getPage(n);
  const tc = await page.getTextContent();
  let s = '';
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    s += it.str;
    s += it.hasEOL ? '\n' : (it.str && !it.str.endsWith(' ') ? ' ' : '');
  }
  return s.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
}

// Para exportar con anotaciones: matriz que lleva coordenadas de pantalla a coordenadas PDF.
export async function pdfPageMatrix(blobId, pageNum) {
  const pdf = await getPdf(blobId);
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: PDF_SCALE });
  const [a, b, c, d, e, f] = vp.transform;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
