// Librerías externas, cargadas solo cuando hacen falta y con versión fija.
// La app las guarda en caché (sw.js) para poder usarlas sin conexión.

const CDN = 'https://cdn.jsdelivr.net/npm/';
export const LIB_URLS = {
  pdfjs: CDN + 'pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs',
  pdfjsWorker: CDN + 'pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs',
  pdflib: CDN + 'pdf-lib@1.17.1/dist/pdf-lib.min.js',
  jszip: CDN + 'jszip@3.10.1/dist/jszip.min.js',
  tesseract: CDN + 'tesseract.js@5.1.1/dist/tesseract.min.js',
  mammoth: CDN + 'mammoth@1.8.0/mammoth.browser.min.js',
};

const scripts = new Map();
function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (scripts.has(url)) return scripts.get(url);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url;
    s.crossOrigin = 'anonymous';
    s.onload = () => (window[globalName] ? res(window[globalName]) : rej(new Error('Librería incompleta: ' + globalName)));
    s.onerror = () => { scripts.delete(url); rej(new Error('No se pudo cargar una librería. ¿Hay conexión a internet?')); };
    document.head.appendChild(s);
  });
  scripts.set(url, p);
  return p;
}

let pdfjsP = null;
export function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = import(LIB_URLS.pdfjs).then(m => {
      const lib = m.GlobalWorkerOptions ? m : (m.default || window.pdfjsLib);
      lib.GlobalWorkerOptions.workerSrc = LIB_URLS.pdfjsWorker;
      return lib;
    }).catch(e => { pdfjsP = null; throw new Error('No se pudo cargar el lector de PDF. ¿Hay conexión a internet? (' + e.message + ')'); });
  }
  return pdfjsP;
}

export const loadPdfLib = () => loadScript(LIB_URLS.pdflib, 'PDFLib');
export const loadJSZip = () => loadScript(LIB_URLS.jszip, 'JSZip');
export const loadTesseract = () => loadScript(LIB_URLS.tesseract, 'Tesseract');
export const loadMammoth = () => loadScript(LIB_URLS.mammoth, 'mammoth');
