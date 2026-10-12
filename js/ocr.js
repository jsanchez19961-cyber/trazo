// Reconocimiento de texto en imágenes (OCR) con Tesseract, en el propio dispositivo.
// La primera vez descarga los datos de idioma (unos 15 MB); después quedan guardados.
import { loadTesseract } from './libs.js';

let workerP = null;
let progressCb = null;
let chain = Promise.resolve();

async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      const T = await loadTesseract();
      return T.createWorker(['spa', 'eng'], 1, {
        logger: m => progressCb?.(m),
        errorHandler: e => console.warn('OCR', e),
      });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

const LABELS = {
  'loading tesseract core': 'Preparando el reconocimiento…',
  'initializing tesseract': 'Preparando el reconocimiento…',
  'loading language traineddata': 'Descargando idioma (solo la primera vez)…',
  'initializing api': 'Preparando…',
  'recognizing text': 'Reconociendo texto…',
};

// source: canvas, Blob o URL. onProgress(texto, 0-1)
export function ocr(source, onProgress) {
  const job = chain.then(async () => {
    progressCb = m => onProgress?.(LABELS[m.status] || m.status, m.progress || 0);
    const w = await getWorker();
    const { data } = await w.recognize(source);
    progressCb = null;
    return (data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  });
  chain = job.catch(() => {});
  return job;
}
