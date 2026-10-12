// Exportar: PDF con anotaciones (vectorial), imagen PNG de una página y texto (Markdown).
import { loadPdfLib } from './libs.js';
import { getBlobRecord, getPages, getDocTexts, state } from './store.js';
import { pdfPageMatrix } from './pdfdoc.js';
import { strokePath, arrowPath } from './ink.js';
import { paperGeometry } from './paper.js';
import { renderPageCanvas, pageBounds, wrapText, TEXT_PAD_X, TEXT_PAD_Y, TEXT_LH } from './render.js';
import { hexToRgb, htmlToText, fmtDate } from './util.js';
import { sourceLabel } from './search.js';

const PT = 0.75; // 1 px de pantalla = 0,75 puntos PDF

export async function exportPdf(item, pages, onProgress) {
  const L = await loadPdfLib();
  const { PDFDocument, rgb, StandardFonts, pushGraphicsState, popGraphicsState, concatTransformationMatrix, setLineJoin, setLineCap, LineJoinStyle, LineCapStyle } = L;
  const out = await PDFDocument.create();
  out.setTitle(item.title || 'Documento');
  out.setCreator('Trazo');
  out.setProducer('Trazo');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const col = hex => { const [r, g, b] = hexToRgb(hex); return rgb(r / 255, g / 255, b / 255); };
  const srcDocs = new Map();
  const imgCache = new Map();
  const charOk = new Map();
  const safe = s => [...s].map(ch => {
    if (!charOk.has(ch)) { try { font.encodeText(ch); charOk.set(ch, true); } catch { charOk.set(ch, false); } }
    return charOk.get(ch) ? ch : '?';
  }).join('');
  const blend = L.BlendMode ? { blendMode: L.BlendMode.Multiply } : {};
  const roundCap = LineCapStyle ? { borderLineCap: LineCapStyle.Round } : {};

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length);
    const page = pages[i];
    let pp, M;
    if (page.bg.type === 'pdf') {
      let src = srcDocs.get(page.bg.blobId);
      if (!src) {
        const rec = await getBlobRecord(page.bg.blobId);
        src = await PDFDocument.load(rec.data.slice(0), { ignoreEncryption: true });
        srcDocs.set(page.bg.blobId, src);
      }
      const [cp] = await out.copyPages(src, [page.bg.page - 1]);
      pp = out.addPage(cp);
      M = await pdfPageMatrix(page.bg.blobId, page.bg.page);
    } else if (page.infinite) {
      const b = pageBounds(page);
      const W = (b.x2 - b.x1) * PT, H = (b.y2 - b.y1) * PT;
      pp = out.addPage([W, H]);
      pp.drawRectangle({ x: 0, y: 0, width: W, height: H, color: col(page.bg.color || '#ffffff') });
      M = [PT, 0, 0, -PT, -b.x1 * PT, H + b.y1 * PT];
    } else {
      const W = page.w * PT, H = page.h * PT;
      pp = out.addPage([W, H]);
      if ((page.bg.color || '#ffffff').toLowerCase() !== '#ffffff') pp.drawRectangle({ x: 0, y: 0, width: W, height: H, color: col(page.bg.color) });
      M = [PT, 0, 0, -PT, 0, H];
    }
    const [A, B, C, D, E, F] = M;
    // Espacio intermedio: x = x de pantalla, y = -(y de pantalla).
    pp.pushOperators(pushGraphicsState(), concatTransformationMatrix(A, B, -C, -D, E, F), setLineJoin(LineJoinStyle.Round), setLineCap(LineCapStyle.Round));

    if (!page.infinite && page.bg.type !== 'pdf') {
      const g = paperGeometry(page.bg.type, page.w, page.h);
      for (const [x1, y1, x2, y2, c, w] of g.lines) pp.drawLine({ start: { x: x1, y: -y1 }, end: { x: x2, y: -y2 }, thickness: w, color: col(c) });
      if (g.dots) {
        const { step, r, color } = g.dots;
        for (let y = step / 2; y < page.h; y += step) for (let x = step / 2; x < page.w; x += step) pp.drawEllipse({ x, y: -y, xScale: r, yScale: r, color: col(color) });
      }
    }

    for (const im of page.images) {
      try {
        let emb = imgCache.get(im.blobId);
        if (!emb) {
          const rec = await getBlobRecord(im.blobId);
          if (/png/i.test(rec.type)) emb = await out.embedPng(rec.data.slice(0));
          else if (/jpe?g/i.test(rec.type)) emb = await out.embedJpg(rec.data.slice(0));
          else emb = await out.embedPng(await toPngBytes(rec));
          imgCache.set(im.blobId, emb);
        }
        pp.drawImage(emb, { x: im.x, y: -(im.y + im.h), width: im.w, height: im.h });
      } catch (e) { console.warn('Imagen no exportada', e); }
    }

    for (const s of page.strokes) {
      if (s.t !== 'hl') continue;
      pp.drawSvgPath(strokePath(s), { x: 0, y: 0, scale: 1, borderColor: col(s.c), borderWidth: s.w, borderOpacity: s.op ?? 0.45, ...roundCap, ...blend });
    }

    for (const t of page.texts) {
      const size = t.size || 18;
      const lines = wrapText(x => font.widthOfTextAtSize(safe(x), size), htmlToText(t.html), t.w - TEXT_PAD_X * 2);
      const lh = size * TEXT_LH;
      let y = t.y + TEXT_PAD_Y + (lh - size) / 2 + size * 0.85;
      for (const line of lines) {
        const txt = safe(line);
        let x = t.x + TEXT_PAD_X;
        const w = font.widthOfTextAtSize(txt, size);
        if (t.align === 'center') x = t.x + (t.w - w) / 2;
        else if (t.align === 'right') x = t.x + t.w - TEXT_PAD_X - w;
        if (txt) pp.drawText(txt, { x, y: -y, size, font, color: col(t.color || '#1d1d1f') });
        y += lh;
      }
      if (t.box) {
        const hgt = t.h || lines.length * lh + TEXT_PAD_Y * 2;
        pp.drawRectangle({ x: t.x, y: -(t.y + hgt), width: t.w, height: hgt, borderColor: col(t.color || '#1d1d1f'), borderWidth: 1.5 });
      }
    }

    for (const s of page.strokes) {
      if (s.t === 'pen') pp.drawSvgPath(strokePath(s), { x: 0, y: 0, scale: 1, color: col(s.c) });
      else if (s.t === 'line') {
        const opts = { x: 0, y: 0, scale: 1, borderColor: col(s.c), borderWidth: s.w, ...roundCap };
        if (s.fill) Object.assign(opts, { color: col(s.fill), opacity: 0.35 });
        pp.drawSvgPath(strokePath(s), opts);
        if (s.arrow) pp.drawSvgPath(arrowPath(s), { x: 0, y: 0, scale: 1, borderColor: col(s.c), borderWidth: s.w, ...roundCap });
      }
    }
    pp.pushOperators(popGraphicsState());
  }
  onProgress?.(pages.length, pages.length);
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

