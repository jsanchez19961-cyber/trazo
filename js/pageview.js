// Una página en pantalla: papel o PDF, imágenes, textos y tinta.
import { svgEl, h, sanitizeHtml } from './util.js';
import { strokePath, arrowPath } from './ink.js';
import { paperSvg } from './paper.js';
import { renderPdfPage } from './pdfdoc.js';
import { getBlobURL } from './store.js';

export const MAX_PDF_PIXELS = 9e6;

export class PageView {
  constructor(editor, page) {
    this.ed = editor;
    this.page = page;
    this.strokeEls = new Map();
    this.textEls = new Map();
    this.imgEls = new Map();
    this.pdfScale = 0;
    this.pdfToken = null;
    this.build();
  }

  build() {
    const p = this.page;
    const inf = !!p.infinite;
    this.el = h('div', { class: 'page' + (inf ? ' infinite' : ''), dataset: { id: p.id } });
    if (!inf) {
      this.el.style.width = p.w + 'px';
      this.el.style.height = p.h + 'px';
      this.el.style.background = p.bg.color || '#fff';
    }
    const W = inf ? 1 : p.w, H = inf ? 1 : p.h;
    if (p.bg.type === 'pdf') {
      this.pdfCanvas = h('canvas', { class: 'pdf-bg' });
      this.el.appendChild(this.pdfCanvas);
    } else if (!inf) {
      this.paper = svgEl('svg', { class: 'paper', width: W, height: H });
      this.el.appendChild(this.paper);
      this.renderPaper();
    }
    this.imgLayer = h('div', { class: 'layer images' });
    this.hlSvg = svgEl('svg', { class: 'layer hl', width: W, height: H });
    this.hlG = svgEl('g');
    this.hlLive = svgEl('g');
    this.hlSvg.append(this.hlG, this.hlLive);
    this.textLayer = h('div', { class: 'layer texts' });
    this.inkSvg = svgEl('svg', { class: 'layer ink', width: W, height: H });
    this.inkG = svgEl('g');
    this.liveG = svgEl('g');
    this.selG = svgEl('g', { class: 'sel' });
    this.inkSvg.append(this.inkG, this.liveG, this.selG);
    this.el.append(this.imgLayer, this.hlSvg, this.textLayer, this.inkSvg);
    if (p.bg.type === 'pdf') this.el.appendChild(h('div', { class: 'pdf-loading' }, 'Cargando página…'));
    this.refresh();
  }

  renderPaper() {
    if (!this.paper) return;
    const p = this.page;
    this.el.style.background = p.bg.color || '#fff';
    this.paper.innerHTML = paperSvg(p.bg.type, p.w, p.h, p.id.replace(/[^a-z0-9]/gi, ''));
  }

  setPos(x, y) {
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
  }

  // ----- PDF -----
  async renderPdf(zoom) {
    if (!this.pdfCanvas) return;
    const p = this.page;
    const dpr = window.devicePixelRatio || 1;
    let scale = Math.max(0.5, zoom * dpr);
    const maxScale = Math.sqrt(MAX_PDF_PIXELS / (p.w * p.h));
    scale = Math.min(scale, maxScale);
    // Solo se repinta si la resolución actual se queda corta o sobra mucho.
    if (this.pdfScale && scale <= this.pdfScale * 1.15 && scale >= this.pdfScale * 0.45) return;
    if (this.pdfToken) { this.pdfToken.cancelled = true; try { this.pdfToken.task?.cancel(); } catch { /* nada */ } }
    const token = this.pdfToken = {};
    const target = this.pdfScale ? h('canvas') : this.pdfCanvas;
    try {
      const ok = await renderPdfPage(p.bg.blobId, p.bg.page, target, scale, token);
      if (!ok || token.cancelled) return;
      if (target !== this.pdfCanvas) {
        this.pdfCanvas.width = target.width;
        this.pdfCanvas.height = target.height;
        this.pdfCanvas.getContext('2d').drawImage(target, 0, 0);
      }
      this.pdfScale = scale;
      this.el.querySelector('.pdf-loading')?.remove();
    } catch (e) {
      console.error(e);
      const l = this.el.querySelector('.pdf-loading');
      if (l) l.textContent = 'No se pudo mostrar esta página del PDF';
    }
  }

  // ----- Reconciliación con los datos -----
  refresh() {
    this.refreshStrokes();
    this.refreshTexts();
    this.refreshImages();
  }

