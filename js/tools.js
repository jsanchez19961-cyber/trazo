// Herramientas del lienzo: pluma, subrayador, borrador, lazo, texto y formas.
import { uid, svgEl } from './util.js';
import {
  penOutline, polyPath, arrowPath, recognizeShape, shapePts, hitStroke, eraseFromStroke,
  strokeInPoly, pointInPoly, strokeBox,
} from './ink.js';

const HOLD_MS = 550;

function snapPage(p) {
  return { strokes: p.strokes.slice(), texts: p.texts.slice(), images: p.images.slice() };
}

// ---------- Pluma y subrayador ----------
class InkTool {
  constructor(ed, kind) { this.ed = ed; this.kind = kind; }

  down(c) {
    const o = this.ed.opts[this.kind];
    this.page = c.page;
    this.pv = c.pv;
    this.raw = [c.x, c.y, c.p];
    this.isPen = c.type === 'pen';
    this.base = this.kind === 'pen'
      ? { t: 'pen', c: o.color, w: o.size, th: o.thinning, sim: !this.isPen }
      : { t: 'hl', c: o.color, w: o.size, op: 0.45 };
    this.snapped = null;
    this.el = this.kind === 'pen'
      ? svgEl('path', { fill: o.color })
      : svgEl('path', { fill: 'none', stroke: o.color, 'stroke-width': o.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': 0.45 });
    (this.kind === 'pen' ? this.pv.liveG : this.pv.hlLive).appendChild(this.el);
    this.anchor = { x: c.x, y: c.y };
    this.armHold();
    this.draw();
  }

  armHold() {
    clearTimeout(this.holdT);
    this.holdT = setTimeout(() => this.hold(), HOLD_MS);
  }

  move(c) {
    const n = this.raw.length;
    const lx = this.raw[n - 3], ly = this.raw[n - 2];
    if (this.snapped) {
      if (this.snapped.kind === 'line') { this.snapped.x2 = c.x; this.snapped.y2 = c.y; this.schedule(); }
      return;
    }
    if (Math.hypot(c.x - lx, c.y - ly) < 0.35 / this.ed.view.z) return;
    this.raw.push(c.x, c.y, c.p);
    if (Math.hypot(c.x - this.anchor.x, c.y - this.anchor.y) > 5 / this.ed.view.z) {
      this.anchor = { x: c.x, y: c.y };
      this.armHold();
    }
    this.schedule();
  }

  // Mantener quieto el lápiz al acabar: el trazo se convierte en forma.
  hold() {
    if (this.snapped || this.raw.length < 12) return;
    let shape = null;
    if (this.kind === 'hl') {
      const n = this.raw.length;
      shape = { kind: 'line', x1: this.raw[0], y1: this.raw[1], x2: this.raw[n - 3], y2: this.raw[n - 2] };
    } else shape = recognizeShape(this.raw);
    if (!shape) return;
    this.snapped = shape;
    this.ed.haptic();
    this.draw();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  currentPts() {
    if (this.snapped) return shapePts(this.snapped.kind, this.snapped);
    const o = this.ed.opts[this.kind];
    if (this.kind === 'hl' && o.straight) {
      const n = this.raw.length;
      return [this.raw[0], this.raw[1], 0.5, this.raw[n - 3], this.raw[n - 2], 0.5];
    }
    return this.raw;
  }

  draw() {
    const pts = this.currentPts();
    const closed = this.snapped && this.snapped.kind !== 'line';
    if (this.kind === 'pen' && !this.snapped) {
      this.el.setAttribute('d', penOutline(pts, this.base.w, this.base.th, this.base.sim));
      this.el.setAttribute('fill', this.base.c);
      this.el.removeAttribute('stroke');
    } else {
      this.el.setAttribute('d', polyPath(pts, this.kind === 'hl' && !this.snapped, closed));
      if (this.kind === 'pen') {
        this.el.setAttribute('fill', 'none');
        this.el.setAttribute('stroke', this.base.c);
        this.el.setAttribute('stroke-width', this.base.w);
        this.el.setAttribute('stroke-linecap', 'round');
        this.el.setAttribute('stroke-linejoin', 'round');
      }
    }
  }

  up() {
    clearTimeout(this.holdT);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    let pts = this.currentPts();
    if (pts.length === 3) pts = [pts[0], pts[1], pts[2], pts[0] + 0.3, pts[1] + 0.3, pts[2]];
    let s;
    if (this.snapped && this.kind === 'pen') {
      s = { id: uid(), t: 'line', c: this.base.c, w: Math.max(1, this.base.w), pts: new Float32Array(pts) };
      if (this.snapped.kind !== 'line') s.closed = true;
    } else {
      s = { ...this.base, id: uid(), pts: new Float32Array(pts) };
    }
    this.el.remove();
    this.ed.change(this.page.id, p => { p.strokes.push(s); });
  }

  cancel() {
    clearTimeout(this.holdT);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.el?.remove();
  }
}

// ---------- Borrador ----------
class EraserTool {
  constructor(ed) { this.ed = ed; }

  radius() { return this.ed.opts.eraser.size / this.ed.view.z; }

  down(c) {
    this.page = c.page;
    this.pv = c.pv;
    this.before = snapPage(c.page);
    this.removed = new Set();
    this.changed = false;
    this.prev = { x: c.x, y: c.y };
    this.eraseAt(c.x, c.y);
    this.ed.showCursor(c, this.ed.opts.eraser.size);
  }

  move(c) {
    const r = this.radius();
    const dx = c.x - this.prev.x, dy = c.y - this.prev.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * 0.6)));
    for (let i = 1; i <= steps; i++) this.eraseAt(this.prev.x + (dx * i) / steps, this.prev.y + (dy * i) / steps);
    this.prev = { x: c.x, y: c.y };
    this.ed.showCursor(c, this.ed.opts.eraser.size);
  }

