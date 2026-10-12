// Pantalla del editor: barra de herramientas, paneles y menús.
import { h, debounce, clamp, pickFiles, saveFile, safeFileName, fmtDate, fmtDuration, uid, esc } from './util.js';
import { icon } from './icons.js';
import { Editor } from './editor.js';
import { state, getPages, updateItem, saveItem, setSetting, getDocTexts, setText, putBlob, getBlobURL, PAPERS, PAPER_COLORS } from './store.js';
import {
  toast, errorToast, modal, menu, popover, closePopover, promptDialog, confirmDialog, colorGrid, SWATCHES, HL_SWATCHES,
  pickFolder, pickTags, highlight,
} from './ui.js';
import { renderPageCanvas } from './render.js';
import { searchInDoc, searchTerms, sourceLabel } from './search.js';
import { ocrImageToIndex, pdfPagesForDoc } from './importer.js';
import { renameItem, pickProject, exportItemPdf, exportItemsCopy } from './library.js';
import { aiEnabled } from './ai.js';
import { Recorder, recordSupported, speechSupported } from './audio.js';
import { closePdf } from './pdfdoc.js';
import { setOpenDoc, syncSoon } from './sync.js';

const TOOLS = [
  ['pen', 'pen', 'Pluma (P)'], ['hl', 'hl', 'Subrayador (H)'], ['eraser', 'eraser', 'Borrador (E)'], ['lasso', 'lasso', 'Lazo: seleccionar y mover (L)'],
  ['text', 'text', 'Texto (T)'], ['shape', 'shape', 'Formas (S)'], ['hand', 'hand', 'Mano: desplazar (M)'],
];
const SIZES = { pen: [1.2, 2.4, 4.5], hl: [10, 18, 28], eraser: [8, 16, 32], shape: [1.5, 2.5, 5], text: [14, 18, 26] };
const SHAPES = [['line', 'line', 'Línea'], ['arrow', 'arrow', 'Flecha'], ['rect', 'rect', 'Rectángulo'], ['ellipse', 'ellipse', 'Elipse'], ['triangle', 'triangle', 'Triángulo'], ['diamond', 'diamond', 'Rombo']];

let E = null;

export async function showEditor(root, docId, pageNum) {
  const item = state.items.get(docId);
  root.innerHTML = '';
  if (!item) {
    root.appendChild(h('div', { class: 'center-msg' }, h('p', null, 'Este documento no existe.'), h('a', { class: 'btn', href: '#/' }, 'Volver')));
    return null;
  }
  if (item.trashed) {
    root.appendChild(h('div', { class: 'center-msg' }, h('p', null, 'Este documento está en la papelera.'), h('a', { class: 'btn', href: '#/papelera' }, 'Ir a la papelera')));
    return null;
  }
  item.opened = Date.now();
  saveItem(item, { silent: true, norev: true });
  const pages = await getPages(docId);
  if (!pages.length) {
    root.appendChild(h('div', { class: 'center-msg' }, h('p', null, 'Este documento no tiene páginas.')));
    return null;
  }
  E = { item, panel: null, side: null, recorder: null };
  setOpenDoc(docId);
  build(root);
  E.ed = new Editor(E.stageHost, item, pages, hooks());
  E.ed.start(Math.max(0, (pageNum || 1) - 1));
  renderTools();
  updateStatus();
  updateHistory();
  document.title = item.title + ' · Trazo';
  return {
    docId,
    goToPage: n => E?.ed.goToPage(Math.max(0, (n || 1) - 1)),
    destroy: async () => {
      const cur = E;
      E = null;
      closePopover();
      if (cur.recorder) { try { await stopRecording(cur); } catch { /* nada */ } }
      await cur.ed.destroy();
      const blobs = new Set(cur.ed.pages.filter(p => p.bg.type === 'pdf').map(p => p.bg.blobId));
      for (const b of blobs) closePdf(b);
      cur.el.remove();
      setOpenDoc(null);
      syncSoon();
    },
    flush: () => E?.ed.flush(),
  };
}

function hooks() {
  return {
    onView: () => scheduleStatus(),
    onHistory: () => updateHistory(),
    onDirty: d => { E?.saveDot.classList.toggle('dirty', d); },
    onSelection: on => { if (on) renderSelBar(); },
    onTextEdit: on => renderFormat(on),
    onTool: () => renderTools(),
    onPages: () => { updateStatus(); if (E?.panel === 'pages') renderPagesPanel(); },
    onError: msg => toast(msg, { type: 'error', duration: 6000 }),
    onClipboard: () => toast('Copiado. Usa «Pegar» del menú ⋯ o Ctrl+V.'),
    onImagesAdded: (page, imgs) => {
      if (!state.settings.autoOcr) return;
      for (const im of imgs) getBlobURL(im.blobId).then(u => ocrImageToIndex(E.item.id, page.id, im.id, u, im.name || 'la imagen'));
    },
  };
}

