// Geometría de los trazos: contorno con presión, distancias, borrado, formas.
// Un trazo: { id, t: 'pen'|'hl'|'line', c: color, w: grosor, pts: [x,y,presión,...],
//             th: adelgazamiento (0-1), sim: presión simulada, arrow, closed, fill }

const r1 = v => Math.round(v * 10) / 10;
const pathCache = new WeakMap();
const boxCache = new WeakMap();

export function strokePath(s) {
  let d = pathCache.get(s);
  if (d === undefined) {
    d = s.t === 'pen' ? penOutline(s.pts, s.w, s.th ?? 0.6, !!s.sim) : polyPath(s.pts, s.t === 'hl', !!s.closed);
    pathCache.set(s, d);
  }
  return d;
}

// ---------- Contorno de pluma con grosor variable ----------
export function penOutline(pts, size, thinning, simulate) {
  const n = Math.floor(pts.length / 3);
  if (!n) return '';
  const P = [];
  const STREAM = 0.3;
  let sx = pts[0], sy = pts[1];
  P.push([sx, sy, pts[2]]);
  for (let i = 1; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1];
    sx += (x - sx) * (1 - STREAM);
    sy += (y - sy) * (1 - STREAM);
    const q = P[P.length - 1];
    if (Math.hypot(sx - q[0], sy - q[1]) < 0.6) continue;
    P.push([sx, sy, pts[i * 3 + 2]]);
  }
  if (n > 1) {
    const lx = pts[(n - 1) * 3], ly = pts[(n - 1) * 3 + 1], q = P[P.length - 1];
    if (Math.hypot(lx - q[0], ly - q[1]) > 0.4) P.push([lx, ly, pts[(n - 1) * 3 + 2]]);
  }
  const m = P.length;
  const R = new Array(m);
  if (simulate) thinning = Math.min(thinning, 0.3);
  let prev = simulate ? 0.5 : (P[0][2] || 0.5);
  for (let i = 0; i < m; i++) {
    let pr;
    if (simulate) {
      const d = i ? Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) : 0;
      const sp = Math.min(1, d / Math.max(size, 1));
      const rp = Math.min(1, 1 - sp);
      pr = Math.min(1, prev + (rp - prev) * (sp * 0.275));
    } else {
      const raw = P[i][2] > 0 ? P[i][2] : 0.5;
      pr = prev + (raw - prev) * 0.6;
    }
    prev = pr;
    R[i] = Math.max(0.4, size * (0.5 - thinning * (0.5 - pr)));
  }
  if (m === 1) return circle(P[0][0], P[0][1], R[0]);
  // Se parte el trazo en las esquinas cerradas para que la unión quede redonda.
  let out = '', start = 0;
  for (let i = 1; i < m - 1; i++) {
    const ax = P[i][0] - P[i - 1][0], ay = P[i][1] - P[i - 1][1];
    const bx = P[i + 1][0] - P[i][0], by = P[i + 1][1] - P[i][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) continue;
    if ((ax * bx + ay * by) / (la * lb) < -0.2) { out += run(P, R, start, i); start = i; }
  }
  return out + run(P, R, start, m - 1);
}

function circle(x, y, r) {
  return `M${r1(x - r)} ${r1(y)}A${r1(r)} ${r1(r)} 0 1 0 ${r1(x + r)} ${r1(y)}A${r1(r)} ${r1(r)} 0 1 0 ${r1(x - r)} ${r1(y)}Z`;
}

