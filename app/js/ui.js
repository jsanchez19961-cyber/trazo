// Piezas de interfaz: avisos, ventanas, menús y selectores.
import { h, esc } from './util.js';
import { icon } from './icons.js';
import { state, saveFolder, saveTag, tagByName, TAG_COLORS } from './store.js';

// ---------- Avisos ----------
let toastHost;
export function toast(msg, { type = 'info', duration = 3200, action } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.appendChild(toastHost); }
  const text = h('span', { class: 'toast-text' }, msg);
  const el = h('div', { class: 'toast ' + type, role: 'status' }, text);
  if (action) el.appendChild(h('button', { class: 'toast-btn', onclick: () => { action.onClick(); close(); } }, action.label));
  toastHost.appendChild(el);
  let t;
  const close = () => { clearTimeout(t); el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  if (duration) t = setTimeout(close, duration);
  return { close, update: m => { text.textContent = m; } };
}

export function errorToast(e) {
  console.error(e);
  toast(e?.message || String(e), { type: 'error', duration: 6000 });
}

// ---------- Ventanas ----------
export function modal({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal ' + (wide ? 'wide ' : '') + className, role: 'dialog', 'aria-modal': 'true' });
  const close = val => {
    if (!back.isConnected) return;
    back.classList.add('out');
    setTimeout(() => back.remove(), 180);
    document.removeEventListener('keydown', onKey);
    onClose?.(val);
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT') {
      const prim = actions.find(a => a.primary);
      if (prim) { e.preventDefault(); run(prim); }
    }
  };
  const run = async a => {
    const r = await a.onClick?.();
    if (r !== false) close(r);
  };
  const head = h('div', { class: 'modal-head' },
    h('h2', null, title || ''),
    h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close')));
  const content = h('div', { class: 'modal-body' }, body);
  box.append(head, content);
  if (actions.length) {
    box.appendChild(h('div', { class: 'modal-actions' }, actions.map(a =>
      h('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), onclick: () => run(a) }, a.label))));
  }
  back.appendChild(box);
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  setTimeout(() => box.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=color]), textarea')?.focus(), 60);
  return { close, el: box, body: content };
}

export function confirmDialog(msg, { title = 'Confirmar', ok = 'Aceptar', danger = false, cancel = 'Cancelar' } = {}) {
  return new Promise(res => {
    modal({
      title, body: h('p', { class: 'modal-msg' }, msg), onClose: v => res(v === true),
      actions: [{ label: cancel, onClick: () => null }, { label: ok, primary: !danger, danger, onClick: () => true }],
    });
  });
}

export function promptDialog(title, { value = '', placeholder = '', ok = 'Aceptar', label = '', multiline = false } = {}) {
  return new Promise(res => {
    const input = multiline
      ? h('textarea', { class: 'input', rows: 4, placeholder })
      : h('input', { class: 'input', type: 'text', placeholder });
    input.value = value;
    modal({
      title, body: h('div', null, label ? h('label', { class: 'field-label' }, label) : null, input),
      onClose: v => res(typeof v === 'string' ? v : null),
      actions: [{ label: 'Cancelar', onClick: () => null }, { label: ok, primary: true, onClick: () => input.value.trim() || false }],
    });
    setTimeout(() => { input.focus(); input.select?.(); }, 80);
  });
}

export function choose(title, options, { message } = {}) {
  return new Promise(res => {
    let m;
    const list = h('div', { class: 'choice-list' }, options.map(o =>
      h('button', { class: 'choice', onclick: () => m.close({ v: o.value }) },
        o.icon ? icon(o.icon) : null,
        h('span', { class: 'choice-text' }, h('strong', null, o.label), o.desc ? h('small', null, o.desc) : null))));
    m = modal({ title, body: h('div', null, message ? h('p', { class: 'modal-msg' }, message) : null, list), onClose: v => res(v && 'v' in v ? v.v : null) });
  });
}

// ---------- Menús y popovers ----------
let openPop = null;
export function closePopover() { openPop?.close(); }

export function popover(anchor, content, { className = '', align = 'start' } = {}) {
  closePopover();
  const pop = h('div', { class: 'popover ' + className }, content);
  const back = h('div', { class: 'pop-back' });
  document.body.append(back, pop);
  const place = () => {
    if (anchor instanceof Element && !anchor.isConnected && pop.style.left) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    let r;
    if (anchor instanceof Element) r = anchor.getBoundingClientRect();
    else r = { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = align === 'end' ? r.right - pw : r.left;
    let y = r.bottom + 6;
    if (y + ph > vh - 8) y = Math.max(8, r.top - ph - 6);
    x = Math.max(8, Math.min(x, vw - pw - 8));
    pop.style.left = x + 'px';
    pop.style.top = Math.max(8, Math.min(y, vh - ph - 8)) + 'px';
  };
  place();
  const ctl = {
    close: () => {
      pop.remove(); back.remove();
      window.removeEventListener('resize', place);
      document.removeEventListener('keydown', onKey);
      if (openPop === ctl) openPop = null;
    },
    el: pop, place,
  };
  const onKey = e => { if (e.key === 'Escape') ctl.close(); };
  back.addEventListener('pointerdown', e => { e.preventDefault(); ctl.close(); });
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey);
  openPop = ctl;
  return ctl;
}

export function menu(anchor, items, opts = {}) {
  let ctl;
  const list = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { list.appendChild(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { list.appendChild(h('div', { class: 'menu-header' }, it.header)); continue; }
    list.appendChild(h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''), role: 'menuitem', disabled: !!it.disabled,
      onclick: () => { ctl.close(); it.onClick?.(); },
    }, it.icon ? icon(it.icon, 20) : h('span', { class: 'ic-space' }), h('span', { class: 'menu-label' }, it.label),
    it.checked ? icon('check', 18) : null, it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null));
  }
  ctl = popover(anchor, list, opts);
  return ctl;
}

// ---------- Selectores ----------
export function folderTree(parentId = null, depth = 0, exclude = null) {
  const out = [];
  const kids = [...state.folders.values()].filter(f => (f.parentId || null) === parentId && f.id !== exclude)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  for (const f of kids) {
    out.push({ folder: f, depth });
    out.push(...folderTree(f.id, depth + 1, exclude));
  }
  return out;
}

export function pickFolder({ title = 'Mover a carpeta', current = null, exclude = null } = {}) {
  return new Promise(res => {
    let m;
    const render = () => {
      list.innerHTML = '';
      list.appendChild(h('button', { class: 'choice' + (current === null ? ' current' : ''), onclick: () => m.close({ v: null }) }, icon('home'), h('span', { class: 'choice-text' }, h('strong', null, 'Biblioteca (sin carpeta)'))));
      for (const { folder, depth } of folderTree(null, 0, exclude)) {
        list.appendChild(h('button', {
          class: 'choice' + (current === folder.id ? ' current' : ''), style: { paddingLeft: 12 + depth * 22 + 'px' },
          onclick: () => m.close({ v: folder.id }),
        }, h('span', { class: 'ic', style: { color: folder.color || 'var(--accent)' } }, icon('folder')), h('span', { class: 'choice-text' }, h('strong', null, folder.name))));
      }
    };
    const list = h('div', { class: 'choice-list' });
    render();
    m = modal({
      title, body: list, onClose: v => res(v && 'v' in v ? v.v : undefined),
      actions: [{
        label: 'Nueva carpeta', onClick: async () => {
          const name = await promptDialog('Nueva carpeta', { placeholder: 'Nombre' });
          if (name) { const f = await saveFolder({ name, parentId: null }); m.close({ v: f.id }); }
          return false;
        },
      }],
    });
  });
}

export function pickTags(selected = []) {
  return new Promise(res => {
    const sel = new Set(selected);
    const list = h('div', { class: 'tag-pick' });
    const input = h('input', { class: 'input', placeholder: 'Nueva etiqueta y pulsa Intro' });
    const render = () => {
      list.innerHTML = '';
      const tags = [...state.tags.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      if (!tags.length) list.appendChild(h('p', { class: 'muted' }, 'Aún no hay etiquetas. Escribe una abajo.'));
      for (const t of tags) {
        list.appendChild(h('button', {
          class: 'tag-chip big' + (sel.has(t.id) ? ' on' : ''), style: { '--tag': t.color },
          onclick: () => { sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id); render(); },
        }, h('span', { class: 'dot' }), t.name, sel.has(t.id) ? icon('check', 16) : null));
      }
    };
    const add = async () => {
      const name = input.value.trim().replace(/^#/, '');
      if (!name) return;
      let t = tagByName(name);
      if (!t) t = await saveTag({ name, color: TAG_COLORS[state.tags.size % TAG_COLORS.length] });
      sel.add(t.id);
      input.value = '';
      render();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } });
    render();
    modal({
      title: 'Etiquetas', body: h('div', null, list, h('div', { class: 'row gap' }, input, h('button', { class: 'btn', onclick: add }, 'Añadir'))),
      onClose: v => res(v === true ? [...sel] : null),
      actions: [{ label: 'Cancelar', onClick: () => null }, { label: 'Guardar', primary: true, onClick: async () => { await add(); return true; } }],
    });
  });
}

export const SWATCHES = ['#1d1d1f', '#5b6472', '#ffffff', '#1f4fd1', '#0d9bd8', '#13804a', '#7bbf3a', '#f2c200', '#f08a24', '#d12a2a', '#d6409f', '#7a4fd6', '#8a5a2b'];
export const HL_SWATCHES = ['#ffe14d', '#ffb347', '#ff9ccf', '#7ee081', '#7cc8ff', '#c9a7ff'];

export function colorGrid(colors, current, onPick, { custom = true } = {}) {
  const wrap = h('div', { class: 'swatches' });
  for (const c of colors) {
    wrap.appendChild(h('button', {
      class: 'swatch' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : ''), style: { '--c': c }, 'aria-label': 'Color ' + c,
      onclick: () => onPick(c),
    }));
  }
  if (custom) {
    const inp = h('input', { type: 'color', class: 'swatch-custom', 'aria-label': 'Otro color' });
    inp.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000';
    inp.addEventListener('input', () => onPick(inp.value));
    wrap.appendChild(h('label', { class: 'swatch custom', title: 'Otro color' }, inp));
  }
  return wrap;
}

export function emptyState(iconName, title, text, actions = []) {
  return h('div', { class: 'empty' }, icon(iconName, 44), h('h3', null, title), text ? h('p', null, text) : null,
    actions.length ? h('div', { class: 'row gap center' }, actions) : null);
}

export function highlight(text, terms) {
  let s = esc(text);
  for (const t of terms) {
    if (!t || t.length < 2) continue;
    const re = new RegExp('(' + accentPattern(t) + ')', 'gi');
    s = s.replace(re, '<mark>$1</mark>');
  }
  return s;
}

const ACC = { a: '[aáàäâ]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöô]', u: '[uúùüû]', n: '[nñ]', c: '[cç]' };
function accentPattern(t) {
  return [...t].map(ch => ACC[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
}