// ================= Estructura =================
function build(root) {
  const it = E.item;
  E.titleBtn = h('button', { class: 'ed-title', onclick: () => renameItem(it).then(() => { E.titleBtn.textContent = it.title; document.title = it.title + ' · Trazo'; }) }, it.title);
  E.saveDot = h('span', { class: 'save-dot', title: 'Guardado automático' });
  E.undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Deshacer', title: 'Deshacer (Ctrl+Z)', onclick: () => E.ed.undo() }, icon('undo'));
  E.redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Rehacer', title: 'Rehacer (Ctrl+Y)', onclick: () => E.ed.redo() }, icon('redo'));
  const top = h('header', { class: 'ed-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver a la biblioteca', onclick: () => goBack() }, icon('back')),
    E.titleBtn, E.saveDot,
    h('span', { class: 'grow' }),
    E.undoBtn, E.redoBtn,
    h('span', { class: 'sep' }),
    h('button', { class: 'icon-btn', 'aria-label': 'Buscar en el documento', title: 'Buscar en el documento', onclick: () => toggleSide('search') }, icon('search')),
    it.kind !== 'board' ? h('button', { class: 'icon-btn', 'aria-label': 'Páginas', title: 'Páginas', onclick: () => togglePanel('pages') }, icon('pages')) : null,
    h('button', { class: 'icon-btn', 'aria-label': 'Más opciones', onclick: e => moreMenu(e.currentTarget) }, icon('more')));
  E.tools = h('div', { class: 'ed-tools', role: 'toolbar' });
  E.format = h('div', { class: 'ed-tools ed-format hidden' });
  E.pagesPanel = h('aside', { class: 'ed-panel left hidden' });
  E.sidePanel = h('aside', { class: 'ed-panel right hidden' });
  E.stageHost = h('div', { class: 'ed-stage-host' });
  E.status = h('div', { class: 'ed-status' });
  E.recBar = h('div', { class: 'rec-bar hidden' });
  E.el = h('div', { class: 'editor' }, top, E.tools, E.format, h('div', { class: 'ed-body' }, E.pagesPanel, E.stageHost, E.sidePanel), E.status, E.recBar);
  root.appendChild(E.el);
}

let lastLibrary = '#/';
export function rememberLibrary(hash) { lastLibrary = hash; }
function goBack() { location.hash = lastLibrary || '#/'; }

// ================= Barra de herramientas =================
function renderTools() {
  if (!E) return;
  const ed = E.ed, t = ed.toolName;
  const bar = E.tools;
  bar.innerHTML = '';
  const tools = h('div', { class: 'tool-group' });
  for (const [name, ic, label] of TOOLS) {
    tools.appendChild(h('button', {
      class: 'tool' + (t === name ? ' on' : ''), 'aria-label': label, title: label, 'aria-pressed': t === name ? 'true' : 'false',
      onclick: e => {
        if (ed.toolName === name) { toolOptions(name, e.currentTarget); return; }
        ed.setTool(name);
        setSetting('tool', name);
        renderTools();
      },
    }, icon(ic, 24)));
  }
  bar.appendChild(tools);
  const optKey = t === 'hand' || t === 'lasso' ? null : t;
  if (optKey) {
    bar.appendChild(h('span', { class: 'sep' }));
    const o = ed.opts[optKey];
    if (optKey !== 'eraser') {
      const colors = h('div', { class: 'tool-group colors' });
      const list = optKey === 'hl' ? state.settings.hlColors : state.settings.penColors;
      list.forEach((c, i) => {
        colors.appendChild(h('button', {
          class: 'cdot' + (o.color.toLowerCase() === c.toLowerCase() ? ' on' : ''), style: { '--c': c }, 'aria-label': 'Color ' + c,
          onclick: e => {
            if (o.color.toLowerCase() === c.toLowerCase()) { replaceQuickColor(optKey, i, e.currentTarget); return; }
            o.color = c; ed.saveToolOpts(); renderTools();
          },
        }));
      });
      if (!list.some(c => c.toLowerCase() === o.color.toLowerCase())) {
        colors.appendChild(h('button', { class: 'cdot on', style: { '--c': o.color }, 'aria-label': 'Color actual', onclick: e => toolOptions(optKey, e.currentTarget) }));
      }
      bar.appendChild(colors);
    }
    const sizes = h('div', { class: 'tool-group sizes' });
    SIZES[optKey].forEach((s, i) => {
      const on = Math.abs(o.size - s) < 0.01;
      sizes.appendChild(h('button', {
        class: 'sdot' + (on ? ' on' : ''), 'aria-label': 'Grosor ' + (i + 1), title: 'Grosor',
        onclick: e => { if (on) { toolOptions(optKey, e.currentTarget); return; } o.size = s; ed.saveToolOpts(); renderTools(); },
      }, h('span', { style: { width: 6 + i * 5 + 'px', height: 6 + i * 5 + 'px' } })));
    });
    bar.appendChild(sizes);
    if (optKey === 'shape') {
      const k = SHAPES.find(x => x[0] === o.kind) || SHAPES[2];
      bar.appendChild(h('button', { class: 'tool', 'aria-label': 'Tipo de forma', title: 'Tipo de forma', onclick: e => toolOptions('shape', e.currentTarget) }, icon(k[1], 22)));
    }
  } else if (t === 'lasso' && ed.hasClipboard()) {
    bar.appendChild(h('span', { class: 'sep' }));
    bar.appendChild(h('button', { class: 'btn sm ghost', onclick: () => ed.paste() }, icon('paste', 18), 'Pegar'));
  }
  bar.appendChild(h('span', { class: 'grow' }));
  bar.appendChild(h('button', {
    class: 'tool' + (state.settings.fingerDraw ? ' on' : ''), 'aria-label': 'Dibujar con el dedo', title: state.settings.fingerDraw ? 'El dedo dibuja (pulsa para que el dedo desplace)' : 'El dedo desplaza (pulsa para dibujar con el dedo)',
    onclick: async () => { await setSetting('fingerDraw', !state.settings.fingerDraw); toast(state.settings.fingerDraw ? 'Ahora el dedo dibuja. Dos dedos para moverte.' : 'Ahora el dedo desplaza. Solo el lápiz escribe.'); renderTools(); },
  }, icon('finger', 22)));
  bar.appendChild(h('button', { class: 'tool', 'aria-label': 'Insertar imagen', title: 'Insertar imagen', onclick: e => imageMenu(e.currentTarget) }, icon('image', 22)));
  if (recordSupported) bar.appendChild(h('button', { class: 'tool' + (E.recorder ? ' rec' : ''), 'aria-label': 'Grabar audio', title: 'Grabar audio', onclick: () => (E.recorder ? stopRecording(E) : startRecording()) }, icon('mic', 22)));
}

