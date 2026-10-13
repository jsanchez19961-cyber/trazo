// Ajustes, copias de seguridad y almacenamiento.
import { h, fmtDate, fmtSize, saveFile, pickFiles } from './util.js';
import { icon } from './icons.js';
import { state, on, setSetting, liveItems, requestPersistence, deleteItemsForever, PAPERS, PAPER_COLORS, PAGE_SIZES } from './store.js';
import { toast, errorToast, choose, confirmDialog } from './ui.js';
import { AI_MODELS } from './ai.js';
import { driveConfigured, forgetToken } from './drive.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import { getSyncStatus, setStatus } from './sync.js';
import { connectAndSync } from './syncui.js';

export const APP_VERSION = '1.2.0';

function toggle(label, desc, key, after) {
  const input = h('input', { type: 'checkbox', checked: !!state.settings[key] });
  input.addEventListener('change', async () => { await setSetting(key, input.checked); after?.(input.checked); });
  return h('label', { class: 'set-row' }, h('span', { class: 'set-text' }, h('strong', null, label), desc ? h('small', null, desc) : null), h('span', { class: 'switch' }, input, h('span', { class: 'slider' })));
}

function select(label, desc, key, options, after) {
  const sel = h('select', { class: 'input' }, Object.entries(options).map(([k, v]) => h('option', { value: k, selected: String(state.settings[key]) === k }, v)));
  sel.addEventListener('change', async () => { await setSetting(key, sel.value); after?.(sel.value); });
  return h('label', { class: 'set-row' }, h('span', { class: 'set-text' }, h('strong', null, label), desc ? h('small', null, desc) : null), sel);
}

function card(title, iconName, ...kids) {
  return h('section', { class: 'set-card' }, h('h2', null, icon(iconName, 22), title), ...kids);
}

function driveCard() {
  const box = h('div');
  const el = card('Google Drive: sincronización y copia automática', 'cloud', box);
  let unsubs = [];
  const paint = () => {
    if (unsubs.length && !el.isConnected) { unsubs.forEach(f => f()); unsubs = []; return; }
    box.innerHTML = '';
    const s = state.settings;
    const intro = 'Guarda tus notas automáticamente en tu Google Drive, en una carpeta llamada «Trazo», y las lleva a tus otros dispositivos. La app solo puede ver esa carpeta, no el resto de tu Drive.';
    if (!driveConfigured()) {
      box.append(h('p', null, intro),
        h('p', { class: 'muted' }, 'Falta un paso que se hace una sola vez en la web de Google: crear el «ID de cliente». Está explicado en la guía GUIA_PUBLICAR_Y_DRIVE.md.'),
        clientIdField());
      return;
    }
    if (!s.driveEnabled) {
      box.append(h('p', null, intro),
        h('button', { class: 'btn primary', onclick: () => connectAndSync({ consent: true }) }, icon('cloud', 18), 'Conectar con Google Drive'));
    } else {
      const last = s.driveSync?.last;
      box.append(
        h('p', null, h('strong', null, 'Estado: '), getSyncStatus().msg || '—'),
        h('p', null, h('strong', null, 'Última sincronización: '), last ? new Date(last).toLocaleString('es-ES') : 'nunca'),
        h('p', { class: 'muted' }, 'Se sincroniza sola al abrir la app, al cerrar un documento y cada pocos minutos. Google pide confirmar el permiso cada cierto tiempo: si arriba ves «Conectar Drive», tócalo.'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary', onclick: () => connectAndSync() }, icon('refresh', 18), 'Sincronizar ahora'),
          h('button', { class: 'btn ghost', onclick: async () => {
            if (!(await confirmDialog('Este dispositivo dejará de sincronizarse con Google Drive. No se borra nada, ni aquí ni en Drive.', { title: 'Desconectar Google Drive', ok: 'Desconectar' }))) return;
            forgetToken();
            setStatus('off');
            await setSetting('driveEnabled', false);
          } }, 'Desconectar')));
    }
    if (s.googleClientId) box.appendChild(clientIdField());
  };
  paint();
  unsubs.push(on('sync', paint));
  return el;
}

function clientIdField() {
  const inp = h('input', { class: 'input', placeholder: '…apps.googleusercontent.com', autocomplete: 'off' });
  inp.value = state.settings.googleClientId || '';
  return h('details', { class: 'set-details' }, h('summary', null, 'ID de cliente de Google (avanzado)'),
    h('p', { class: 'muted small' }, GOOGLE_CLIENT_ID ? 'La app ya trae uno configurado. Solo cámbialo si sabes lo que haces.' : 'Pega aquí el ID de cliente si todavía no está incluido en la app.'),
    inp,
    h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: async () => { await setSetting('googleClientId', inp.value.trim()); toast('Guardado'); } }, 'Guardar'));
}

