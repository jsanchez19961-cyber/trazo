// Permite abrir Trazo sin conexión. Los archivos propios se piden primero a la red
// (para recibir siempre la última versión) y las librerías externas se guardan en caché.
const VERSION = 'trazo-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg',
  'js/main.js', 'js/util.js', 'js/db.js', 'js/store.js', 'js/ink.js', 'js/libs.js', 'js/pdfdoc.js', 'js/paper.js',
  'js/pageview.js', 'js/render.js', 'js/tools.js', 'js/editor.js', 'js/icons.js', 'js/ui.js', 'js/search.js',
  'js/ocr.js', 'js/importer.js', 'js/exporter.js', 'js/backup.js', 'js/audio.js', 'js/ai.js', 'js/library.js',
  'js/settings.js', 'js/editorui.js', 'js/fileviewer.js', 'js/config.js', 'js/drive.js', 'js/sync.js', 'js/syncui.js',
];
const CDN = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'trazo-libs').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.open('trazo-libs').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