function replaceQuickColor(key, i, anchor) {
  const isHl = key === 'hl';
  const listKey = isHl ? 'hlColors' : 'penColors';
  const p = popover(anchor, h('div', { class: 'pop-pad' }, h('p', { class: 'pop-title' }, 'Cambiar este color'),
    colorGrid(isHl ? HL_SWATCHES : SWATCHES, E.ed.opts[key].color, c => {
      const list = [...state.settings[listKey]];
      list[i] = c;
      setSetting(listKey, list);
      E.ed.opts[key].color = c;
      E.ed.saveToolOpts();
      p.close();
      renderTools();
    })));
}

function slider(label, min, max, step, value, onInput, fmt = v => v) {
  const out = h('span', { class: 'slider-val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { out.textContent = fmt(Number(inp.value)); onInput(Number(inp.value)); });
  return h('label', { class: 'slider-row' }, h('span', null, label), inp, out);
}

function seg(options, current, onPick) {
  return h('div', { class: 'seg' }, options.map(([k, label]) => h('button', { class: k === current ? 'on' : '', onclick: () => onPick(k) }, label)));
}

function toolOptions(name, anchor) {
  const ed = E.ed, o = ed.opts[name];
  const done = () => { ed.saveToolOpts(); renderTools(); };
  const repaint = () => { p.el.firstChild.replaceWith(build()); p.place(); };
  const build = () => {
    const b = h('div', { class: 'pop-pad tool-opts' });
    if (name === 'pen') {
      b.append(h('p', { class: 'pop-title' }, 'Pluma'),
        seg([['0.6', 'Con presión'], ['0.05', 'Grosor fijo']], o.thinning > 0.3 ? '0.6' : '0.05', v => { o.thinning = Number(v); done(); repaint(); }),
        colorGrid(SWATCHES, o.color, c => { o.color = c; done(); repaint(); }),
        slider('Grosor', 0.5, 16, 0.1, o.size, v => { o.size = v; done(); }, v => v.toFixed(1)));
    } else if (name === 'hl') {
      b.append(h('p', { class: 'pop-title' }, 'Subrayador'),
        colorGrid(HL_SWATCHES, o.color, c => { o.color = c; done(); repaint(); }),
        slider('Grosor', 4, 48, 1, o.size, v => { o.size = v; done(); }),
        checkRow('Siempre en línea recta', o.straight, v => { o.straight = v; done(); }),
        h('p', { class: 'muted small' }, 'Truco: mantén quieto el lápiz al final para enderezar la línea.'));
    } else if (name === 'eraser') {
      b.append(h('p', { class: 'pop-title' }, 'Borrador'),
        seg([['stroke', 'Trazo entero'], ['partial', 'Parcial']], o.mode, v => { o.mode = v; done(); repaint(); }),
        checkRow('Borrar solo subrayado', o.hlOnly, v => { o.hlOnly = v; done(); }),
        slider('Tamaño', 4, 60, 1, o.size, v => { o.size = v; done(); }),
        h('button', { class: 'btn danger sm', onclick: () => { p.close(); clearPage(); } }, icon('trash', 18), 'Borrar todo lo de esta página'));
    } else if (name === 'text') {
      b.append(h('p', { class: 'pop-title' }, 'Texto'),
        colorGrid(SWATCHES, o.color, c => { o.color = c; done(); repaint(); }),
        slider('Tamaño', 10, 64, 1, o.size, v => { o.size = v; done(); }),
        h('p', { class: 'muted small' }, 'Toca en la página para escribir. En iPad puedes escribir a mano dentro de la caja y se convierte en texto (Escritura a mano de Apple).'));
    } else if (name === 'shape') {
      b.append(h('p', { class: 'pop-title' }, 'Formas'),
        h('div', { class: 'shape-grid' }, SHAPES.map(([k, ic, label]) => h('button', { class: 'tool' + (o.kind === k ? ' on' : ''), title: label, 'aria-label': label, onclick: () => { o.kind = k; done(); repaint(); } }, icon(ic, 22)))),
        checkRow('Relleno', o.fill, v => { o.fill = v; done(); }),
        colorGrid(SWATCHES, o.color, c => { o.color = c; done(); repaint(); }),
        slider('Grosor', 0.5, 12, 0.5, o.size, v => { o.size = v; done(); }));
    } else if (name === 'lasso') {
      b.append(h('p', { class: 'pop-title' }, 'Lazo'), h('p', { class: 'muted small' }, 'Rodea lo que quieras seleccionar (o tócalo). Después arrástralo para moverlo, usa el círculo de la esquina para cambiar el tamaño, o elige una acción en la barra.'));
    } else if (name === 'hand') {
      b.append(h('p', { class: 'pop-title' }, 'Mano'), h('p', { class: 'muted small' }, 'Con la mano activa, el lápiz y el ratón desplazan la página en vez de escribir.'));
    }
    return b;
  };
  const p = popover(anchor, build(), { className: 'wide-pop' });
}

function checkRow(label, value, onChange) {
  const inp = h('input', { type: 'checkbox', checked: !!value });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'check-row' }, inp, h('span', null, label));
}

