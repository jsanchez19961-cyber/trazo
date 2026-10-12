// Conexión con Google Drive: permiso de Google (OAuth) y operaciones con archivos.
// Permiso «drive.file»: la app solo ve los archivos que ella misma crea, nada más de tu Drive.
import { GOOGLE_CLIENT_ID } from './config.js';
import { state } from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'trazo.driveToken';
const OAUTH_KEY = 'trazo.oauthState';

export class NeedAuth extends Error {
  constructor() { super('Hay que volver a conectar con Google Drive.'); this.name = 'NeedAuth'; }
}

export const clientId = () => String(state.settings.googleClientId || GOOGLE_CLIENT_ID || '').trim();
export const driveConfigured = () => !!clientId();

// ---------- Permiso (token) ----------
let mem = null;
function readToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.exp > Date.now() + 60000) return t;
  } catch { /* nada */ }
  return null;
}
function saveToken(tok, expiresIn) {
  mem = { tok, exp: Date.now() + Number(expiresIn || 3600) * 1000 };
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(mem)); } catch { /* nada */ }
}
export function forgetToken() {
  mem = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* nada */ }
}
export function hasToken() {
  if (!mem || mem.exp <= Date.now() + 60000) mem = readToken();
  return !!mem;
}
function token() {
  if (!hasToken()) throw new NeedAuth();
  return mem.tok;
}

const isIosStandalone = () => window.navigator.standalone === true;

let gisP = null;
export function preloadGoogle() {
  if (!gisP && driveConfigured() && !isIosStandalone()) {
    gisP = new Promise((res, rej) => {
      if (window.google?.accounts?.oauth2) { res(window.google); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => res(window.google);
      s.onerror = () => { gisP = null; rej(new Error('No se pudo contactar con Google. ¿Hay conexión?')); };
      document.head.appendChild(s);
    });
  }
  return gisP;
}

// Debe llamarse desde un toque del usuario (Google abre una ventana).
export async function connect({ consent = false } = {}) {
  if (!driveConfigured()) throw new Error('Falta el «ID de cliente» de Google (ver la guía de Drive).');
  if (isIosStandalone()) { redirectAuth(consent); return new Promise(() => {}); }
  const google = await preloadGoogle();
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: r => {
        if (r.error) rej(new Error('Google no ha dado permiso: ' + (r.error_description || r.error)));
        else { saveToken(r.access_token, r.expires_in); res(true); }
      },
      error_callback: e => rej(new Error(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google sin terminar.' : 'No se pudo abrir la ventana de Google. Permite las ventanas emergentes para esta página.')),
    });
    tc.requestAccessToken({ prompt: consent ? 'consent' : '' });
  });
}

// En el iPad, con la app instalada, Google se abre en la misma ventana y vuelve aquí.
function redirectAuth(consent) {
  const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem(OAUTH_KEY, JSON.stringify({ st, back: location.hash || '#/' })); } catch { /* nada */ }
  const p = new URLSearchParams({
    client_id: clientId(), redirect_uri: location.origin + location.pathname, response_type: 'token',
    scope: SCOPE, include_granted_scopes: 'true', state: st,
  });
  if (consent) p.set('prompt', 'consent');
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

// Al arrancar: recoge el permiso si venimos de la página de Google. Devuelve un mensaje de error o null.
export function handleAuthRedirect() {
  const h = location.hash || '';
  if (!/access_token=|error=/.test(h) || /^#\//.test(h)) return null;
  const p = new URLSearchParams(h.slice(1));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OAUTH_KEY) || 'null'); localStorage.removeItem(OAUTH_KEY); } catch { /* nada */ }
  const back = saved?.back || '#/';
  history.replaceState(null, '', location.pathname + back);
  if (p.get('error')) return 'Google no ha dado permiso: ' + p.get('error');
  if (!saved || saved.st !== p.get('state')) return 'La respuesta de Google no coincide. Vuelve a conectar.';
  saveToken(p.get('access_token'), p.get('expires_in'));
  return null;
}

// ---------- Llamadas a Drive ----------
async function call(url, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token(), ...headers }, body });
  if (res.status === 401) { forgetToken(); throw new NeedAuth(); }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error?.message || ''; } catch { /* nada */ }
    if (res.status === 403 && /quota|storage/i.test(msg)) throw new Error('Tu Google Drive está lleno.');
    throw new Error(`Google Drive respondió ${res.status}${msg ? ': ' + msg : ''}`);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const qs = o => new URLSearchParams(o).toString();
const FIELDS = 'id,name,mimeType,size,modifiedTime,appProperties';

export const drive = {
  async findFolder(name) {
    const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
    const r = await call(`${API}/files?${qs({ q, fields: 'files(id,name)', spaces: 'drive' })}`);
    return r.files[0]?.id || null;
  },
  async createFolder(name) {
    const r = await call(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', description: 'Datos de la app Trazo. No los cambies a mano.' }),
    });
    return r.id;
  },
  async folderExists(id) {
    try { const r = await call(`${API}/files/${id}?fields=id,trashed`); return !r.trashed; } catch (e) { if (e instanceof NeedAuth) throw e; return false; }
  },
  async list(folderId) {
    const out = [];
    let pageToken = '';
    do {
      const r = await call(`${API}/files?${qs({ q: `'${folderId}' in parents and trashed=false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: 1000, ...(pageToken ? { pageToken } : {}) })}`);
      out.push(...r.files);
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return out;
  },
  async download(fileId) {
    const res = await call(`${API}/files/${fileId}?alt=media`, { raw: true });
    return res.arrayBuffer();
  },
  async remove(fileId) {
    await call(`${API}/files/${fileId}`, { method: 'DELETE' });
  },
  // Crea (sin fileId) o reemplaza (con fileId) un archivo.
  async upload({ fileId, name, mimeType, parent, appProperties, data }) {
    const meta = { name, mimeType, appProperties };
    if (!fileId && parent) meta.parents = [parent];
    const base = `${UPLOAD}/files${fileId ? '/' + fileId : ''}`;
    const method = fileId ? 'PATCH' : 'POST';
    if (data.size < 4.5 * 1024 * 1024) {
      const b = 'trazo' + Math.random().toString(36).slice(2);
      const body = new Blob([
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        data, `\r\n--${b}--`,
      ]);
      return call(`${base}?uploadType=multipart&fields=${FIELDS}`, { method, headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    }
    const start = await call(`${base}?uploadType=resumable&fields=${FIELDS}`, {
      method, raw: true,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(data.size) },
      body: JSON.stringify(meta),
    });
    const loc = start.headers.get('Location');
    if (!loc) throw new Error('Google Drive no permitió subir un archivo grande desde el navegador.');
    const res = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: data });
    if (!res.ok) throw new Error('Fallo al subir un archivo grande a Drive (' + res.status + ').');
    return res.json();
  },
};