  hover(c) { this.ed.showCursor(c, this.ed.opts.eraser.size); }

  eraseAt(x, y) {
    const o = this.ed.opts.eraser, r = this.radius();
    const page = this.page;
    if (o.mode === 'stroke') {
      for (const s of page.strokes) {
        if (this.removed.has(s.id) || (o.hlOnly && s.t !== 'hl')) continue;
        if (hitStroke(s, x, y, r)) {
          this.removed.add(s.id);
          const rec = this.pv.strokeEls.get(s.id);
          if (rec) rec.el.style.display = 'none';
        }
      }
      return;
    }
    let changed = false;
    const out = [];
    for (const s of page.strokes) {
      if (o.hlOnly && s.t !== 'hl') { out.push(s); continue; }
      const res = eraseFromStroke(s, x, y, r, uid);
      if (res === null) out.push(s);
      else { changed = true; out.push(...res); }
    }
    if (changed) {
      page.strokes = out;
      this.changed = true;
      this.pv.refreshStrokes();
    }
  }

  up() {
    if (this.removed.size) {
      this.page.strokes = this.page.strokes.filter(s => !this.removed.has(s.id));
      this.changed = true;
    }
    if (this.changed) this.ed.commitFrom(this.page.id, this.before);
    else this.pv.refreshStrokes();
  }

  cancel() {
    const p = this.page;
    if (!p) return;
    p.strokes = this.before.strokes;
    this.pv.refreshStrokes();
    for (const rec of this.pv.strokeEls.values()) rec.el.style.display = '';
  }
}

// ---------- Lazo (seleccionar, mover, escalar) ----------
class LassoTool {
  constructor(ed) { this.ed = ed; }