async function clearPage() {
  const ed = E.ed, page = ed.currentPage();
  if (!page.strokes.length && !page.texts.length && !page.images.length) return;
  if (!(await confirmDialog('Se borrarán todos los trazos, textos e imágenes de esta página. Se puede deshacer.', { title: 'Borrar la página', ok: 'Borrar', danger: true }))) return;
  ed.change(page.id, p => { p.strokes = []; p.texts = []; p.images = []; });
}

// ================= Formato de texto =================
function renderFormat(on) {
  if (!E) return;
  E.format.classList.toggle('hidden', !on);
  E.tools.classList.toggle('hidden', on);
  if (!on) return;
  const ed = E.ed;
  const f = E.format;
  f.innerHTML = '';
  const keep = e => e.preventDefault();
  const cmd = (c, v) => { document.execCommand(c, false, v); ed.editing?.el.focus({ preventScroll: true }); ed.editing?.place(); };
  const t = ed.editingText();
  const btn = (ic, label, fn, active) => h('button', { class: 'tool' + (active ? ' on' : ''), 'aria-label': label, title: label, onpointerdown: keep, onmousedown: keep, onclick: fn }, icon(ic, 22));
  const sizeLbl = h('span', { class: 'size-lbl' }, Math.round(t?.size || 18));
  const setSize = d => {
    ed.patchEditing(x => ({ size: clamp(Math.round((x.size || 18) + d), 8, 96) }));
    sizeLbl.textContent = Math.round(ed.editingText()?.size || 18);
    ed.opts.text.size = ed.editingText()?.size || ed.opts.text.size;
    ed.saveToolOpts();
  };
  f.append(
    h('div', { class: 'tool-group' },
      btn('minus', 'Letra más pequeña', () => setSize(-2)), sizeLbl, btn('plus', 'Letra más grande', () => setSize(2))),
    h('span', { class: 'sep' }),
    h('div', { class: 'tool-group' },
      btn('bold', 'Negrita', () => cmd('bold')), btn('italic', 'Cursiva', () => cmd('italic')), btn('underline', 'Subrayado', () => cmd('underline')),
      btn('listUl', 'Lista', () => cmd('insertUnorderedList')),
      btn('box', 'Recuadro', () => { ed.patchEditing(x => ({ box: !x.box })); renderFormat(true); }, t?.box)),
    h('span', { class: 'sep' }),
    h('div', { class: 'tool-group colors' }, state.settings.penColors.map(c => h('button', {
      class: 'cdot', style: { '--c': c }, 'aria-label': 'Color ' + c, onpointerdown: keep, onmousedown: keep,
      onclick: () => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && ed.editing?.el.contains(sel.anchorNode)) cmd('foreColor', c);
        else { ed.patchEditing(() => ({ color: c })); ed.opts.text.color = c; ed.saveToolOpts(); }
      },
    }))),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn primary sm', onpointerdown: keep, onmousedown: keep, onclick: () => ed.finishTextEdit() }, 'Listo'),
  );
}

// ================= Barra de selección =================
function renderSelBar() {
  const ed = E.ed, bar = ed.selBar;
  bar.innerHTML = '';
  const b = (ic, label, fn, cls = '') => h('button', { class: 'sel-btn ' + cls, title: label, 'aria-label': label, onclick: fn }, icon(ic, 20), h('span', null, label));
  const hasInk = ed.sel.strokes.size > 0;
  bar.append(
    hasInk ? b('palette', 'Color', e => {
      const p = popover(e.currentTarget, h('div', { class: 'pop-pad' }, colorGrid(SWATCHES, '', c => { ed.recolorSelection(c); p.close(); })));
    }) : null,
    b('copy', 'Copiar', () => ed.copySelection()),
    b('cut', 'Cortar', () => { ed.copySelection(); ed.deleteSelection(); }),
    b('pages', 'Duplicar', () => ed.duplicateSelection()),
    hasInk ? b('sparkle', 'A texto', () => selectionToText()) : null,
    b('trash', 'Borrar', () => ed.deleteSelection(), 'danger'),
  );
  ed.positionSelBar(true);
}

async function selectionToText() {
  const ed = E.ed;
  const sel = ed.sel;
  if (!sel?.box) return;
  const page = ed.pageById.get(sel.pageId);
  const b = sel.box;
  const region = { x1: b.x1 - 6, y1: b.y1 - 6, x2: b.x2 + 6, y2: b.y2 + 6 };
  const onlyInk = { ...page, bg: { type: 'blank', color: '#ffffff' }, infinite: true, images: [], texts: [], strokes: page.strokes.filter(s => sel.strokes.has(s.id)) };
  const t = toast(aiEnabled() ? 'Transcribiendo con IA…' : 'Reconociendo el texto (con letra a mano puede fallar)…', { duration: 0 });
  try {
    const cv = await renderPageCanvas(onlyInk, { scale: 2, region, maxPixels: 4e6 });
    let text;
    if (aiEnabled()) text = await (await import('./ai.js')).transcribe(cv);
    else text = await (await import('./ocr.js')).ocr(cv);
    t.close();
    if (!text) { toast('No se ha reconocido texto.'); return; }
    const choice = await confirmDialog(h('div', null, h('p', null, 'Texto reconocido:'), h('blockquote', { class: 'quote' }, text), h('p', { class: 'muted' }, '¿Sustituir la escritura a mano por este texto? (Se puede deshacer.)')), { title: 'Convertir a texto', ok: 'Sustituir' });
    if (!choice) return;
    const ids = new Set(sel.strokes);
    const size = clamp(Math.round((b.y2 - b.y1) / Math.max(1, text.split('\n').length) * 0.62), 12, 48);
    ed.clearSelection();
    ed.change(page.id, p => {
      p.strokes = p.strokes.filter(s => !ids.has(s.id));
      p.texts.push({ id: uid(), x: b.x1, y: b.y1, w: Math.max(120, b.x2 - b.x1 + 40), html: esc(text).replace(/\n/g, '<br>'), size, color: ed.opts.text.color });
    });
  } catch (e) { t.close(); errorToast(e); }
}