async function toPngBytes(rec) {
  const url = URL.createObjectURL(new Blob([rec.data], { type: rec.type }));
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return blob.arrayBuffer();
  } finally { URL.revokeObjectURL(url); }
}

export async function exportPagePng(page, scale = 2) {
  const cv = await renderPageCanvas(page, { scale, maxPixels: 30e6 });
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

export async function exportMarkdown(item) {
  const pages = item.pageIds?.length ? await getPages(item.id) : [];
  const texts = await getDocTexts(item.id);
  const byPage = new Map();
  for (const t of texts) {
    const k = t.pageId || 'doc';
    if (!byPage.has(k)) byPage.set(k, []);
    byPage.get(k).push(t);
  }
  const tags = (item.tags || []).map(id => state.tags.get(id)?.name).filter(Boolean);
  let md = `# ${item.title}\n\n`;
  md += `*Exportado de Trazo el ${new Date().toLocaleString('es-ES')}. Última modificación: ${fmtDate(item.updated)}.*\n\n`;
  if (tags.length) md += `Etiquetas: ${tags.map(t => '#' + t).join(' ')}\n\n`;
  const order = ['typed', 'ia', 'ocr', 'pdf'];
  pages.forEach((p, i) => {
    const list = (byPage.get(p.id) || []).sort((a, b) => {
      const ia = order.indexOf(a.source), ib = order.indexOf(b.source);
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
    });
    if (!list.length) return;
    md += `## Página ${i + 1}\n\n`;
    for (const t of list) md += `**${sourceLabel(t.source)}**\n\n${t.text.trim()}\n\n`;
  });
  for (const t of byPage.get('doc') || []) md += `## ${sourceLabel(t.source)}\n\n${t.text.trim()}\n\n`;
  return new Blob([md], { type: 'text/markdown;charset=utf-8' });
}