  down(c) {
    this.page = c.page;
    this.pv = c.pv;
    this.start = { x: c.x, y: c.y };
    this.mode = null;
    const sel = this.ed.sel;
    if (sel && sel.pageId === c.page.id && sel.box) {
      const b = sel.box, tol = 22 / this.ed.view.z;
      if (Math.hypot(c.x - b.x2, c.y - b.y2) < tol) {
        this.mode = 'scale';
        this.anchor = { x: b.x1, y: b.y1 };
        this.d0 = Math.max(1, Math.hypot(b.x2 - b.x1, b.y2 - b.y1));
      } else if (c.x > b.x1 - tol / 2 && c.x < b.x2 + tol / 2 && c.y > b.y1 - tol / 2 && c.y < b.y2 + tol / 2) {
        this.mode = 'move';
      }
    }
    if (this.mode) {
      this.els = this.pv.elementsFor(sel);
      this.ed.hideSelBar();
      return;
    }
    this.ed.clearSelection();
    this.mode = 'lasso';
    this.poly = [c.x, c.y];
    this.el = svgEl('path', { class: 'lasso', fill: 'rgba(58,109,240,0.06)', stroke: '#3a6df0', 'stroke-width': 1.5 / this.ed.view.z, 'stroke-dasharray': `${5 / this.ed.view.z} ${4 / this.ed.view.z}` });
    this.pv.selG.appendChild(this.el);
  }

  move(c) {
    if (this.mode === 'lasso') {
      this.poly.push(c.x, c.y);
      let d = `M${this.poly[0]} ${this.poly[1]}`;
      for (let i = 2; i < this.poly.length; i += 2) d += `L${this.poly[i]} ${this.poly[i + 1]}`;
      this.el.setAttribute('d', d + 'Z');
    } else if (this.mode === 'move') {
      this.dx = c.x - this.start.x;
      this.dy = c.y - this.start.y;
      this.preview(`translate(${this.dx}px, ${this.dy}px)`, `translate(${this.dx} ${this.dy})`);
    } else if (this.mode === 'scale') {
      const d = Math.hypot(c.x - this.anchor.x, c.y - this.anchor.y);
      this.f = Math.max(0.05, d / this.d0);
      const { x, y } = this.anchor, f = this.f;
      this.preview(null, `translate(${x} ${y}) scale(${f}) translate(${-x} ${-y})`, f);
    }
  }

  preview(css, svgT, f) {
    for (const el of this.els) {
      if (el instanceof SVGElement) el.setAttribute('transform', svgT);
      else if (css) el.style.transform = css;
      else {
        const ox = this.anchor.x - parseFloat(el.style.left), oy = this.anchor.y - parseFloat(el.style.top);
        el.style.transformOrigin = `${ox}px ${oy}px`;
        el.style.transform = `scale(${f})`;
      }
    }
    this.pv.selG.setAttribute('transform', svgT);
  }

  clearPreview() {
    for (const el of this.els || []) {
      if (el instanceof SVGElement) el.removeAttribute('transform');
      else { el.style.transform = ''; el.style.transformOrigin = ''; }
    }
    this.pv.selG.removeAttribute('transform');
  }

  up(c) {
    if (this.mode === 'lasso') {
      this.el.remove();
      this.select(c);
    } else if (this.mode === 'move') {
      this.clearPreview();
      const dx = this.dx || 0, dy = this.dy || 0;
      if (Math.hypot(dx, dy) > 0.5) this.ed.transformSelection((x, y) => [x + dx, y + dy], 1);
      else this.ed.showSelection();
    } else if (this.mode === 'scale') {
      this.clearPreview();
      const f = this.f || 1, { x: ax, y: ay } = this.anchor;
      if (Math.abs(f - 1) > 0.01) this.ed.transformSelection((x, y) => [ax + (x - ax) * f, ay + (y - ay) * f], f);
      else this.ed.showSelection();
    }
    this.mode = null;
    this.dx = this.dy = 0;
    this.f = 1;
  }