// ================= Estado (página y zoom) =================
const scheduleStatus = (() => { let raf = 0; return () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; updateStatus(); }); }; })();

function updateStatus() {
  if (!E) return;
  const ed = E.ed;
  const z = Math.round(ed.view.z * 100) + '%';
  const s = E.status;
  if (!s.firstChild) {
    E.pageLbl = h('button', { class: 'st-btn', title: 'Ir a página', onclick: () => goToPageDialog() });
    E.zoomLbl = h('button', { class: 'st-btn', title: 'Ajustar al ancho', onclick: () => ed.fitWidth() });
    s.append(
      E.item.kind !== 'board' ? E.pageLbl : null,
      h('button', { class: 'st-btn hide-touch', 'aria-label': 'Alejar', onclick: () => ed.zoomBy(1 / 1.25) }, icon('zoomOut', 18)),
      E.zoomLbl,
      h('button', { class: 'st-btn hide-touch', 'aria-label': 'Acercar', onclick: () => ed.zoomBy(1.25) }, icon('zoomIn', 18)),
    );
  }
  E.pageLbl.textContent = `${ed.currentPageIndex() + 1} / ${ed.pages.length}`;
  E.zoomLbl.textContent = z;
  if (E.panel === 'pages') markCurrentPage();
}

async function goToPageDialog() {
  const v = await promptDialog('Ir a la página', { value: String(E.ed.currentPageIndex() + 1), label: `De 1 a ${E.ed.pages.length}` });
  const n = parseInt(v, 10);
  if (n) E.ed.goToPage(n - 1);
}

function updateHistory() {
  if (!E) return;
  E.undoBtn.disabled = !E.ed.canUndo();
  E.redoBtn.disabled = !E.ed.canRedo();
}

// ================= Panel de páginas =================
function togglePanel(name) {
  E.panel = E.panel === name ? null : name;
  E.pagesPanel.classList.toggle('hidden', E.panel !== 'pages');
  if (E.panel === 'pages') renderPagesPanel();
}

function renderPagesPanel() {
  const ed = E.ed, panel = E.pagesPanel;
  panel.innerHTML = '';
  panel.appendChild(h('div', { class: 'panel-head' }, h('strong', null, `Páginas (${ed.pages.length})`),
    h('button', { class: 'icon-btn', 'aria-label': 'Añadir página', title: 'Añadir página después de la actual', onclick: () => ed.addPage(ed.currentPageIndex()) }, icon('plus')),
    h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => togglePanel('pages') }, icon('close'))));
  const list = h('div', { class: 'page-list' });
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const page = ed.pageById.get(en.target.dataset.id);
      if (!page) continue;
      renderPageCanvas(page, { scale: 150 / page.w, maxPixels: 120000 }).then(cv => {
        cv.className = 'pthumb-cv';
        en.target.querySelector('.pthumb-img').replaceChildren(cv);
      }).catch(() => {});
    }
  }, { root: list });
  ed.pages.forEach((p, i) => {
    const el = h('div', { class: 'pthumb', dataset: { id: p.id, i } },
      h('button', { class: 'pthumb-img', style: { aspectRatio: `${p.w} / ${p.h}` }, onclick: () => ed.goToPage(i), 'aria-label': 'Ir a la página ' + (i + 1) }),
      h('div', { class: 'pthumb-foot' }, h('span', null, i + 1),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Opciones de página', onclick: e => pageMenu(i, e.currentTarget) }, icon('more', 16))));
    list.appendChild(el);
    io.observe(el);
  });
  panel.appendChild(list);
  markCurrentPage();
}

function markCurrentPage() {
  const cur = E.ed.currentPageIndex();
  for (const el of E.pagesPanel.querySelectorAll('.pthumb')) el.classList.toggle('current', Number(el.dataset.i) === cur);
}

function pageMenu(i, anchor) {
  const ed = E.ed, page = ed.pages[i];
  menu(anchor, [
    { label: 'Insertar página en blanco después', icon: 'plus', onClick: () => ed.addPage(i) },
    { label: 'Duplicar página', icon: 'copy', onClick: () => ed.duplicatePage(i) },
    { label: 'Subir', icon: 'upload', disabled: i === 0, onClick: () => ed.movePage(i, -1) },
    { label: 'Bajar', icon: 'download', disabled: i === ed.pages.length - 1, onClick: () => ed.movePage(i, 1) },
    page.bg.type !== 'pdf' ? { label: 'Papel de esta página…', icon: 'notebook', onClick: () => paperDialog(i) } : null,
    { label: 'Exportar como imagen', icon: 'image', onClick: () => exportPng(i) },
    { sep: true },
    { label: 'Eliminar página', icon: 'trash', danger: true, disabled: ed.pages.length <= 1, onClick: () => { ed.deletePage(i); toast('Página eliminada', { action: { label: 'Deshacer', onClick: () => ed.undo() } }); } },
  ]);
}

function paperDialog(i) {
  const ed = E.ed, page = ed.pages[i];
  let type = page.bg.type, color = page.bg.color;
  const body = h('div', { class: 'form' });
  let all = false;
  const paint = () => {
    body.innerHTML = '';
    body.append(h('label', { class: 'field-label' }, 'Papel'),
      h('div', { class: 'chips' }, Object.entries(PAPERS).map(([k, v]) => h('button', { class: 'chip' + (k === type ? ' on' : ''), onclick: () => { type = k; paint(); } }, v))),
      h('label', { class: 'field-label' }, 'Color'),
      h('div', { class: 'chips' }, Object.entries(PAPER_COLORS).map(([k, v]) => h('button', { class: 'chip' + (k === color ? ' on' : ''), onclick: () => { color = k; paint(); } }, v))),
      checkRow('Aplicar a todas las páginas (salvo las de PDF)', all, v => { all = v; }));
  };
  paint();
  modal({
    title: 'Papel', body, actions: [{ label: 'Cancelar', onClick: () => null }, {
      label: 'Aplicar', primary: true, onClick: () => {
        if (all) ed.pages.forEach((p, j) => { if (p.bg.type !== 'pdf') ed.setPageBackground(j, { type, color }); });
        else ed.setPageBackground(i, { type, color });
        if (all) updateItem(E.item.id, { paper: type, paperColor: color }, { silent: true });
      },
    }],
  });
}

// ================= Panel lateral =================
function toggleSide(name) {
  E.side = E.side === name ? null : name;
  E.sidePanel.classList.toggle('hidden', !E.side);
  if (E.side) renderSide();
}

function sideHead(title) {
  return h('div', { class: 'panel-head' }, h('strong', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => toggleSide(E.side) }, icon('close')));
}

