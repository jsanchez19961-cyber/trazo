// Núcleo del editor: vista con zoom y desplazamiento, entrada de lápiz/dedo/ratón,
// deshacer/rehacer, selección, cajas de texto y guardado automático.
import { h, uid, clamp, debounce, sanitizeHtml, htmlToText, loadImage, svgEl } from './util.js';
import { PageView, applyTextStyle } from './pageview.js';
import { createTools, snapPage } from './tools.js';
import { mapStroke, selectionBox, hitStroke, strokeBox } from './ink.js';
import { makeThumb } from './render.js';
import {
  state, saveItem, savePages, deletePages, newPage, putBlob, getBlobURL, setTexts, getDocTexts,
  emit, setSetting, PAGE_SIZES,
} from './store.js';

const GAP = 28;
let clipboard = null;

export class Editor {
  constructor(host, item, pages, ui = {}) {
    this.item = item;
    this.pages = pages;
    this.pageById = new Map(pages.map(p => [p.id, p]));
    this.ui = ui;
    this.isBoard = item.kind === 'board';
    this.view = { tx: 0, ty: 0, z: 1 };
    this.pvs = new Map();
    this.rects = new Map();
    this.history = [];
    this.future = [];
    this.dirty = new Set();
    this.touches = new Map();
    this.active = null;
    this.mode = null;
    this.sel = null;
    this.editing = null;
    this.lastPen = 0;
    this.toolName = 'pen';
    const st = state.settings;
    this.opts = {
      pen: { color: st.penColors[0], size: 2.4, thinning: 0.6 },
      hl: { color: st.hlColors[0], size: 18, straight: false },
      eraser: { size: 14, mode: 'partial', hlOnly: false },
      shape: { kind: 'rect', color: '#1d1d1f', size: 2.4, fill: false },
      text: { size: 18, color: '#1d1d1f' },
      ...(st.toolOpts || {}),
    };
    // Desde la versión 1.2 el borrador borra solo por donde pasa (antes, el trazo entero).
    if (st.toolOptsVersion !== 2) {
      this.opts.eraser = { ...this.opts.eraser, mode: 'partial' };
      setSetting('toolOpts', this.opts);
      setSetting('toolOptsVersion', 2);
    }
    this.tools = createTools(this);

    this.root = h('div', { class: 'ed-stage' });
    this.viewport = h('div', { class: 'viewport' + (this.isBoard ? ' board' : '') });
    this.world = h('div', { class: 'world' });
    this.viewport.appendChild(this.world);
    this.cursor = h('div', { class: 'ed-cursor' });
    this.selBar = h('div', { class: 'sel-bar hidden' });
    this.root.append(this.viewport, this.cursor, this.selBar);
    host.appendChild(this.root);

    this.saveSoon = debounce(() => this.save(), 700);
    this.thumbSoon = debounce(() => this.updateThumb(), 2500);
    this.settleSoon = debounce(() => this.settle(), 140);
    this.computeLayout();
    this.bindInput();
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.viewport);
  }

  // ================= Disposición y vista =================
  computeLayout() {
    this.rects.clear();
    if (this.isBoard) {
      this.rects.set(this.pages[0].id, { x: 0, y: 0, w: 0, h: 0 });
      this.maxW = 0;
      this.totalH = 0;
      return;
    }
    let y = 0, maxW = 0;
    for (const p of this.pages) {
      this.rects.set(p.id, { x: -p.w / 2, y, w: p.w, h: p.h });
      y += p.h + GAP;
      maxW = Math.max(maxW, p.w);
    }
    this.maxW = maxW;
    this.totalH = Math.max(0, y - GAP);
    for (const [id, pv] of this.pvs) {
      const r = this.rects.get(id);
      if (r) pv.setPos(r.x, r.y);
    }
  }

  vpSize() {
    return { w: this.viewport.clientWidth || 1, h: this.viewport.clientHeight || 1 };
  }

  fitZoom() {
    const { w } = this.vpSize();
    const margin = w < 700 ? 10 : 32;
    return clamp((w - margin * 2) / (this.maxW || 800), 0.2, 1.6);
  }

  initialView(pageIndex = 0) {
    const { w } = this.vpSize();
    if (this.isBoard) {
      const v = this.item.view || { tx: w / 2 - 300, ty: 60, z: 1 };
      this.setView(v.tx, v.ty, v.z);
    } else {
      const z = this.fitZoom();
      this.setView(w / 2, 16, z);
      if (pageIndex) this.goToPage(pageIndex, false);
    }
    this.updateVisible();
    this.settle();
  }

  zLimits() { return this.isBoard ? [0.1, 6] : [Math.min(0.2, this.fitZoom() * 0.5), 6]; }

  clampView(v) {
    if (this.isBoard) return v;
    const { w, h } = this.vpSize();
    const m = 16;
    const halfW = (this.maxW / 2) * v.z;
    if (halfW * 2 + m * 2 <= w) v.tx = w / 2;
    else v.tx = clamp(v.tx, w - m - halfW, m + halfW);
    const H = this.totalH * v.z;
    if (H + m * 2 <= h) v.ty = m;
    else v.ty = clamp(v.ty, h - m - H - 40, m);
    return v;
  }

  setView(tx, ty, z) {
    const [zmin, zmax] = this.zLimits();
    const v = this.clampView({ tx, ty, z: clamp(z, zmin, zmax) });
    this.view = v;
    this.world.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.z})`;
    if (this.isBoard) {
      const step = 18.9 * v.z;
      this.viewport.style.backgroundSize = `${step}px ${step}px`;
      this.viewport.style.backgroundPosition = `${v.tx}px ${v.ty}px`;
    }
    this.scheduleVisible();
    this.positionSelBar();
    this.ui.onView?.();
  }

  zoomAt(factor, cx, cy) {
    const r = this.viewport.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    const v = this.view;
    const [zmin, zmax] = this.zLimits();
    const z = clamp(v.z * factor, zmin, zmax);
    const wx = (px - v.tx) / v.z, wy = (py - v.ty) / v.z;
    this.moving();
    this.setView(px - wx * z, py - wy * z, z);
    this.settleSoon();
  }

  zoomBy(f) {
    const r = this.viewport.getBoundingClientRect();
    this.zoomAt(f, r.left + r.width / 2, r.top + r.height / 2);
  }

  fitWidth() {
    const { w } = this.vpSize();
    const cur = this.currentPageIndex();
    this.setView(w / 2, this.view.ty, this.fitZoom());
    this.goToPage(cur, false);
    this.settle();
  }

  moving() { this.world.classList.add('moving'); }

  // Al terminar un gesto: nitidez y PDF a la resolución del zoom.
  settle() {
    this.world.classList.remove('moving');
    for (const pv of this.pvs.values()) pv.renderPdf(this.view.z);
    if (this.isBoard) {
      this.item.view = { ...this.view };
      this.saveItemSoon();
    }
  }

  saveItemSoon = debounce(() => saveItem(this.item, { silent: true, norev: true }), 1500);

  onResize() {
    if (!this.started) return;
    this.setView(this.view.tx, this.view.ty, this.view.z);
    this.settleSoon();
  }

  scheduleVisible() {
    if (this.visRaf) return;
    this.visRaf = requestAnimationFrame(() => { this.visRaf = 0; this.updateVisible(); });
  }

  updateVisible() {
    const { h } = this.vpSize();
    const v = this.view;
    const top = -v.ty / v.z, bottom = (h - v.ty) / v.z, pad = h / v.z;
    const want = new Set();
    if (this.isBoard) want.add(this.pages[0].id);
    else {
      for (const p of this.pages) {
        const r = this.rects.get(p.id);
        if (r.y + r.h >= top - pad && r.y <= bottom + pad) want.add(p.id);
      }
    }
    for (const [id, pv] of this.pvs) {
      if (!want.has(id) && !(this.active && this.active.page.id === id) && !(this.editing && this.editing.pageId === id) && !(this.sel && this.sel.pageId === id)) {
        pv.destroy();
        this.pvs.delete(id);
      }
    }
    for (const id of want) {
      if (this.pvs.has(id)) continue;
      const page = this.pageById.get(id);
      const pv = new PageView(this, page);
      const r = this.rects.get(id);
      pv.setPos(r.x, r.y);
      this.world.appendChild(pv.el);
      this.pvs.set(id, pv);
      if (!this.world.classList.contains('moving')) pv.renderPdf(this.view.z);
      else this.settleSoon();
    }
  }

  clientToWorld(cx, cy) {
    const r = this.viewport.getBoundingClientRect();
    return { x: (cx - r.left - this.view.tx) / this.view.z, y: (cy - r.top - this.view.ty) / this.view.z };
  }

  pageAtWorld(x, y, slack = 0) {
    if (this.isBoard) return this.pages[0];
    for (const p of this.pages) {
      const r = this.rects.get(p.id);
      if (x >= r.x - slack && x <= r.x + r.w + slack && y >= r.y - slack && y <= r.y + r.h + slack) return p;
    }
    return null;
  }

  currentPageIndex() {
    if (this.isBoard) return 0;
    const { h } = this.vpSize();
    const cy = (h / 2 - this.view.ty) / this.view.z;
    let best = 0;
    for (let i = 0; i < this.pages.length; i++) {
      const r = this.rects.get(this.pages[i].id);
      if (r.y <= cy) best = i;
      else break;
    }
    return best;
  }

  currentPage() { return this.pages[this.currentPageIndex()]; }

  goToPage(i, smooth = true) {
    if (this.isBoard) return;
    i = clamp(i, 0, this.pages.length - 1);
    const r = this.rects.get(this.pages[i].id);
    const target = 16 - r.y * this.view.z;
    if (!smooth) { this.setView(this.view.tx, target, this.view.z); return; }
    const from = this.view.ty, t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / 260), e = 1 - Math.pow(1 - k, 3);
      this.setView(this.view.tx, from + (target - from) * e, this.view.z);
      if (k < 1) requestAnimationFrame(step); else this.settle();
    };
    requestAnimationFrame(step);
  }

  // Centro visible de una página (para pegar o insertar).
  visibleCenterOn(page) {
    const { w, h } = this.vpSize();
    const c = { x: (w / 2 - this.view.tx) / this.view.z, y: (h / 2 - this.view.ty) / this.view.z };
    const r = this.rects.get(page.id);
    let x = c.x - r.x, y = c.y - r.y;
    if (!page.infinite) { x = clamp(x, 40, page.w - 40); y = clamp(y, 40, page.h - 40); }
    return { x, y };
  }

  // ================= Entrada =================
  bindInput() {
    const vp = this.viewport;
    const isEditable = t => t && t.closest && t.closest('.tb.editing, .tb-handle');
    this.h = {
      down: e => this.onDown(e),
      move: e => this.onMove(e),
      up: e => this.onUp(e, false),
      cancel: e => this.onUp(e, true),
      leave: e => { if (e.pointerType !== 'touch' && !this.active) this.hideCursor(); },
      wheel: e => this.onWheel(e),
      touch: e => { if (!isEditable(e.target)) e.preventDefault(); },
      ctx: e => e.preventDefault(),
      key: e => this.onKey(e),
      keyup: e => { if (e.code === 'Space') this.spaceDown = false; },
      paste: e => this.onPaste(e),
      gesture: e => e.preventDefault(),
    };
    vp.addEventListener('pointerdown', this.h.down);
    vp.addEventListener('pointermove', this.h.move);
    vp.addEventListener('pointerup', this.h.up);
    vp.addEventListener('pointercancel', this.h.cancel);
    vp.addEventListener('pointerleave', this.h.leave);
    vp.addEventListener('wheel', this.h.wheel, { passive: false });
    vp.addEventListener('touchstart', this.h.touch, { passive: false });
    vp.addEventListener('touchmove', this.h.touch, { passive: false });
    vp.addEventListener('contextmenu', this.h.ctx);
    document.addEventListener('gesturestart', this.h.gesture);
    window.addEventListener('keydown', this.h.key);
    window.addEventListener('keyup', this.h.keyup);
    window.addEventListener('paste', this.h.paste);
  }

  unbindInput() {
    document.removeEventListener('gesturestart', this.h.gesture);
    window.removeEventListener('keydown', this.h.key);
    window.removeEventListener('keyup', this.h.keyup);
    window.removeEventListener('paste', this.h.paste);
  }

  onDown(e) {
    if (e.target.closest('.tb.editing, .tb-handle')) return;
    const now = performance.now();
    this.stopInertia();
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (this.active && this.active.type !== 'touch') return;
      const n = this.touches.size;
      if (n === 1) {
        this.tap = { t: now, n: 1, moved: false };
        if (state.settings.fingerDraw && this.toolName !== 'hand' && now - this.lastPen > 1500) this.startTool(e);
        else this.startPan(e);
      } else if (n === 2) {
        if (this.active) this.cancelTool();
        if (this.tap && now - this.tap.t < 250) this.tap.n = 2; else this.tap = null;
        this.startPinch();
      } else if (n === 3 && this.tap && now - this.tap.t < 350) this.tap.n = 3;
      return;
    }
    if (e.pointerType === 'pen') this.lastPen = now;
    if (e.pointerType === 'mouse' && (e.button === 1 || this.spaceDown)) { this.startPan(e); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.active) return;
    if (this.mode === 'pan' || this.mode === 'pinch') {
      // La palma tocó justo antes que el lápiz: se deshace ese pequeño desplazamiento.
      if (e.pointerType === 'pen' && this.pan?.v0 && now - this.pan.t0 < 400) this.setView(this.pan.v0.tx, this.pan.v0.ty, this.pan.v0.z);
      this.mode = null; this.touches.clear(); this.tap = null; this.settleSoon();
    }
    if (this.toolName === 'hand') { this.startPan(e); return; }
    this.startTool(e);
  }

  startTool(e) {
    const w = this.clientToWorld(e.clientX, e.clientY);
    const page = this.pageAtWorld(w.x, w.y);
    const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) || (e.buttons & 2));
    const name = penEraser ? 'eraser' : this.toolName;
    if (this.editing) {
      this.finishTextEdit();
      if (name === 'text') return;
    }
    if (!page) { if (this.sel) this.clearSelection(); return; }
    if (this.sel && (name !== 'lasso' || this.sel.pageId !== page.id)) this.clearSelection();
    const pv = this.pvs.get(page.id);
    if (!pv) return;
    const tool = this.tools[name];
    if (!tool) return;
    try { this.viewport.setPointerCapture(e.pointerId); } catch { /* nada */ }
    this.active = { tool, name, pointerId: e.pointerId, type: e.pointerType, page, pv, rect: this.rects.get(page.id) };
    tool.down(this.ctx(e));
  }

  ctx(ev) {
    const a = this.active;
    const w = this.clientToWorld(ev.clientX, ev.clientY);
    const p = ev.pointerType === 'pen' ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5;
    return { page: a.page, pv: a.pv, x: w.x - a.rect.x, y: w.y - a.rect.y, p, type: ev.pointerType };
  }

  onMove(e) {
    const t = this.touches.get(e.pointerId);
    if (t) {
      t.x = e.clientX; t.y = e.clientY;
      if (this.tap && Math.hypot(t.x - t.x0, t.y - t.y0) > 10) this.tap.moved = true;
    }
    if (this.active && e.pointerId === this.active.pointerId) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (evs.length ? evs : [e])) this.active.tool.move(this.ctx(ev));
      return;
    }
    if (this.mode === 'pan' && e.pointerId === this.pan.id) {
      const now = performance.now();
      const dx = e.clientX - this.pan.x, dy = e.clientY - this.pan.y, dt = Math.max(1, now - this.pan.t);
      this.pan.vx = this.pan.vx * 0.7 + (dx / dt) * 0.3;
      this.pan.vy = this.pan.vy * 0.7 + (dy / dt) * 0.3;
      this.pan.x = e.clientX; this.pan.y = e.clientY; this.pan.t = now;
      this.setView(this.view.tx + dx, this.view.ty + dy, this.view.z);
      return;
    }
    if (this.mode === 'pinch' && t) { this.updatePinch(); return; }
    if (!this.active && e.pointerType !== 'touch' && e.buttons === 0) {
      if (this.toolName === 'eraser') {
        const w = this.clientToWorld(e.clientX, e.clientY);
        this.showCursorAt(e.clientX, e.clientY, this.opts.eraser.size, !!this.pageAtWorld(w.x, w.y));
      }
    }
  }

  onUp(e, cancelled) {
    if (this.active && e.pointerId === this.active.pointerId) {
      const a = this.active;
      if (cancelled && a.type === 'touch') a.tool.cancel();
      else a.tool.up(this.ctx(e));
      this.active = null;
      if (a.name === 'eraser' && e.pointerType === 'touch') this.hideCursor();
      if (a.name === 'eraser' && e.pointerType === 'pen') this.hideCursor();
    }
    if (this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId);
      if (this.touches.size === 0) {
        const tap = this.tap;
        this.tap = null;
        if (!cancelled && tap && !tap.moved && tap.n >= 2 && performance.now() - tap.t < 400 && state.settings.twoFingerUndo) {
          if (tap.n === 2) this.undo(); else this.redo();
        }
      }
      if (this.mode === 'pinch' && this.touches.size < 2) {
        this.mode = null;
        if (this.touches.size === 1) {
          const [id, t] = [...this.touches][0];
          this.mode = 'pan';
          this.pan = { id, x: t.x, y: t.y, t: performance.now(), vx: 0, vy: 0 };
        } else this.settleSoon();
      } else if (this.mode === 'pan' && this.pan && e.pointerId === this.pan.id) {
        this.mode = null;
        this.startInertia();
      }
      return;
    }
    if (this.mode === 'pan' && this.pan && e.pointerId === this.pan.id) {
      this.mode = null;
      this.settleSoon();
    }
  }

  cancelTool() {
    if (!this.active) return;
    this.active.tool.cancel();
    this.active = null;
  }

  startPan(e) {
    if (this.editing) this.finishTextEdit();
    this.mode = 'pan';
    const now = performance.now();
    this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now, t0: now, v0: { ...this.view }, vx: 0, vy: 0 };
    try { this.viewport.setPointerCapture(e.pointerId); } catch { /* nada */ }
    this.moving();
  }

  startPinch() {
    const [a, b] = [...this.touches.values()];
    this.mode = 'pinch';
    this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v0: { ...this.view } };
    this.moving();
  }

  updatePinch() {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const p = this.pinch, r = this.viewport.getBoundingClientRect();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const [zmin, zmax] = this.zLimits();
    const z = clamp(p.v0.z * (d / p.d0), zmin, zmax);
    const wx = (p.mx - r.left - p.v0.tx) / p.v0.z, wy = (p.my - r.top - p.v0.ty) / p.v0.z;
    this.setView(mx - r.left - wx * z, my - r.top - wy * z, z);
  }

  startInertia() {
    let { vx, vy } = this.pan;
    if (performance.now() - this.pan.t > 80 || Math.hypot(vx, vy) < 0.25) { this.settleSoon(); return; }
    let last = performance.now();
    const step = now => {
      const dt = Math.min(40, now - last);
      last = now;
      const before = { ...this.view };
      this.setView(this.view.tx + vx * dt, this.view.ty + vy * dt, this.view.z);
      const decay = Math.pow(0.94, dt / 16);
      vx *= decay; vy *= decay;
      const stuck = before.tx === this.view.tx && before.ty === this.view.ty;
      if (Math.hypot(vx, vy) > 0.03 && !stuck) this.inertia = requestAnimationFrame(step);
      else { this.inertia = 0; this.settleSoon(); }
    };
    this.inertia = requestAnimationFrame(step);
  }

  stopInertia() {
    if (this.inertia) { cancelAnimationFrame(this.inertia); this.inertia = 0; }
  }

  onWheel(e) {
    e.preventDefault();
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 18; dy *= 18; } else if (e.deltaMode === 2) { dx *= this.vpSize().w; dy *= this.vpSize().h; }
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(Math.exp(-dy * 0.0075), e.clientX, e.clientY);
      return;
    }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    this.moving();
    this.setView(this.view.tx - dx, this.view.ty - dy, this.view.z);
    this.settleSoon();
  }

  onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (this.editing || tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
      if (e.key === 'Escape' && this.editing) { e.preventDefault(); this.finishTextEdit(); }
      return;
    }
    if (document.querySelector('.modal-back')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && k === 'c' && this.sel) { e.preventDefault(); this.copySelection(); return; }
    if (mod && k === 'x' && this.sel) { e.preventDefault(); this.copySelection(); this.deleteSelection(); return; }
    if (mod && k === 'd' && this.sel) { e.preventDefault(); this.duplicateSelection(); return; }
    if (mod && (k === '+' || k === '=')) { e.preventDefault(); this.zoomBy(1.2); return; }
    if (mod && k === '-') { e.preventDefault(); this.zoomBy(1 / 1.2); return; }
    if (mod && k === '0') { e.preventDefault(); this.fitWidth(); return; }
    if (mod) return;
    if ((k === 'delete' || k === 'backspace') && this.sel) { e.preventDefault(); this.deleteSelection(); return; }
    if (k === 'escape') { this.clearSelection(); return; }
    if (e.code === 'Space') { this.spaceDown = true; return; }
    const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', t: 'text', s: 'shape', m: 'hand' };
    if (map[k]) { this.setTool(map[k]); this.ui.onTool?.(); return; }
    if (!this.isBoard && (k === 'pagedown' || k === 'arrowright')) { this.goToPage(this.currentPageIndex() + 1); }
    if (!this.isBoard && (k === 'pageup' || k === 'arrowleft')) { this.goToPage(this.currentPageIndex() - 1); }
  }

  async onPaste(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (this.editing || tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (document.querySelector('.modal-back')) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); await this.insertImages(files); return; }
    const text = e.clipboardData?.getData('text/plain');
    if (clipboard && !text) { e.preventDefault(); this.paste(); return; }
    if (text) {
      e.preventDefault();
      const page = this.currentPage();
      const c = this.visibleCenterOn(page);
      this.addTextBox(page, c.x - 150, c.y, text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])).replace(/\n/g, '<br>'));
    }
  }

  // ================= Cursor del borrador =================
  showCursor(c, size) {
    const r = this.viewport.getBoundingClientRect();
    const sx = r.left + this.view.tx + (c.x + this.active.rect.x) * this.view.z;
    const sy = r.top + this.view.ty + (c.y + this.active.rect.y) * this.view.z;
    this.showCursorAt(sx, sy, size, true);
  }

  showCursorAt(cx, cy, size, visible) {
    const rr = this.root.getBoundingClientRect();
    Object.assign(this.cursor.style, {
      display: visible ? 'block' : 'none', width: size * 2 + 'px', height: size * 2 + 'px',
      transform: `translate(${cx - rr.left - size}px, ${cy - rr.top - size}px)`,
    });
  }

  hideCursor() { this.cursor.style.display = 'none'; }

  // ================= Herramientas =================
  setTool(name) {
    if (this.editing) this.finishTextEdit();
    if (name !== 'lasso' && this.sel) this.clearSelection();
    this.toolName = name;
    this.viewport.dataset.tool = name;
    if (name !== 'eraser') this.hideCursor();
  }

  saveToolOpts = debounce(() => {
    import('./store.js').then(m => m.setSetting('toolOpts', this.opts));
  }, 800);

  haptic() { try { navigator.vibrate?.(12); } catch { /* nada */ } }

  // ================= Cambios, deshacer y rehacer =================
  change(pageId, fn) {
    const page = this.pageById.get(pageId);
    const before = snapPage(page);
    fn(page);
    this.commitFrom(pageId, before);
  }

  commitFrom(pageId, before) {
    const page = this.pageById.get(pageId);
    this.pushHistory({ type: 'page', pageId, before, after: snapPage(page) });
    this.pvs.get(pageId)?.refresh();
    this.markDirty(pageId);
  }

  pushHistory(a) {
    this.history.push(a);
    if (this.history.length > 300) this.history.shift();
    this.future = [];
    this.ui.onHistory?.();
  }

  canUndo() { return this.history.length > 0; }
  canRedo() { return this.future.length > 0; }

  undo() {
    if (this.editing) this.finishTextEdit();
    const a = this.history.pop();
    if (!a) return;
    this.applyAction(a, 'before');
    this.future.push(a);
    this.ui.onHistory?.();
  }

  redo() {
    if (this.editing) this.finishTextEdit();
    const a = this.future.pop();
    if (!a) return;
    this.applyAction(a, 'after');
    this.history.push(a);
    this.ui.onHistory?.();
  }

  applyAction(a, which) {
    this.clearSelection();
    if (a.type === 'page') {
      const page = this.pageById.get(a.pageId);
      if (!page) return;
      const s = a[which];
      page.strokes = s.strokes.slice();
      page.texts = s.texts.slice();
      page.images = s.images.slice();
      this.pvs.get(a.pageId)?.refresh();
      this.markDirty(a.pageId);
      const idx = this.pages.indexOf(page);
      if (!this.isBoard && this.pvs.get(a.pageId) == null) this.goToPage(idx);
    } else if (a.type === 'pages') {
      this.setPageOrder(a[which], a.pages);
    } else if (a.type === 'pagebg') {
      const page = this.pageById.get(a.pageId);
      page.bg = { ...a[which] };
      this.pvs.get(page.id)?.renderPaper();
      this.markDirty(page.id);
    } else if (a.type === 'pagefmt') {
      for (const ch of a.list) {
        const page = this.pageById.get(ch.pageId);
        if (page) this.applyPageFormat(page, ch[which], false);
      }
      this.relayout();
    }
  }

  markDirty(pageId) {
    this.changed = true;
    this.dirty.add(pageId);
    this.ui.onDirty?.(true);
    this.saveSoon();
  }

  async save() {
    const ids = [...this.dirty];
    this.dirty.clear();
    const pages = ids.map(id => this.pageById.get(id)).filter(Boolean);
    if (!pages.length) return;
    try {
      await savePages(pages);
      this.item.updated = Date.now();
      await saveItem(this.item, { silent: true });
      await this.indexTyped(pages);
      this.ui.onDirty?.(false);
      this.thumbSoon();
    } catch (e) {
      console.error(e);
      for (const id of ids) this.dirty.add(id);
      this.ui.onError?.('No se pudo guardar: ' + e.message);
    }
  }

  async indexTyped(pages) {
    const entries = pages.map(p => ({ docId: this.item.id, pageId: p.id, source: 'typed', text: p.texts.map(t => htmlToText(t.html)).join('\n') }));
    // Textos de imágenes que ya no están en la página.
    const existing = await getDocTexts(this.item.id);
    for (const t of existing) {
      if (!t.source.startsWith('img:')) continue;
      const page = this.pageById.get(t.pageId);
      if (page && pages.includes(page) && !page.images.some(im => 'img:' + im.id === t.source)) entries.push({ docId: t.docId, pageId: t.pageId, source: t.source, text: '' });
    }
    await setTexts(entries);
  }

  async updateThumb() {
    try {
      const page = this.pages[0];
      if (!page) return;
      this.item.thumb = await makeThumb(page);
      await saveItem(this.item, { silent: true });
    } catch (e) { console.warn('Miniatura', e); }
  }

  async flush() {
    if (this.editing) this.finishTextEdit();
    this.saveSoon.cancel();
    await this.save();
    this.thumbSoon.cancel();
    if (this.changed) await this.updateThumb();
  }

  // ================= Selección =================
  setSelection(sel) {
    this.sel = sel;
    this.showSelection();
  }

  selObjects() {
    const s = this.sel, page = this.pageById.get(s.pageId);
    return {
      page,
      strokes: page.strokes.filter(x => s.strokes.has(x.id)),
      texts: page.texts.filter(x => s.texts.has(x.id)),
      images: page.images.filter(x => s.images.has(x.id)),
    };
  }

  showSelection() {
    const pv = this.sel && this.pvs.get(this.sel.pageId);
    if (!pv) return;
    const o = this.selObjects();
    // Alturas reales de los textos.
    for (const t of o.texts) { const r = pv.textEls.get(t.id); if (r) t.h = r.el.offsetHeight; }
    const b = selectionBox(o.strokes, o.texts, o.images);
    if (!b) { this.clearSelection(); return; }
    this.sel.box = b;
    pv.selG.innerHTML = '';
    const z = this.view.z;
    pv.selG.appendChild(svgEl('rect', {
      x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1, fill: 'rgba(58,109,240,0.05)',
      stroke: '#3a6df0', 'stroke-width': 1.5 / z, 'stroke-dasharray': `${6 / z} ${4 / z}`,
    }));
    pv.selG.appendChild(svgEl('circle', { cx: b.x2, cy: b.y2, r: 9 / z, fill: '#fff', stroke: '#3a6df0', 'stroke-width': 2 / z, class: 'sel-handle' }));
    this.ui.onSelection?.(true);
    this.positionSelBar(true);
  }

  hideSelBar() { this.selBar.classList.add('hidden'); }

  positionSelBar(show) {
    if (!this.sel || !this.sel.box) return;
    const r = this.rects.get(this.sel.pageId);
    const b = this.sel.box, v = this.view;
    const x = v.tx + (r.x + (b.x1 + b.x2) / 2) * v.z;
    let y = v.ty + (r.y + b.y1) * v.z - 54;
    if (y < 8) y = v.ty + (r.y + b.y2) * v.z + 14;
    const { w } = this.vpSize();
    const bw = this.selBar.offsetWidth || 300;
    this.selBar.style.transform = `translate(${clamp(x - bw / 2, 8, w - bw - 8)}px, ${clamp(y, 8, this.vpSize().h - 60)}px)`;
    if (show) this.selBar.classList.remove('hidden');
  }

  clearSelection() {
    if (!this.sel) return;
    const pv = this.pvs.get(this.sel.pageId);
    if (pv) { pv.selG.innerHTML = ''; pv.selG.removeAttribute('transform'); }
    this.sel = null;
    this.hideSelBar();
    this.ui.onSelection?.(false);
  }

  transformSelection(fx, f) {
    const s = this.sel;
    this.change(s.pageId, p => {
      p.strokes = p.strokes.map(x => (s.strokes.has(x.id) ? mapStroke(x, fx, f) : x));
      p.texts = p.texts.map(t => {
        if (!s.texts.has(t.id)) return t;
        const [x, y] = fx(t.x, t.y);
        return { ...t, x, y, w: t.w * f, size: (t.size || 18) * f, h: t.h ? t.h * f : t.h };
      });
      p.images = p.images.map(im => {
        if (!s.images.has(im.id)) return im;
        const [x, y] = fx(im.x, im.y);
        return { ...im, x, y, w: im.w * f, h: im.h * f };
      });
    });
    this.showSelection();
  }

  deleteSelection() {
    const s = this.sel;
    if (!s) return;
    this.change(s.pageId, p => {
      p.strokes = p.strokes.filter(x => !s.strokes.has(x.id));
      p.texts = p.texts.filter(x => !s.texts.has(x.id));
      p.images = p.images.filter(x => !s.images.has(x.id));
    });
    this.clearSelection();
  }

  copySelection() {
    if (!this.sel) return;
    const o = this.selObjects();
    clipboard = { strokes: o.strokes, texts: o.texts, images: o.images, box: { ...this.sel.box } };
    this.ui.onClipboard?.();
  }

  hasClipboard() { return !!clipboard; }

  pasteObjects(page, src, dx, dy) {
    const sel = { pageId: page.id, strokes: new Set(), texts: new Set(), images: new Set() };
    const fx = (x, y) => [x + dx, y + dy];
    this.change(page.id, p => {
      for (const s of src.strokes) { const n = { ...mapStroke(s, fx, 1), id: uid() }; p.strokes.push(n); sel.strokes.add(n.id); }
      for (const t of src.texts) { const n = { ...t, id: uid(), x: t.x + dx, y: t.y + dy }; p.texts.push(n); sel.texts.add(n.id); }
      for (const im of src.images) { const n = { ...im, id: uid(), x: im.x + dx, y: im.y + dy }; p.images.push(n); sel.images.add(n.id); }
    });
    this.setTool('lasso');
    this.ui.onTool?.();
    requestAnimationFrame(() => this.setSelection(sel));
  }

  duplicateSelection() {
    if (!this.sel) return;
    const o = this.selObjects();
    const off = 24;
    this.clearSelection();
    this.pasteObjects(o.page, o, off, off);
  }

  paste() {
    if (!clipboard) return;
    const page = this.currentPage();
    const c = this.visibleCenterOn(page);
    const b = clipboard.box;
    this.clearSelection();
    this.pasteObjects(page, clipboard, c.x - (b.x1 + b.x2) / 2, c.y - (b.y1 + b.y2) / 2);
  }

  recolorSelection(color) {
    const s = this.sel;
    if (!s) return;
    this.change(s.pageId, p => {
      p.strokes = p.strokes.map(x => (s.strokes.has(x.id) ? { ...x, c: color, ...(x.fill ? { fill: color } : {}) } : x));
      p.texts = p.texts.map(t => (s.texts.has(t.id) ? { ...t, color, html: t.html.replace(/ style="color:[^"]*"/g, '') } : t));
    });
    this.showSelection();
  }

  objectAt(page, x, y, r) {
    for (let i = page.texts.length - 1; i >= 0; i--) {
      const t = page.texts[i];
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + (t.h || 30)) return { kind: 'texts', id: t.id };
    }
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      if (hitStroke(page.strokes[i], x, y, r)) return { kind: 'strokes', id: page.strokes[i].id };
    }
    for (let i = page.images.length - 1; i >= 0; i--) {
      const im = page.images[i];
      if (x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h) return { kind: 'images', id: im.id };
    }
    return null;
  }

  textAt(page, x, y) {
    const pv = this.pvs.get(page.id);
    for (let i = page.texts.length - 1; i >= 0; i--) {
      const t = page.texts[i];
      const hgt = pv?.textEls.get(t.id)?.el.offsetHeight || t.h || 30;
      if (x >= t.x - 4 && x <= t.x + t.w + 4 && y >= t.y - 4 && y <= t.y + hgt + 4) return t;
    }
    return null;
  }

  // ================= Cajas de texto =================
  createText(pageId, x, y) {
    const page = this.pageById.get(pageId);
    const o = this.opts.text;
    const w = page.infinite ? 340 : clamp(page.w - x - 24, 120, 460);
    const before = snapPage(page);
    const t = { id: uid(), x: x - 6, y: y - o.size * 0.8, w, html: '', size: o.size, color: o.color };
    page.texts.push(t);
    const pv = this.pvs.get(pageId);
    pv.refreshTexts();
    this.beginEdit(pageId, t.id, before);
  }

  addTextBox(page, x, y, html) {
    const o = this.opts.text;
    const w = page.infinite ? 340 : clamp(page.w - x - 24, 160, 460);
    this.change(page.id, p => { p.texts.push({ id: uid(), x, y, w, html, size: o.size, color: o.color }); });
  }

  editText(pageId, id) {
    const page = this.pageById.get(pageId);
    this.beginEdit(pageId, id, snapPage(page));
  }

  beginEdit(pageId, id, before) {
    const pv = this.pvs.get(pageId);
    const rec = pv?.textEls.get(id);
    if (!rec) return;
    const el = rec.el;
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.classList.add('editing');
    const grip = h('div', { class: 'tb-handle grip', title: 'Mover' });
    const resize = h('div', { class: 'tb-handle resize', title: 'Ancho' });
    pv.textLayer.append(grip, resize);
    this.editing = { pageId, id, el, before, grip, resize, pv };
    const place = () => {
      const t = this.pageById.get(pageId).texts.find(x => x.id === id);
      if (!t) return;
      grip.style.left = t.x - 26 + 'px';
      grip.style.top = t.y - 4 + 'px';
      resize.style.left = t.x + t.w - 6 + 'px';
      resize.style.top = t.y + el.offsetHeight / 2 - 14 + 'px';
    };
    this.editing.place = place;
    place();
    el.addEventListener('input', place);
    this.editing.onInput = place;
    this.dragHandle(grip, (dx, dy) => this.patchEditing(t => ({ x: t.x + dx, y: t.y + dy })));
    this.dragHandle(resize, dx => this.patchEditing(t => ({ w: Math.max(60, t.w + dx) })));
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    this.editing.onBlur = () => setTimeout(() => {
      if (this.editing && this.editing.el === el && document.activeElement !== el && !this.editing.keep) this.finishTextEdit();
    }, 200);
    el.addEventListener('blur', this.editing.onBlur);
    this.ui.onTextEdit?.(true);
  }

  // Cambia la caja en edición sin pasar por el historial (se guarda al terminar).
  patchEditing(fn) {
    const ed = this.editing;
    if (!ed) return;
    const page = this.pageById.get(ed.pageId);
    const i = page.texts.findIndex(t => t.id === ed.id);
    if (i < 0) return;
    const t = { ...page.texts[i], ...fn(page.texts[i]) };
    page.texts[i] = t;
    applyTextStyle(ed.el, t);
    ed.pv.textEls.get(t.id).t = t;
    ed.place();
  }

  editingText() {
    if (!this.editing) return null;
    return this.pageById.get(this.editing.pageId).texts.find(t => t.id === this.editing.id);
  }

  dragHandle(el, onDelta) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      if (this.editing) this.editing.keep = true;
      let lx = e.clientX, ly = e.clientY;
      const mv = ev => {
        const dx = (ev.clientX - lx) / this.view.z, dy = (ev.clientY - ly) / this.view.z;
        lx = ev.clientX; ly = ev.clientY;
        onDelta(dx, dy);
      };
      const up = () => {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (this.editing) { this.editing.keep = false; this.editing.el.focus({ preventScroll: true }); }
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  }

  finishTextEdit() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const { el, pageId, id, before, pv } = ed;
    el.removeEventListener('blur', ed.onBlur);
    el.removeEventListener('input', ed.onInput);
    el.contentEditable = 'false';
    el.classList.remove('editing');
    ed.grip.remove();
    ed.resize.remove();
    const page = this.pageById.get(pageId);
    const i = page.texts.findIndex(t => t.id === id);
    if (i >= 0) {
      const html = sanitizeHtml(el.innerHTML);
      if (!htmlToText(html).trim()) page.texts.splice(i, 1);
      else page.texts[i] = { ...page.texts[i], html, h: el.offsetHeight };
    }
    const after = snapPage(page);
    const changed = JSON.stringify(before.texts) !== JSON.stringify(after.texts);
    pv.refreshTexts();
    if (changed) {
      this.pushHistory({ type: 'page', pageId, before, after });
      this.markDirty(pageId);
    }
    try { window.getSelection().removeAllRanges(); } catch { /* nada */ }
    if (document.activeElement === el) el.blur();
    this.ui.onTextEdit?.(false);
  }

  // ================= Imágenes =================
  async insertImages(files, page) {
    page = page || this.currentPage();
    const out = [];
    for (const f of files) {
      const blobId = await putBlob(f, { name: f.name, type: f.type });
      const url = await getBlobURL(blobId);
      let img;
      try { img = await loadImage(url); } catch { continue; }
      const c = this.visibleCenterOn(page);
      const maxW = page.infinite ? 520 : page.w * 0.7, maxH = page.infinite ? 520 : page.h * 0.6;
      const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const w = img.naturalWidth * k, hh = img.naturalHeight * k;
      const off = out.length * 24;
      out.push({ id: uid(), blobId, x: c.x - w / 2 + off, y: c.y - hh / 2 + off, w, h: hh, name: f.name });
    }
    if (!out.length) return [];
    this.change(page.id, p => { p.images.push(...out); });
    this.ui.onImagesAdded?.(page, out);
    return out;
  }

  // ================= Páginas =================
  setPageOrder(ids, pagesMap) {
    const cur = new Set(this.item.pageIds);
    const next = new Set(ids);
    const added = ids.filter(id => !cur.has(id)).map(id => pagesMap.get(id) || this.pageById.get(id)).filter(Boolean);
    const removed = [...cur].filter(id => !next.has(id));
    for (const p of added) this.pageById.set(p.id, p);
    this.item.pageIds = ids.slice();
    this.pages = ids.map(id => this.pageById.get(id)).filter(Boolean);
    for (const id of removed) {
      this.pvs.get(id)?.destroy();
      this.pvs.delete(id);
    }
    (async () => {
      if (added.length) await savePages(added);
      if (removed.length) await deletePages(removed);
      await saveItem(this.item, { silent: true });
      this.thumbSoon();
    })();
    this.computeLayout();
    this.setView(this.view.tx, this.view.ty, this.view.z);
    this.ui.onPages?.();
  }

  changePages(ids) {
    const before = this.item.pageIds.slice();
    const pagesMap = new Map(this.pageById);
    this.setPageOrder(ids, pagesMap);
    this.pushHistory({ type: 'pages', before, after: ids.slice(), pages: pagesMap });
  }

  addPage(afterIndex, opts = {}) {
    if (this.isBoard) return;
    const ref = this.pages[Math.max(0, Math.min(afterIndex, this.pages.length - 1))];
    const sz = opts.size ? PAGE_SIZES[opts.size] : null;
    const isPdf = ref?.bg.type === 'pdf';
    const p = newPage(this.item.id, {
      w: sz ? sz.w : ref?.w || 794, h: sz ? sz.h : ref?.h || 1123,
      paper: opts.paper || (isPdf ? 'blank' : ref?.bg.type || this.item.paper || 'lined'),
      paperColor: opts.paperColor || (isPdf ? '#ffffff' : ref?.bg.color || '#ffffff'),
    });
    this.pageById.set(p.id, p);
    const ids = this.item.pageIds.slice();
    ids.splice(afterIndex + 1, 0, p.id);
    this.changePages(ids);
    this.goToPage(afterIndex + 1);
    return p;
  }

  duplicatePage(i) {
    const src = this.pages[i];
    const p = { ...structuredClone(src), id: uid() };
    p.strokes = src.strokes.map(s => ({ ...s, id: uid(), pts: new Float32Array(s.pts) }));
    p.texts = src.texts.map(t => ({ ...t, id: uid() }));
    p.images = src.images.map(im => ({ ...im, id: uid() }));
    this.pageById.set(p.id, p);
    const ids = this.item.pageIds.slice();
    ids.splice(i + 1, 0, p.id);
    this.changePages(ids);
    this.goToPage(i + 1);
  }

  deletePage(i) {
    if (this.pages.length <= 1) return false;
    const ids = this.item.pageIds.slice();
    ids.splice(i, 1);
    this.changePages(ids);
    return true;
  }

  movePage(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= this.pages.length) return;
    const ids = this.item.pageIds.slice();
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.changePages(ids);
    this.goToPage(j);
  }

  setPageBackground(i, bg) {
    this.setPagesFormat([i], { bg });
  }

  // Cambia papel, color y/o tamaño de varias páginas (no PDF) en un solo paso de deshacer.
  setPagesFormat(indices, { bg, w, h }) {
    const list = [];
    for (const i of indices) {
      const page = this.pages[i];
      if (!page || page.bg.type === 'pdf' || page.infinite) continue;
      const before = { bg: { ...page.bg }, w: page.w, h: page.h };
      const after = { bg: { ...page.bg, ...(bg || {}) }, w: w || page.w, h: h || page.h };
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      list.push({ pageId: page.id, before, after });
      this.applyPageFormat(page, after, false);
    }
    if (!list.length) return;
    this.pushHistory({ type: 'pagefmt', list });
    this.relayout();
  }

  applyPageFormat(page, f, relayout = true) {
    const resized = page.w !== f.w || page.h !== f.h;
    page.bg = { ...f.bg };
    page.w = f.w;
    page.h = f.h;
    const pv = this.pvs.get(page.id);
    if (pv && resized) { pv.destroy(); this.pvs.delete(page.id); } else pv?.renderPaper();
    this.markDirty(page.id);
    if (relayout) this.relayout();
  }

  relayout() {
    this.computeLayout();
    this.setView(this.view.tx, this.view.ty, this.view.z);
    this.updateVisible();
    this.ui.onPages?.();
  }

  // ================= Cierre =================
  start(pageIndex = 0) {
    this.setTool(state.settings.tool || 'pen');
    this.initialView(pageIndex);
    this.started = true;
  }

  async destroy() {
    await this.flush();
    this.ro.disconnect();
    this.unbindInput();
    this.stopInertia();
    for (const pv of this.pvs.values()) pv.destroy();
    this.pvs.clear();
    this.root.remove();
    emit('items', { id: this.item.id, type: 'update' });
  }
}