  select(c) {
    const page = this.page, poly = this.poly;
    const sel = { pageId: page.id, strokes: new Set(), texts: new Set(), images: new Set() };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      x1 = Math.min(x1, poly[i]); x2 = Math.max(x2, poly[i]);
      y1 = Math.min(y1, poly[i + 1]); y2 = Math.max(y2, poly[i + 1]);
    }
    const tap = (x2 - x1) * this.ed.view.z < 8 && (y2 - y1) * this.ed.view.z < 8;
    if (tap) {
      const r = 8 / this.ed.view.z;
      const hit = this.ed.objectAt(page, c.x, c.y, r);
      if (hit) sel[hit.kind].add(hit.id);
    } else {
      for (const s of page.strokes) {
        const b = strokeBox(s);
        if (b.x2 < x1 || b.x1 > x2 || b.y2 < y1 || b.y1 > y2) continue;
        if (strokeInPoly(s, poly)) sel.strokes.add(s.id);
      }
      for (const t of page.texts) {
        const cx = t.x + t.w / 2, cy = t.y + (t.h || 30) / 2;
        if (pointInPoly(cx, cy, poly)) sel.texts.add(t.id);
      }
      for (const im of page.images) {
        if (pointInPoly(im.x + im.w / 2, im.y + im.h / 2, poly)) sel.images.add(im.id);
      }
    }
    if (sel.strokes.size + sel.texts.size + sel.images.size) this.ed.setSelection(sel);
  }

  cancel() {
    this.el?.remove();
    this.clearPreview();
    this.mode = null;
  }
}

// ---------- Texto ----------
class TextTool {
  constructor(ed) { this.ed = ed; }
  down(c) { this.start = { x: c.x, y: c.y }; this.page = c.page; }
  move() { }
  up(c) {
    if (Math.hypot(c.x - this.start.x, c.y - this.start.y) * this.ed.view.z > 12) return;
    const hit = this.ed.textAt(this.page, c.x, c.y);
    if (hit) this.ed.editText(this.page.id, hit.id);
    else this.ed.createText(this.page.id, c.x, c.y);
  }
  cancel() { }
}

// ---------- Formas ----------
class ShapeTool {
  constructor(ed) { this.ed = ed; }
  down(c) {
    const o = this.ed.opts.shape;
    this.page = c.page;
    this.pv = c.pv;
    this.a = { x1: c.x, y1: c.y, x2: c.x, y2: c.y };
    this.el = svgEl('g');
    this.path = svgEl('path', { fill: o.fill ? o.color : 'none', 'fill-opacity': 0.35, stroke: o.color, 'stroke-width': o.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    this.head = svgEl('path', { fill: 'none', stroke: o.color, 'stroke-width': o.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    this.el.append(this.path, this.head);
    this.pv.liveG.appendChild(this.el);
  }
  build() {
    const o = this.ed.opts.shape;
    const k = o.kind;
    let { x1, y1, x2, y2 } = this.a;
    let pts;
    if (k === 'triangle') pts = shapePts('poly', { points: [[(x1 + x2) / 2, y1], [x2, y2], [x1, y2]] });
    else if (k === 'diamond') pts = shapePts('poly', { points: [[(x1 + x2) / 2, y1], [x2, (y1 + y2) / 2], [(x1 + x2) / 2, y2], [x1, (y1 + y2) / 2]] });
    else pts = shapePts(k === 'arrow' ? 'line' : k, { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), ...(k === 'line' || k === 'arrow' ? { x1, y1, x2, y2 } : {}) });
    const s = { id: uid(), t: 'line', c: o.color, w: o.size, pts: new Float32Array(pts) };
    if (k !== 'line' && k !== 'arrow') { s.closed = true; if (o.fill) s.fill = o.color; }
    if (k === 'arrow') s.arrow = true;
    return s;
  }
  move(c) {
    this.a.x2 = c.x;
    this.a.y2 = c.y;
    const s = this.build();
    this.path.setAttribute('d', polyPath(s.pts, false, s.closed));
    this.head.setAttribute('d', s.arrow ? arrowPath(s) : '');
  }
  up() {
    this.el.remove();
    const { x1, y1, x2, y2 } = this.a;
    if (Math.hypot(x2 - x1, y2 - y1) * this.ed.view.z < 6) return;
    const s = this.build();
    this.ed.change(this.page.id, p => { p.strokes.push(s); });
  }
  cancel() { this.el?.remove(); }
}

export function createTools(ed) {
  return {
    pen: new InkTool(ed, 'pen'),
    hl: new InkTool(ed, 'hl'),
    eraser: new EraserTool(ed),
    lasso: new LassoTool(ed),
    text: new TextTool(ed),
    shape: new ShapeTool(ed),
  };
}

export { snapPage };
