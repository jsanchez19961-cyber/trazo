// Dibuja una página completa en una imagen (miniaturas, exportar PNG, OCR, IA).
import { strokePath, arrowPath, selectionBox } from './ink.js';
import { drawPaper } from './paper.js';
import { renderPdfPage } from './pdfdoc.js';
import { getBlobURL } from './store.js';
import { loadImage, htmlToText } from './util.js';

export const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const TEXT_PAD_X = 6, TEXT_PAD_Y = 4, TEXT_LH = 1.35;

export function contentBounds(page, margin = 40) {
  const b = selectionBox(page.strokes, page.texts, page.images);
  if (!b) return null;
  return { x1: b.x1 - margin, y1: b.y1 - margin, x2: b.x2 + margin, y2: b.y2 + margin };
}

export function pageBounds(page) {
  if (!page.infinite) return { x1: 0, y1: 0, x2: page.w, y2: page.h };
  return contentBounds(page) || { x1: 0, y1: 0, x2: 800, y2: 600 };
}

export async function renderPageCanvas(page, { scale = 1, maxPixels = 16e6, region } = {}) {
  const b = region || pageBounds(page);
  const W = b.x2 - b.x1, H = b.y2 - b.y1;
  scale = Math.min(scale, Math.sqrt(maxPixels / Math.max(1, W * H)));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(W * scale));
  cv.height = Math.max(1, Math.round(H * scale));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = page.bg.color || '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (page.bg.type === 'pdf') {
    try {
      const tmp = document.createElement('canvas');
      const full = { x1: 0, y1: 0, x2: page.w, y2: page.h };
      const isFull = !region || (b.x1 === 0 && b.y1 === 0 && b.x2 === page.w && b.y2 === page.h);
      await renderPdfPage(page.bg.blobId, page.bg.page, tmp, scale, {}, 'print');
      if (isFull) ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
      else {
        const kx = tmp.width / (full.x2 - full.x1), ky = tmp.height / (full.y2 - full.y1);
        ctx.drawImage(tmp, b.x1 * kx, b.y1 * ky, W * kx, H * ky, 0, 0, cv.width, cv.height);
      }
    } catch (e) { console.warn('PDF no disponible para la imagen', e); }
  }
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-b.x1, -b.y1);
  if (!page.infinite && page.bg.type !== 'pdf') drawPaper(ctx, page.bg.type, page.w, page.h);
  for (const im of page.images) {
    try {
      const img = await loadImage(await getBlobURL(im.blobId));
      ctx.drawImage(img, im.x, im.y, im.w, im.h);
    } catch { /* imagen perdida */ }
  }
  ctx.globalCompositeOperation = 'multiply';
  for (const s of page.strokes) {
    if (s.t !== 'hl') continue;
    ctx.globalAlpha = s.op ?? 0.45;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(strokePath(s)));
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  for (const t of page.texts) drawTextBox(ctx, t);
  for (const s of page.strokes) {
    if (s.t === 'pen') {
      ctx.fillStyle = s.c;
      ctx.fill(new Path2D(strokePath(s)));
    } else if (s.t === 'line') {
      const p = new Path2D(strokePath(s));
      if (s.fill) { ctx.globalAlpha = 0.35; ctx.fillStyle = s.fill; ctx.fill(p); ctx.globalAlpha = 1; }
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.stroke(p);
      if (s.arrow) ctx.stroke(new Path2D(arrowPath(s)));
    }
  }
  ctx.restore();
  return cv;
}

export function wrapText(measure, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (measure(test) <= maxW || !line.trim()) line = test;
      else { out.push(line.trimEnd()); line = word.trimStart(); }
      while (measure(line) > maxW && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && measure(line.slice(0, k)) > maxW) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function drawTextBox(ctx, t) {
  const size = t.size || 18;
  ctx.font = `${size}px ${TEXT_FONT}`;
  ctx.fillStyle = t.color || '#1d1d1f';
  ctx.textBaseline = 'alphabetic';
  const lines = wrapText(s => ctx.measureText(s).width, htmlToText(t.html), t.w - TEXT_PAD_X * 2);
  const lh = size * TEXT_LH;
  let y = t.y + TEXT_PAD_Y + (lh - size) / 2 + size * 0.85;
  for (const line of lines) {
    let x = t.x + TEXT_PAD_X;
    if (t.align === 'center') x = t.x + (t.w - ctx.measureText(line).width) / 2;
    else if (t.align === 'right') x = t.x + t.w - TEXT_PAD_X - ctx.measureText(line).width;
    ctx.fillText(line, x, y);
    y += lh;
  }
  if (t.box) {
    ctx.strokeStyle = t.color || '#1d1d1f';
    ctx.lineWidth = 1.5;
    const hgt = t.h || (lines.length * lh + TEXT_PAD_Y * 2);
    ctx.strokeRect(t.x, t.y, t.w, hgt);
  }
}

export async function makeThumb(page, width = 320) {
  const b = pageBounds(page);
  const cv = await renderPageCanvas(page, { scale: width / (b.x2 - b.x1), maxPixels: 600000 });
  return cv.toDataURL('image/jpeg', 0.72);
}