export function renderSettings(c) {
  const s = state.settings;
  const wrap = h('div', { class: 'settings' });

  wrap.appendChild(driveCard());

  wrap.appendChild(card('Copias de seguridad manuales', 'archive',
    h('p', { class: 'muted' }, s.driveEnabled
      ? 'Con Google Drive activado ya tienes copia automática. Esta copia en un solo archivo .zip es un respaldo extra que puedes guardar donde quieras.'
      : 'Tus notas se guardan en este dispositivo. Haz copias a menudo (o activa Google Drive arriba). La copia también sirve para pasar notas a otro dispositivo.'),
    h('p', null, h('strong', null, 'Última copia: '), s.lastBackup ? new Date(s.lastBackup).toLocaleString('es-ES') + ` (${fmtDate(s.lastBackup)})` : 'nunca'),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn' + (s.driveEnabled ? '' : ' primary'), onclick: () => backupFlow() }, icon('download', 18), 'Hacer copia completa'),
      h('button', { class: 'btn', onclick: async () => { const f = await pickFiles({ accept: '.zip,application/zip', multiple: false }); if (f[0]) restoreFlow(f[0]); } }, icon('upload', 18), 'Restaurar una copia')),
    s.driveEnabled ? null : select('Recordarme hacer copia', null, 'backupDays', { 1: 'Cada día', 3: 'Cada 3 días', 7: 'Cada semana', 14: 'Cada 2 semanas', 30: 'Cada mes' }, v => setSetting('backupDays', Number(v)))));

  wrap.appendChild(card('Escritura', 'pen',
    toggle('Dibujar con el dedo', 'Si está apagado, con un dedo te desplazas y con dos haces zoom; solo el lápiz escribe (recomendado si usas lápiz).', 'fingerDraw'),
    toggle('Deshacer con dos dedos', 'Un toque con dos dedos deshace; con tres, rehace.', 'twoFingerUndo'),
    select('Papel por defecto', null, 'defaultPaper', PAPERS),
    select('Color de papel por defecto', null, 'defaultPaperColor', PAPER_COLORS),
    select('Tamaño de página por defecto', null, 'defaultSize', Object.fromEntries(Object.entries(PAGE_SIZES).map(([k, v]) => [k, v.name])))));

  wrap.appendChild(card('Apariencia', 'dark',
    select('Tema', null, 'theme', { system: 'Como el sistema', light: 'Claro', dark: 'Oscuro' }, v => applyTheme(v))));

  wrap.appendChild(card('Búsqueda y reconocimiento de texto', 'scan',
    toggle('Leer el texto de las imágenes al importarlas (OCR)', 'Se hace en el propio dispositivo y es gratis. La primera vez descarga unos 15 MB de datos del idioma.', 'autoOcr'),
    h('p', { class: 'muted' }, 'El texto de los PDF se indexa solo. En PDF escaneados, usa «Reconocer texto» desde el menú del documento (⋯ › Texto y transcripción).')));

  // Almacenamiento
  const storage = h('div', null, h('p', { class: 'muted' }, 'Calculando…'));
  wrap.appendChild(card('Almacenamiento', 'folder', storage));
  fillStorage(storage);

  wrap.appendChild(card('Usar en la tablet', 'finger',
    h('p', null, 'Para tenerla como una app y que el navegador no borre tus datos:'),
    h('ul', { class: 'steps' },
      h('li', null, h('strong', null, 'iPad (Safari): '), 'botón Compartir › «Añadir a pantalla de inicio».'),
      h('li', null, h('strong', null, 'Android (Chrome): '), 'menú ⋮ › «Instalar aplicación» o «Añadir a pantalla de inicio».')),
    h('p', { class: 'muted' }, 'Gestos: un dedo desplaza, dos dedos hacen zoom, toque con dos dedos deshace. El botón lateral del lápiz (si lo tiene) borra. Mantén quieto el lápiz al terminar un trazo para convertirlo en línea, rectángulo, elipse o triángulo.')));

  // IA
  const key = h('input', { class: 'input', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off' });
  key.value = s.aiKey || '';
  const model = h('select', { class: 'input' }, AI_MODELS.map(m => h('option', { value: m.id, selected: (s.aiModel || 'claude-opus-5-5') === m.id }, `${m.name} · ${m.price}`)));
  model.addEventListener('change', () => setSetting('aiModel', model.value));
  const status = h('span', { class: 'muted' });
  const aiCard = card('Transcripción con IA (de pago, desactivada)', 'sparkle',
    h('p', { class: 'muted' }, 'Convierte tus páginas manuscritas en texto para poder buscarlas, usando Claude de Anthropic. Necesita tu propia clave de API y se paga por uso en tu cuenta de Anthropic. Está apagado mientras no pongas una clave. La clave se guarda solo en este navegador y no entra en las copias de seguridad. Al usarlo, la imagen de la página se envía a Anthropic.'),
    h('label', { class: 'field-label' }, 'Clave de API de Anthropic'), key,
    h('label', { class: 'field-label' }, 'Modelo'), model,
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn', onclick: async () => { await setSetting('aiKey', key.value.trim()); toast(key.value.trim() ? 'Clave guardada' : 'Clave borrada: IA apagada'); } }, 'Guardar clave'),
      h('button', { class: 'btn ghost', onclick: async () => {
        await setSetting('aiKey', key.value.trim());
        status.textContent = 'Probando…';
        try { const { testKey } = await import('./ai.js'); await testKey(); status.textContent = 'Funciona.'; } catch (e) { status.textContent = e.message; }
      } }, 'Probar'),
      status));
  wrap.appendChild(h('details', { class: 'set-details' }, h('summary', null, 'Opciones avanzadas'), aiCard));


  wrap.appendChild(h('p', { class: 'muted center small' }, `Trazo ${APP_VERSION} · tus datos solo salen de este dispositivo si exportas una copia o activas Google Drive.`));
  c.appendChild(wrap);
}

