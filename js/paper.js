// Tipos de papel. Una sola descripción sirve para pantalla, imagen y PDF.
const MM = 96 / 25.4;
const LINE = '#cdd6e4', DOT = '#a9b4c6', MARGIN = '#efb0b0';

export function paperGeometry(type, W, H) {
  const lines = [], g = { lines, dots: null };
  if (type === 'lined') {
    const step = 8 * MM;
    for (let y = 30 * MM; y < H - 8 * MM; y += step) lines.push([0, y, W, y, LINE, 1]);
    lines.push([22 * MM, 0, 22 * MM, H, MARGIN, 1]);
  } else if (type === 'grid') {
    const step = 5 * MM;
    for (let y = step; y < H; y += step) lines.push([0, y, W, y, LINE, 0.7]);
    for (let x = step; x < W; x += step) lines.push([x, 0, x, H, LINE, 0.7]);
  } else if (type === 'dots') {
    g.dots = { step: 5 * MM, r: 0.9, color: DOT };
  } else if (type === 'cornell') {
    const step = 8 * MM, cue = 60 * MM, bottom = H - 50 * MM;
    for (let y = 30 * MM; y < bottom; y += step) lines.push([0, y, W, y, LINE, 1]);
    lines.push([cue, 22 * MM, cue, bottom, MARGIN, 1.2]);
    lines.push([0, bottom, W, bottom, MARGIN, 1.2]);
    lines.push([0, 22 * MM, W, 22 * MM, MARGIN, 1.2]);
  }
  return g;
}

export function paperSvg(type, W, H, uid) {
  const g = paperGeometry(type, W, H);
  let s = '';
  if (g.lines.length) {
    const byStyle = new Map();
    for (const [x1, y1, x2, y2, c, w] of g.lines) {
      const k = c + '|' + w;
      byStyle.set(k, (byStyle.get(k) || '') + `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`);
    }
    for (const [k, d] of byStyle) {
      const [c, w] = k.split('|');
      s += `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
    }
  }
  if (g.dots) {
    const { step, r, color } = g.dots;
    s += `<defs><pattern id="dots-${uid}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="${r}" fill="${color}"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#dots-${uid})"/>`;
  }
  return s;
}

export function drawPaper(ctx, type, W, H) {
  const g = paperGeometry(type, W, H);
  for (const [x1, y1, x2, y2, c, w] of g.lines) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  if (g.dots) {
    const { step, r, color } = g.dots;
    ctx.fillStyle = color;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