function renderSide() {
  const p = E.sidePanel;
  p.innerHTML = '';
  if (E.side === 'search') sideSearch(p);
  else if (E.side === 'text') sideText(p);
  else if (E.side === 'audio') sideAudio(p);
  else if (E.side === 'info') sideInfo(p);
}

function sideSearch(p) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Buscar en este documento', enterkeyhint: 'search' });
  const out = h('div', { class: 'side-results' });
  const run = debounce(async () => {
    const q = input.value.trim();
    out.innerHTML = '';
    if (q.length < 2) return;
    const res = await searchInDoc(E.item.id, q);
    if (!res.length) { out.appendChild(h('p', { class: 'muted' }, 'Sin resultados. Las páginas escritas a mano solo se encuentran si antes se han transcrito.')); return; }
    const terms = searchTerms(q);
    const ids = E.item.pageIds;
    res.sort((a, b) => ids.indexOf(a.pageId) - ids.indexOf(b.pageId));
    for (const r of res) {
      const idx = ids.indexOf(r.pageId);
      out.appendChild(h('button', { class: 'hit', onclick: () => { if (idx >= 0) E.ed.goToPage(idx); else if (r.source.startsWith('audio:')) toggleSide('audio'); } },
        h('span', { class: 'hit-src' }, (idx >= 0 ? `Pág. ${idx + 1} · ` : '') + sourceLabel(r.source)),
        h('span', { class: 'hit-text', html: highlight(r.snippet, [...terms, r.needle]) })));
    }
  }, 250);
  input.addEventListener('input', run);
  p.append(sideHead('Buscar en el documento'), input, out);
  setTimeout(() => input.focus(), 50);
}

async function sideText(p) {
  const ed = E.ed;
  const page = ed.currentPage();
  const idx = ed.currentPageIndex();
  p.append(sideHead(E.item.kind === 'board' ? 'Texto de la pizarra' : `Texto de la página ${idx + 1}`));
  p.appendChild(h('p', { class: 'muted small' }, 'Este texto es el que usa el buscador. Puedes corregirlo.'));
  const actions = h('div', { class: 'col gap' },
    h('button', { class: 'btn sm', onclick: () => ocrPage(page) }, icon('scan', 18), 'Reconocer texto'),
    aiEnabled() ? h('button', { class: 'btn sm primary', onclick: () => aiPage(page) }, icon('sparkle', 18), 'Transcribir con IA') : null,
    E.item.kind !== 'board' && ed.pages.length > 1 ? h('button', { class: 'btn ghost sm', onclick: () => ocrAll() }, icon('scan', 18), 'Reconocer todo el documento') : null);
  p.appendChild(actions);
  const texts = (await getDocTexts(E.item.id)).filter(t => t.pageId === page.id);
  if (!texts.length) p.appendChild(h('p', { class: 'muted' }, 'Esta página no tiene texto todavía.'));
  for (const t of texts) {
    const ta = h('textarea', { class: 'input', rows: Math.min(14, Math.max(3, t.text.split('\n').length + 1)) });
    ta.value = t.text;
    const editable = t.source === 'ocr' || t.source === 'ia' || t.source.startsWith('img:');
    ta.readOnly = !editable;
    if (editable) ta.addEventListener('change', () => setText(t.docId, t.pageId, t.source, ta.value));
    p.append(h('label', { class: 'field-label' }, sourceLabel(t.source) + (editable ? '' : ' (automático)')), ta);
  }
}

async function ocrPage(page, quiet) {
  const t = quiet ? null : toast('Reconociendo texto…', { duration: 0 });
  try {
    const cv = await renderPageCanvas(page, { scale: 2, maxPixels: 12e6 });
    const { ocr } = await import('./ocr.js');
    const text = await ocr(cv, (m, pr) => t?.update(`${m} ${pr ? Math.round(pr * 100) + '%' : ''}`));
    await setText(E.item.id, page.id, 'ocr', text);
    t?.close();
    if (!quiet) toast(text ? 'Texto reconocido: ya se puede buscar.' : 'No se ha encontrado texto.');
    if (E?.side === 'text') renderSide();
    return text;
  } catch (e) { t?.close(); if (!quiet) errorToast(e); throw e; }
}