  refreshStrokes() {
    const seen = new Set();
    let inkIdx = 0, hlIdx = 0;
    for (const s of this.page.strokes) {
      seen.add(s.id);
      let rec = this.strokeEls.get(s.id);
      const parent = s.t === 'hl' ? this.hlG : this.inkG;
      if (!rec) {
        rec = { s: null, el: null };
        this.strokeEls.set(s.id, rec);
      }
      if (rec.s !== s) {
        const el = makeStrokeEl(s);
        if (rec.el) rec.el.replaceWith(el);
        rec.el = el;
        rec.s = s;
      }
      // Orden correcto dentro de su capa.
      const idx = s.t === 'hl' ? hlIdx++ : inkIdx++;
      if (rec.el.parentNode !== parent || parent.childNodes[idx] !== rec.el) parent.insertBefore(rec.el, parent.childNodes[idx] || null);
    }
    for (const [id, rec] of this.strokeEls) {
      if (!seen.has(id)) { rec.el.remove(); this.strokeEls.delete(id); }
    }
  }

  refreshTexts() {
    const seen = new Set();
    for (const t of this.page.texts) {
      seen.add(t.id);
      let rec = this.textEls.get(t.id);
      if (!rec) {
        rec = { t: null, el: h('div', { class: 'tb', dataset: { id: t.id } }) };
        this.textEls.set(t.id, rec);
        this.textLayer.appendChild(rec.el);
      }
      if (rec.t !== t && !rec.el.isContentEditable) {
        applyTextStyle(rec.el, t);
        rec.el.innerHTML = sanitizeHtml(t.html);
        rec.t = t;
      } else if (rec.t !== t) {
        applyTextStyle(rec.el, t);
        rec.t = t;
      }
    }
    for (const [id, rec] of this.textEls) {
      if (!seen.has(id)) { rec.el.remove(); this.textEls.delete(id); }
    }
  }

  refreshImages() {
    const seen = new Set();
    for (const im of this.page.images) {
      seen.add(im.id);
      let rec = this.imgEls.get(im.id);
      if (!rec) {
        rec = { im: null, el: h('img', { class: 'im', draggable: false, alt: '' }) };
        this.imgEls.set(im.id, rec);
        this.imgLayer.appendChild(rec.el);
        getBlobURL(im.blobId).then(u => { if (u) rec.el.src = u; });
      }
      if (rec.im !== im) {
        Object.assign(rec.el.style, { left: im.x + 'px', top: im.y + 'px', width: im.w + 'px', height: im.h + 'px', transform: '' });
        rec.im = im;
      }
    }
    for (const [id, rec] of this.imgEls) {
      if (!seen.has(id)) { rec.el.remove(); this.imgEls.delete(id); }
    }
  }

  // Elementos de un conjunto de objetos (para moverlos en vivo).
  elementsFor(sel) {
    const out = [];
    for (const id of sel.strokes) { const r = this.strokeEls.get(id); if (r) out.push(r.el); }
    for (const id of sel.texts) { const r = this.textEls.get(id); if (r) out.push(r.el); }
    for (const id of sel.images) { const r = this.imgEls.get(id); if (r) out.push(r.el); }
    return out;
  }

  destroy() {
    if (this.pdfToken) { this.pdfToken.cancelled = true; try { this.pdfToken.task?.cancel(); } catch { /* nada */ } }
    if (this.pdfCanvas) { this.pdfCanvas.width = 0; this.pdfCanvas.height = 0; }
    this.el.remove();
  }
}

export function applyTextStyle(el, t) {
  Object.assign(el.style, {
    left: t.x + 'px', top: t.y + 'px', width: t.w + 'px',
    fontSize: (t.size || 18) + 'px', color: t.color || '#1d1d1f',
    textAlign: t.align || 'left', transform: '',
  });
  el.classList.toggle('boxed', !!t.box);
}

export function makeStrokeEl(s) {
  if (s.t === 'pen') {
    return svgEl('path', { d: strokePath(s), fill: s.c, 'data-id': s.id });
  }
  if (s.t === 'hl') {
    return svgEl('path', {
      d: strokePath(s), fill: 'none', stroke: s.c, 'stroke-width': s.w, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', 'stroke-opacity': s.op ?? 0.45, 'data-id': s.id,
    });
  }
  const g = svgEl('g', { 'data-id': s.id });
  g.appendChild(svgEl('path', {
    d: strokePath(s), fill: s.fill || 'none', 'fill-opacity': s.fill ? 0.35 : null, stroke: s.c, 'stroke-width': s.w,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  if (s.arrow) g.appendChild(svgEl('path', { d: arrowPath(s), fill: 'none', stroke: s.c, 'stroke-width': s.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return g;
}
