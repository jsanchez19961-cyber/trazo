// Botón de estado de Google Drive y acciones de conexión.
import { h, fmtDate } from './util.js';
import { icon } from './icons.js';
import { getSyncStatus, syncNow, syncEnabled } from './sync.js';
import { connect, hasToken } from './drive.js';
import { setSetting, state, on } from './store.js';
import { toast, errorToast } from './ui.js';

// Llamar desde un toque: pide permiso a Google si hace falta y sincroniza.
export async function connectAndSync({ consent = false, quiet = false } = {}) {
  try {
    if (!hasToken()) await connect({ consent });
    if (!state.settings.driveEnabled) await setSetting('driveEnabled', true);
    await syncNow();
    if (!quiet) toast('Google Drive: ' + getSyncStatus().msg);
    return true;
  } catch (e) {
    if (e.name !== 'NeedAuth') errorToast(e);
    return false;
  }
}

const LOOK = {
  syncing: ['refresh', 'Sincronizando…', 'spin'],
  ok: ['cloudOk', 'Drive al día', ''],
  auth: ['cloudOff', 'Conectar Drive', 'warn'],
  error: ['cloudOff', 'Error de Drive', 'err'],
  off: ['cloud', 'Drive', ''],
};

export function syncChip(unsubs) {
  const btn = h('button', { class: 'sync-chip', onclick: () => { if (getSyncStatus().state !== 'syncing') connectAndSync(); } });
  const render = () => {
    if (!syncEnabled()) { btn.classList.add('hidden'); return; }
    const s = getSyncStatus();
    const [ic, label, cls] = LOOK[s.state] || LOOK.off;
    btn.className = 'sync-chip ' + cls;
    const last = state.settings.driveSync?.last;
    btn.title = [s.msg, last ? 'Última sincronización: ' + fmtDate(last) : ''].filter(Boolean).join(' · ');
    btn.setAttribute('aria-label', label);
    btn.replaceChildren(icon(ic, 18), h('span', { class: 'sync-label' }, label));
  };
  render();
  unsubs?.push(on('sync', render), on('settings', render));
  return btn;
}