function run(P, R, a, b) {
  if (a === b) return circle(P[a][0], P[a][1], R[a]);
  const L = [], Rt = [];
  for (let i = a; i <= b; i++) {
    const i0 = Math.max(a, i - 1), i1 = Math.min(b, i + 1);
    let dx = P[i1][0] - P[i0][0], dy = P[i1][1] - P[i0][1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const r = R[i];
    L.push([P[i][0] - dy * r, P[i][1] + dx * r]);
    Rt.push([P[i][0] + dy * r, P[i][1] - dx * r]);
  }
  Rt.reverse();
  const ra = r1(R[a]), rb = r1(R[b]);
  return `M${r1(L[0][0])} ${r1(L[0][1])}${smooth(L)}A${rb} ${rb} 0 0 0 ${r1(Rt[0][0])} ${r1(Rt[0][1])}${smooth(Rt)}A${ra} ${ra} 0 0 0 ${r1(L[0][0])} ${r1(L[0][1])}Z`;
}

// Curva suave por los puntos medios (el punto inicial ya está colocado).
function smooth(Q) {
  const n = Q.length;
  if (n < 2) return '';
  if (n === 2) return `L${r1(Q[1][0])} ${r1(Q[1][1])}`;
  let d = '';
  for (let i = 1; i < n - 1; i++) {
    const mx = (Q[i][0] + Q[i + 1][0]) / 2, my = (Q[i][1] + Q[i + 1][1]) / 2;
    d += `Q${r1(Q[i][0])} ${r1(Q[i][1])} ${r1(mx)} ${r1(my)}`;
  }
  return d + `L${r1(Q[n - 1][0])} ${r1(Q[n - 1][1])}`;
}

export function polyPath(pts, curved, closed) {
  const n = Math.floor(pts.length / 3);
  if (!n) return '';
  if (n === 1) return `M${r1(pts[0])} ${r1(pts[1])}l0.01 0`;
  if (!curved) {
    let d = `M${r1(pts[0])} ${r1(pts[1])}`;
    for (let i = 1; i < n; i++) d += `L${r1(pts[i * 3])} ${r1(pts[i * 3 + 1])}`;
    return closed ? d + 'Z' : d;
  }
  const Q = [];
  for (let i = 0; i < n; i++) Q.push([pts[i * 3], pts[i * 3 + 1]]);
  return `M${r1(Q[0][0])} ${r1(Q[0][1])}` + smooth(Q);
}

export function arrowPath(s) {
  const n = Math.floor(s.pts.length / 3);
  if (n < 2) return '';
  const x2 = s.pts[(n - 1) * 3], y2 = s.pts[(n - 1) * 3 + 1];
  let k = n - 2, x1 = s.pts[k * 3], y1 = s.pts[k * 3 + 1];
  while (k > 0 && Math.hypot(x2 - x1, y2 - y1) < 4) { k--; x1 = s.pts[k * 3]; y1 = s.pts[k * 3 + 1]; }
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(12, s.w * 4.5), sp = 0.45;
  const ax = x2 - len * Math.cos(ang - sp), ay = y2 - len * Math.sin(ang - sp);
  const bx = x2 - len * Math.cos(ang + sp), by = y2 - len * Math.sin(ang + sp);
  return `M${r1(ax)} ${r1(ay)}L${r1(x2)} ${r1(y2)}L${r1(bx)} ${r1(by)}`;
}

// ---------- Cajas y distancias ----------
export function halfWidth(s) {
  return s.t === 'pen' ? s.w * 0.5 * (1 + (s.th ?? 0.6)) : s.w / 2;
}

export function strokeBox(s) {
  let b = boxCache.get(s);
  if (b) return b;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const p = s.pts;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < x1) x1 = p[i];
    if (p[i] > x2) x2 = p[i];
    if (p[i + 1] < y1) y1 = p[i + 1];
    if (p[i + 1] > y2) y2 = p[i + 1];
  }
  const hw = halfWidth(s) + (s.arrow ? s.w * 4.5 : 0);
  b = { x1: x1 - hw, y1: y1 - hw, x2: x2 + hw, y2: y2 + hw };
  boxCache.set(s, b);
  return b;
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToStroke(s, x, y) {
  const p = s.pts;
  const n = Math.floor(p.length / 3);
  if (n === 1) return Math.hypot(x - p[0], y - p[1]);
  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const d = distSeg(x, y, p[i * 3], p[i * 3 + 1], p[i * 3 + 3], p[i * 3 + 4]);
    if (d < best) best = d;
  }
  if (s.closed && n > 2) best = Math.min(best, distSeg(x, y, p[(n - 1) * 3], p[(n - 1) * 3 + 1], p[0], p[1]));
  return best;
}

export function hitStroke(s, x, y, r) {
  const b = strokeBox(s);
  if (x < b.x1 - r || x > b.x2 + r || y < b.y1 - r || y > b.y2 + r) return false;
  if (s.fill && s.closed && pointInPoly(x, y, s.pts, 3)) return true;
  return distToStroke(s, x, y) <= r + halfWidth(s);
}

export function pointInPoly(x, y, poly, stride = 2) {
  let inside = false;
  const n = Math.floor(poly.length / stride);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * stride], yi = poly[i * stride + 1], xj = poly[j * stride], yj = poly[j * stride + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function strokeInPoly(s, poly) {
  const n = Math.floor(s.pts.length / 3);
  const step = Math.max(1, Math.floor(n / 40));
  let inside = 0, total = 0;
  for (let i = 0; i < n; i += step) {
    total++;
    if (pointInPoly(s.pts[i * 3], s.pts[i * 3 + 1], poly)) inside++;
  }
  return total > 0 && inside / total >= 0.55;
}

// ---------- Borrador parcial ----------
function densify(pts, step) {
  const out = [];
  const n = Math.floor(pts.length / 3);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], p = pts[i * 3 + 2];
    if (i > 0) {
      const px = pts[i * 3 - 3], py = pts[i * 3 - 2], pp = pts[i * 3 - 1];
      const d = Math.hypot(x - px, y - py);
      const k = Math.floor(d / step);
      for (let j = 1; j < k; j++) {
        const t = j / k;
        out.push(px + (x - px) * t, py + (y - py) * t, pp + (p - pp) * t);
      }
    }
    out.push(x, y, p);
  }
  return out;
}

