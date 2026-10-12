// Utilidades comunes.

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// Minúsculas y sin tildes, conservando la longitud del texto (útil para resaltar).
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Constructor de nodos: h('div', {class: 'x', onclick}, 'texto', otroNodo)
export function h(tag, props, ...children) {
  const el = tag.includes(':') || tag === 'svg' || tag === 'path' || tag === 'g'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag.replace('svg:', ''))
    : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string' && el.namespaceURI !== 'http://www.w3.org/2000/svg') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendKids(el, children);
  return el;
}

function appendKids(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fmtDate(ts, withTime = true) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date();
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, n)) return withTime ? 'hoy ' + hm : 'hoy';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return withTime ? 'ayer ' + hm : 'ayer';
  const s = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear() ? s : `${s} ${d.getFullYear()}`;
}

export function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

export function fmtDuration(s) {
  s = Math.round(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

// En tablet ofrece «Compartir» (guardar en Archivos, Drive...). Si no, descarga.
export async function saveFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  downloadBlob(blob, filename);
}

export function readAsArrayBuffer(file) {
  if (file.arrayBuffer) return file.arrayBuffer();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

export function pickFiles({ accept = '', multiple = true, capture } = {}) {
  return new Promise(res => {
    const input = h('input', { type: 'file', accept, style: 'position:fixed;left:-1000px' });
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.addEventListener('change', () => { res([...input.files]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export function safeFileName(s) {
  return (String(s || 'documento').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'documento').slice(0, 120);
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '#000000');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

// Texto plano a partir del HTML de una caja de texto.
export function htmlToText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  return div.textContent.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
}

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN', 'FONT', 'H1', 'H2', 'H3', 'S', 'STRIKE']);
// Limpia el HTML pegado o escrito para que solo quede formato básico.
export function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!ALLOWED.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'VIDEO', 'AUDIO'].includes(child.tagName)) { child.remove(); continue; }
          walk(child);
          child.replaceWith(...child.childNodes);
          continue;
        }
        const color = child.getAttribute('color') || child.style.color;
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        if (color && /^(#[0-9a-f]{3,8}|rgb\([\d\s,.]+\))$/i.test(color.trim())) child.style.color = color.trim();
        walk(child);
      } else if (child.nodeType !== 3) child.remove();
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

export const isCoarse = () => matchMedia('(pointer: coarse)').matches;