async function fillStorage(el) {
  let est = null, persisted = false;
  try { est = await navigator.storage?.estimate?.(); persisted = await navigator.storage?.persisted?.(); } catch { /* nada */ }
  const trash = [...state.items.values()].filter(i => i.trashed);
  el.innerHTML = '';
  const n = liveItems().length;
  el.append(...[
    h('p', null, (n === 1 ? '1 documento' : `${n} documentos`) + (est ? ` · ocupan unos ${fmtSize(est.usage)}` + (est.quota ? ` de ${fmtSize(est.quota)} disponibles` : '') : '')),
    h('p', null, h('strong', null, 'Protección contra borrado del navegador: '), persisted ? 'activada' : 'no activada',
      persisted ? null : h('button', { class: 'btn sm', style: { marginLeft: '8px' }, onclick: async () => { const ok = await requestPersistence(); toast(ok ? 'Activada' : 'El navegador no la ha concedido. Instala la app en la pantalla de inicio y haz copias.'); fillStorage(el); } }, 'Activar')),
    trash.length ? h('button', { class: 'btn danger sm', onclick: async () => {
      if (await confirmDialog(`Se borrarán definitivamente ${trash.length} documentos de la papelera.`, { title: 'Vaciar papelera', ok: 'Vaciar', danger: true })) { await deleteItemsForever(trash.map(i => i.id)); fillStorage(el); }
    } }, icon('trash', 18), `Vaciar papelera (${trash.length})`) : null,
  ].filter(Boolean));
}

export function applyTheme(v = state.settings.theme) {
  const root = document.documentElement;
  if (v === 'light' || v === 'dark') root.dataset.theme = v;
  else delete root.dataset.theme;
}

export async function backupFlow() {
  const t = toast('Preparando la copia de seguridad…', { duration: 0 });
  try {
    const { exportBackup } = await import('./backup.js');
    const blob = await exportBackup({ onProgress: (i, n) => t.update(`Preparando la copia… ${i}/${n} archivos`) });
    t.close();
    const d = new Date();
    const name = `Trazo-copia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
    await saveFile(blob, name);
    toast(`Copia creada (${fmtSize(blob.size)}). Guárdala en Drive o en el ordenador.`, { duration: 6000 });
  } catch (e) { t.close(); errorToast(e); }
}

export async function restoreFlow(file) {
  try {
    const { readBackup, restoreBackup } = await import('./backup.js');
    const t0 = toast('Leyendo la copia…', { duration: 0 });
    const bk = await readBackup(file);
    t0.close();
    const n = bk.data.items.length;
    const when = new Date(bk.data.created).toLocaleString('es-ES');
    const mode = await choose('Restaurar copia', [
      { label: 'Añadir a lo que ya tengo', value: 'merge', icon: 'plus', desc: 'Recomendado. Añade lo que falta y actualiza lo que sea más reciente en la copia. No borra nada.' },
      { label: 'Reemplazar todo', value: 'replace', icon: 'restore', desc: 'Borra todo lo de este dispositivo y deja solo lo de la copia.' },
    ], { message: `La copia es del ${when} y tiene ${n} documentos.` });
    if (!mode) return;
    if (mode === 'replace' && !(await confirmDialog('Se borrará TODO lo que hay ahora en este dispositivo y se sustituirá por la copia. ¿Seguro?', { title: 'Reemplazar todo', ok: 'Reemplazar', danger: true }))) return;
    const t = toast('Restaurando…', { duration: 0 });
    const r = await restoreBackup(bk, mode, (i, m) => t.update(`Restaurando… ${i}/${m}`));
    t.close();
    toast(`Restaurado: ${r.added} documentos` + (r.skipped ? ` (${r.skipped} ya estaban al día)` : ''), { duration: 6000 });
  } catch (e) { errorToast(e); }
}