async function ocrAll() {
  const ed = E.ed;
  if (!(await confirmDialog(`Se reconocerá el texto de ${ed.pages.length} páginas en este dispositivo. Puede tardar varios minutos.`, { title: 'Reconocer todo', ok: 'Empezar' }))) return;
  let stop = false;
  const t = toast('Reconociendo…', { duration: 0, action: { label: 'Parar', onClick: () => { stop = true; } } });
  const pages = ed.pages.slice();
  for (let i = 0; i < pages.length && !stop && E; i++) {
    t.update(`Reconociendo página ${i + 1} de ${pages.length}…`);
    try { await ocrPage(pages[i], true); } catch (e) { console.warn(e); }
  }
  t.close();
  toast(stop ? 'Reconocimiento parado.' : 'Documento reconocido: ya se puede buscar.');
}

async function aiPage(page) {
  if (!aiEnabled()) {
    toast('Para usar la IA pon tu clave de Anthropic en Ajustes (es de pago por uso).', { duration: 6000, action: { label: 'Ajustes', onClick: () => { location.hash = '#/ajustes'; } } });
    return;
  }
  const t = toast('Transcribiendo con IA…', { duration: 0 });
  try {
    const cv = await renderPageCanvas(page, { scale: 1.6, maxPixels: 3.6e6 });
    const { transcribe } = await import('./ai.js');
    const text = await transcribe(cv);
    await setText(E.item.id, page.id, 'ia', text);
    t.close();
    toast(text ? 'Transcripción guardada: ya se puede buscar.' : 'No se ha encontrado texto manuscrito.');
    if (E?.side === 'text') renderSide();
  } catch (e) { t.close(); errorToast(e); }
}

// ----- Audio -----
function sideAudio(p) {
  const it = E.item;
  p.append(sideHead('Audios'));
  p.appendChild(h('button', { class: 'btn ' + (E.recorder ? 'danger' : 'primary'), onclick: () => (E.recorder ? stopRecording(E) : startRecording()) }, icon(E.recorder ? 'stop' : 'mic', 18), E.recorder ? 'Parar grabación' : 'Grabar'));
  if (!speechSupported) p.appendChild(h('p', { class: 'muted small' }, 'Este navegador no transcribe la voz automáticamente; el audio se guarda igualmente y puedes escribir la transcripción.'));
  const list = (it.audio || []).slice().reverse();
  if (!list.length) p.appendChild(h('p', { class: 'muted' }, 'Sin grabaciones.'));
  for (const a of list) {
    const audio = h('audio', { controls: true, preload: 'none' });
    getBlobURL(a.blobId).then(u => { if (u) audio.src = u; });
    const ta = h('textarea', { class: 'input', rows: 4, placeholder: 'Transcripción' });
    ta.value = a.transcript || '';
    ta.addEventListener('change', async () => {
      a.transcript = ta.value;
      await saveItem(it, { silent: true });
      await setText(it.id, null, 'audio:' + a.id, ta.value);
    });
    p.appendChild(h('div', { class: 'audio-item' },
      h('div', { class: 'row gap' }, h('strong', null, a.title || 'Grabación'), h('small', { class: 'muted' }, fmtDate(a.created) + ' · ' + fmtDuration(a.duration)),
        h('span', { class: 'grow' }),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Borrar grabación', onclick: async () => {
          if (!(await confirmDialog('Se borrará esta grabación.', { title: 'Borrar audio', ok: 'Borrar', danger: true }))) return;
          it.audio = it.audio.filter(x => x.id !== a.id);
          await saveItem(it, { silent: true });
          await setText(it.id, null, 'audio:' + a.id, '');
          renderSide();
        } }, icon('trash', 16))),
      audio, ta));
  }
}

async function startRecording() {
  try {
    const finalEl = h('span'), interimEl = h('span', { class: 'muted' }), timeEl = h('strong', null, '0:00');
    E.recorder = new Recorder({
      onText: (f, i) => { finalEl.textContent = f.slice(-160); interimEl.textContent = ' ' + i; },
      onTick: s => { timeEl.textContent = fmtDuration(s); },
    });
    await E.recorder.start({ transcribe: true });
    E.recBar.innerHTML = '';
    E.recBar.append(h('span', { class: 'rec-dot' }), timeEl, h('span', { class: 'rec-text' }, finalEl, interimEl),
      h('button', { class: 'btn danger sm', onclick: () => stopRecording(E) }, icon('stop', 16), 'Parar'));
    E.recBar.classList.remove('hidden');
    renderTools();
    if (E.side === 'audio') renderSide();
  } catch (e) {
    E.recorder = null;
    errorToast(e.name === 'NotAllowedError' ? new Error('No hay permiso para usar el micrófono.') : e);
  }
}

