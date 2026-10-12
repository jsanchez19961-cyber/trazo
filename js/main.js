// Arranque y navegación de Trazo.
import { loadAll, state, on } from './store.js';
import { showLibrary, hideLibrary } from './library.js';
import { showEditor, rememberLibrary } from './editorui.js';
import { showFileViewer } from './fileviewer.js';
import { applyTheme } from './settings.js';
import { toast } from './ui.js';
import { handleAuthRedirect, hasToken, preloadGoogle } from './drive.js';
import { syncEnabled, syncNow, syncSoon, setStatus, isApplying } from './sync.js';

if (!Promise.withResolvers) {
  Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
}

const root = document.getElementById('app');
let current = null;
let lastLib = '#/';

function parse(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const name = decodeURIComponent(parts[0] || '');
  if (!name) return { name: 'inicio' };
  if (name === 'doc') return { name: 'doc', id: parts[1], page: parseInt(parts[2], 10) || 0 };
  if (name === 'buscar') return { name: 'buscar', q: decodeURIComponent(parts.slice(1).join('/')) };
  return { name, id: parts[1] ? decodeURIComponent(parts[1]) : undefined };
}

let chain = Promise.resolve();
function route() {
  const r = parse(location.hash);
  chain = chain.then(() => go(r)).catch(e => { console.error(e); toast('Error: ' + e.message, { type: 'error', duration: 8000 }); });
}

async function go(r) {
  if (r.name === 'doc') {
    if (current && current.docId === r.id) { if (r.page) current.goToPage?.(r.page); return; }
    if (current) { await current.destroy(); current = null; }
    hideLibrary();
    root.innerHTML = '';
    const item = state.items.get(r.id);
    if (item && item.kind === 'file') {
      const destroy = await showFileViewer(root, item, () => { location.hash = lastLib; });
      current = { docId: r.id, destroy: async () => destroy?.() };
    } else {
      current = await showEditor(root, r.id, r.page);
    }
    return;
  }
  lastLib = location.hash || '#/';
  rememberLibrary(lastLib);
  if (current) { await current.destroy(); current = null; root.innerHTML = ''; }
  showLibrary(root, r);
}

function flush() { try { current?.flush?.(); } catch (e) { console.warn(e); } }
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', flush);

window.addEventListener('unhandledrejection', e => {
  const n = e.reason?.name || '';
  if (/Cancel|Abort/i.test(n) || /cancel/i.test(e.reason?.message || '')) return;
  console.error(e.reason);
});

async function boot() {
  try {
    await loadAll();
  } catch (e) {
    root.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'center-msg';
    p.innerHTML = '<h2>No se pudo abrir la base de datos</h2><p></p><p>Si estás en una ventana privada, abre Trazo en una ventana normal.</p>';
    p.querySelector('p').textContent = e.message;
    root.appendChild(p);
    return;
  }
  applyTheme();
  on('settings', ({ key }) => { if (key === 'theme') applyTheme(); });
  const authError = handleAuthRedirect();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Sin modo sin conexión', e));
  }
  startSync(authError);
}

// Sincronización automática con Google Drive (si está activada).
function startSync(authError) {
  if (authError) toast(authError, { type: 'error', duration: 7000 });
  for (const ev of ['items', 'folders', 'projects', 'collections', 'tags', 'texts']) {
    on(ev, d => { if (!isApplying() && !d?.fromSync) syncSoon(); });
  }
  setInterval(() => syncSoon(), 5 * 60000);
  window.addEventListener('online', () => syncSoon());
  if (!syncEnabled()) return;
  preloadGoogle()?.catch(() => {});
  if (hasToken()) syncNow().catch(() => {});
  else setStatus('auth', 'Toca para conectar con Google Drive');
}

boot();