// Devuelve null si el borrador no toca el trazo; si lo toca, los trozos que quedan.
export function eraseFromStroke(s, x, y, r, newId) {
  if (!hitStroke(s, x, y, r)) return null;
  let pts = s.pts;
  if (s.closed) pts = [...pts, pts[0], pts[1], pts[2]];
  const dense = densify(pts, Math.max(1.5, r / 3));
  const n = dense.length / 3;
  const lim = r + halfWidth(s) * 0.6;
  const frags = [];
  let cur = [];
  for (let i = 0; i < n; i++) {
    const px = dense[i * 3], py = dense[i * 3 + 1];
    if (Math.hypot(px - x, py - y) > lim) cur.push(px, py, dense[i * 3 + 2]);
    else { if (cur.length >= 6) frags.push(cur); cur = []; }
  }
  if (cur.length >= 6) frags.push(cur);
  const lastX = dense[(n - 1) * 3], lastY = dense[(n - 1) * 3 + 1];
  return frags.map(f => {
    const keepArrow = s.arrow && f[f.length - 3] === lastX && f[f.length - 2] === lastY;
    const ns = { ...s, id: newId(), pts: new Float32Array(f) };
    delete ns.closed; delete ns.fill;
    if (!keepArrow) delete ns.arrow;
    return ns;
  });
}

// ---------- Transformaciones ----------
export function mapStroke(s, fx, wScale = 1) {
  const p = s.pts, out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const [x, y] = fx(p[i], p[i + 1]);
    out[i] = x; out[i + 1] = y; out[i + 2] = p[i + 2];
  }
  return { ...s, pts: out, w: s.w * wScale };
}

export function selectionBox(strokes, texts, images) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const add = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
  for (const s of strokes) { const b = strokeBox(s); add(b.x1, b.y1, b.x2, b.y2); }
  for (const t of texts) add(t.x, t.y, t.x + t.w, t.y + (t.h || 30));
  for (const im of images) add(im.x, im.y, im.x + im.w, im.y + im.h);
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

// ---------- Formas ----------
export function shapePts(kind, a) {
  const P = 0.5, out = [];
  if (kind === 'line' || kind === 'arrow') return [a.x1, a.y1, P, a.x2, a.y2, P];
  if (kind === 'rect') {
    const { x1, y1, x2, y2 } = a;
    return [x1, y1, P, x2, y1, P, x2, y2, P, x1, y2, P];
  }
  if (kind === 'ellipse') {
    const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2, rx = Math.abs(a.x2 - a.x1) / 2, ry = Math.abs(a.y2 - a.y1) / 2;
    const N = 72;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      out.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t), P);
    }
    return out;
  }
  if (kind === 'poly') {
    for (const [x, y] of a.points) out.push(x, y, P);
    return out;
  }
  return out;
}

function rdp(points, eps) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distSeg(points[i][0], points[i][1], ax, ay, bx, by);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const l = rdp(points.slice(0, idx + 1), eps), r = rdp(points.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [points[0], points[points.length - 1]];
}

// Reconoce una línea, un rectángulo, una elipse o un triángulo dibujados a mano.
export function recognizeShape(pts) {
  const n = Math.floor(pts.length / 3);
  if (n < 4) return null;
  const P = [];
  for (let i = 0; i < n; i++) P.push([pts[i * 3], pts[i * 3 + 1]]);
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const [fx, fy] = P[0], [lx, ly] = P[n - 1];
  const chord = Math.hypot(lx - fx, ly - fy);
  if (len < 20) return null;
  if (chord / len > 0.9) {
    let maxDev = 0;
    for (const [x, y] of P) maxDev = Math.max(maxDev, distSeg(x, y, fx, fy, lx, ly));
    if (maxDev < Math.max(6, chord * 0.07)) return { kind: 'line', x1: fx, y1: fy, x2: lx, y2: ly };
    return null;
  }
  if (chord > Math.max(30, len * 0.22)) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of P) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  const w = x2 - x1, h = y2 - y1;
  if (w < 12 || h < 12) return null;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  let eErr = 0, rErr = 0;
  for (const [x, y] of P) {
    const u = (x - cx) / (w / 2), v = (y - cy) / (h / 2);
    eErr += Math.abs(Math.hypot(u, v) - 1);
    rErr += Math.abs(Math.max(Math.abs(u), Math.abs(v)) - 1);
  }
  eErr /= n; rErr /= n;
  const simp = rdp([...P, P[0]], Math.hypot(w, h) * 0.09);
  const corners = simp.length - 1;
  if (corners === 3) return { kind: 'poly', points: simp.slice(0, 3) };
  if (rErr < 0.1 && rErr < eErr) return { kind: 'rect', x1, y1, x2, y2 };
  if (eErr < 0.16) return { kind: 'ellipse', x1, y1, x2, y2 };
  if (corners === 4) return { kind: 'poly', points: simp.slice(0, 4) };
  return null;
}