async function stopRecording(cur) {
  const rec = cur.recorder;
  if (!rec) return;
  cur.recorder = null;
  cur.recBar.classList.add('hidden');
  const r = await rec.stop();
  if (!r.blob.size) { toast('La grabación está vacía.'); return; }
  const it = cur.item;
  const blobId = await putBlob(r.blob, { name: 'audio', type: r.mime });
  const a = { id: uid(), blobId, mime: r.mime, duration: r.duration, created: Date.now(), title: 'Grabación ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }), transcript: r.transcript };
  it.audio = [...(it.audio || []), a];
  it.updated = Date.now();
  await saveItem(it, { silent: true });
  if (r.transcript) await setText(it.id, null, 'audio:' + a.id, r.transcript);
  toast('Grabación guardada' + (r.transcript ? ' con su transcripción.' : '.'), { action: E ? { label: 'Ver', onClick: () => { if (E && E.side !== 'audio') toggleSide('audio'); } } : null });
  if (E) { renderTools(); if (E.side === 'audio') renderSide(); }
}

// ----- Propiedades -----
function sideInfo(p) {
  const it = E.item;
  const folder = it.folderId ? state.folders.get(it.folderId)?.name : 'Biblioteca';
  const project = it.projectId ? state.projects.get(it.projectId)?.name : 'Ninguno';
  const tags = (it.tags || []).map(id => state.tags.get(id)).filter(Boolean);
  p.append(sideHead('Propiedades'),
    h('dl', { class: 'info-list' },
      h('dt', null, 'Título'), h('dd', null, it.title),
      h('dt', null, 'Carpeta'), h('dd', null, folder),
      h('dt', null, 'Proyecto'), h('dd', null, project),
      h('dt', null, 'Etiquetas'), h('dd', null, tags.length ? tags.map(t => h('span', { class: 'tag-chip xs', style: { '--tag': t.color } }, h('span', { class: 'dot' }), t.name)) : '—'),
      h('dt', null, 'Creado'), h('dd', null, new Date(it.created).toLocaleString('es-ES')),
      h('dt', null, 'Modificado'), h('dd', null, new Date(it.updated).toLocaleString('es-ES'))),
    h('div', { class: 'col gap' },
      h('button', { class: 'btn sm', onclick: async () => { const f = await pickFolder({ current: it.folderId }); if (f !== undefined) { await updateItem(it.id, { folderId: f }, { silent: true }); renderSide(); } } }, icon('move', 18), 'Mover a carpeta'),
      h('button', { class: 'btn sm', onclick: async () => { await pickProject([it.id]); renderSide(); } }, icon('project', 18), 'Proyecto'),
      h('button', { class: 'btn sm', onclick: async () => { const t = await pickTags(it.tags || []); if (t) { await updateItem(it.id, { tags: t }, { silent: true }); renderSide(); } } }, icon('tag', 18), 'Etiquetas'),
      h('button', { class: 'btn sm', onclick: () => { updateItem(it.id, { favorite: !it.favorite }, { touch: false, silent: true }); renderSide(); } }, icon(it.favorite ? 'starFill' : 'star', 18), it.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos')));
}

// ================= Menús =================
function imageMenu(anchor) {
  menu(anchor, [
    { label: 'Imagen de la galería o archivo', icon: 'image', onClick: async () => { const f = await pickFiles({ accept: 'image/*', multiple: true }); if (f.length) E.ed.insertImages(f); } },
    { label: 'Hacer una foto', icon: 'camera', onClick: async () => { const f = await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' }); if (f.length) E.ed.insertImages(f); } },
  ]);
}

function moreMenu(anchor) {
  const ed = E.ed, it = E.item, board = it.kind === 'board';
  const page = ed.currentPage();
  menu(anchor, [
    !board ? { label: 'Añadir página', icon: 'plus', onClick: () => ed.addPage(ed.currentPageIndex()) } : null,
    !board && page.bg.type !== 'pdf' ? { label: 'Papel de esta página…', icon: 'notebook', onClick: () => paperDialog(ed.currentPageIndex()) } : null,
    !board ? { label: 'Insertar páginas de un PDF…', icon: 'pdf', onClick: () => insertPdf() } : null,
    { label: 'Insertar imagen…', icon: 'image', onClick: () => imageMenu(anchor) },
    ed.hasClipboard() ? { label: 'Pegar', icon: 'paste', onClick: () => ed.paste() } : null,
    { sep: true },
    { label: 'Buscar en el documento', icon: 'search', onClick: () => toggleSide('search') },
    { label: 'Texto y transcripción', icon: 'scan', onClick: () => toggleSide('text') },
    { label: 'Audios', icon: 'mic', onClick: () => toggleSide('audio') },
    { label: 'Propiedades', icon: 'info', onClick: () => toggleSide('info') },
    { sep: true },
    { label: 'Exportar PDF', icon: 'pdf', onClick: async () => { await ed.flush(); exportItemPdf(it); } },
    { label: board ? 'Exportar como imagen' : 'Exportar esta página como imagen', icon: 'image', onClick: () => exportPng(ed.currentPageIndex()) },
    { label: 'Exportar texto (Markdown)', icon: 'file', onClick: () => exportMd() },
    { label: 'Exportar copia editable', icon: 'archive', onClick: async () => { await ed.flush(); exportItemsCopy([it.id]); } },
  ], { align: 'end' });
}

async function insertPdf() {
  const f = await pickFiles({ accept: 'application/pdf,.pdf', multiple: false });
  if (!f.length) return;
  const t = toast('Insertando páginas…', { duration: 0 });
  try {
    const ed = E.ed;
    const pages = await pdfPagesForDoc(f[0], E.item.id);
    for (const p of pages) ed.pageById.set(p.id, p);
    const at = ed.currentPageIndex() + 1;
    const ids = ed.item.pageIds.slice();
    ids.splice(at, 0, ...pages.map(p => p.id));
    ed.changePages(ids);
    ed.goToPage(at);
    t.close();
    toast(`${pages.length} páginas insertadas`);
  } catch (e) { t.close(); errorToast(e); }
}

async function exportPng(i) {
  const t = toast('Preparando imagen…', { duration: 0 });
  try {
    const { exportPagePng } = await import('./exporter.js');
    const blob = await exportPagePng(E.ed.pages[i]);
    t.close();
    await saveFile(blob, safeFileName(E.item.title) + (E.item.kind === 'board' ? '' : `-p${i + 1}`) + '.png');
  } catch (e) { t.close(); errorToast(e); }
}

async function exportMd() {
  try {
    await E.ed.flush();
    const { exportMarkdown } = await import('./exporter.js');
    const blob = await exportMarkdown(E.item);
    await saveFile(blob, safeFileName(E.item.title) + '.md');
  } catch (e) { errorToast(e); }
}
