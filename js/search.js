// Búsqueda: títulos, etiquetas, texto escrito, PDF, OCR, transcripciones y audio.
// Sin tildes ni mayúsculas, tolera erratas leves y admite filtros:
//   "frase exacta"   #etiqueta   tipo:pdf|cuaderno|pizarra|archivo
import { state, getAllTexts, on, liveItems } from './store.js';
import { norm } from './util.js';

let cache = null;
on('texts', () => { cache = null; });

async function entries() {
  if (!cache) {
    const all = await getAllTexts();
    cache = all.map(t => ({ ...t, n: norm(t.text) }));
  }
  return cache;
}

export const SOURCE_LABEL = {
  pdf: 'Texto del PDF', typed: 'Texto escrito', ocr: 'Texto reconocido', ia: 'Transcripción IA',
  audio: 'Audio transcrito', file: 'Contenido del archivo', img: 'Texto de imagen',
};
export const sourceLabel = s => SOURCE_LABEL[s] || (s.startsWith('img:') ? SOURCE_LABEL.img : s.startsWith('audio:') ? SOURCE_LABEL.audio : s);

const KIND_WORDS = { pdf: 'pdf', pdfs: 'pdf', nota: 'notebook', notas: 'notebook', cuaderno: 'notebook', cuadernos: 'notebook', pizarra: 'board', pizarras: 'board', lienzo: 'board', archivo: 'file', archivos: 'file' };

export function parseQuery(q) {
  const r = { terms: [], phrases: [], kinds: [], tags: [], raw: q || '' };
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(r.raw))) {
    if (m[1]) { const p = norm(m[1]).trim(); if (p) r.phrases.push(p); continue; }
    const tok = m[2];
    const low = norm(tok);
    if (low.startsWith('tipo:')) { const k = KIND_WORDS[low.slice(5)]; if (k) r.kinds.push(k); continue; }
    if (low.startsWith('#') && low.length > 1) { r.tags.push(low.slice(1)); continue; }
    const clean = low.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (clean) r.terms.push(clean);
  }
  return r;
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function words(e) {
  if (!e.words) e.words = [...new Set(e.n.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2))];
  return e.words;
}

function fuzzyIn(e, term) {
  if (term.length < 4) return null;
  const max = term.length >= 8 ? 2 : 1;
  for (const w of words(e)) {
    if (w.startsWith(term)) return w;
    if (lev(term, w, max) <= max) return w;
  }
  return null;
}

function countIn(n, t) {
  let c = 0, i = n.indexOf(t);
  while (i >= 0 && c < 6) { c++; i = n.indexOf(t, i + t.length); }
  return c;
}

export function snippet(text, n, needle, len = 170) {
  let i = needle ? n.indexOf(needle) : 0;
  if (i < 0) i = 0;
  const start = Math.max(0, i - 60);
  const end = Math.min(text.length, start + len);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

function metaText(item) {
  const tags = (item.tags || []).map(id => state.tags.get(id)?.name).filter(Boolean).join(' ');
  const folder = item.folderId ? state.folders.get(item.folderId)?.name || '' : '';
  const project = item.projectId ? state.projects.get(item.projectId)?.name || '' : '';
  return { title: norm(item.title), tags: norm(tags), other: norm([folder, project, item.fileName || ''].join(' ')) };
}

// Devuelve [{ item, score, hits: [{ pageId, page, source, snippet, needle }], partial }]
export async function search(q, { items = null, limit = 200 } = {}) {
  const Q = parseQuery(q);
  if (!Q.terms.length && !Q.phrases.length && !Q.kinds.length && !Q.tags.length) return [];
  let pool = items || liveItems();
  if (Q.kinds.length) pool = pool.filter(i => Q.kinds.includes(i.kind));
  if (Q.tags.length) {
    pool = pool.filter(i => Q.tags.every(tq => (i.tags || []).some(id => norm(state.tags.get(id)?.name || '').startsWith(tq))));
  }
  const allNeedles = [...Q.terms, ...Q.phrases];
  if (!allNeedles.length) return pool.map(item => ({ item, score: 1, hits: [] })).sort((a, b) => b.item.updated - a.item.updated);

  const poolById = new Map(pool.map(i => [i.id, i]));
  const byDoc = new Map();
  for (const e of await entries()) {
    const it = poolById.get(e.docId);
    if (!it) continue;
    if (e.pageId && it.pageIds && !it.pageIds.includes(e.pageId)) continue;
    if (!byDoc.has(e.docId)) byDoc.set(e.docId, []);
    byDoc.get(e.docId).push(e);
  }

  const run = mode => {
    const out = [];
    for (const item of pool) {
      const meta = metaText(item);
      const ents = byDoc.get(item.id) || [];
      let score = 0, matched = 0;
      const hits = new Map();
      for (const needle of allNeedles) {
        let found = false;
        const isPhrase = Q.phrases.includes(needle);
        if (meta.title.includes(needle)) { score += 12 + (meta.title.startsWith(needle) ? 4 : 0); found = true; }
        if (meta.tags.includes(needle)) { score += 7; found = true; }
        if (meta.other.includes(needle)) { score += 3; found = true; }
        for (const e of ents) {
          let c = countIn(e.n, needle), w = needle;
          if (!c && !isPhrase) {
            const f = fuzzyIn(e, needle);
            if (f) { c = 0.5; w = f; }
          }
          if (c) {
            found = true;
            score += Math.min(c, 5) * (e.source === 'typed' || e.source === 'ia' ? 1.3 : 1);
            const key = e.id;
            const hh = hits.get(key) || { e, score: 0, needle: w };
            hh.score += c;
            hits.set(key, hh);
          }
        }
        if (!found && !isPhrase && meta.title) {
          const tw = meta.title.split(/[^\p{L}\p{N}]+/u);
          if (needle.length >= 4 && tw.some(w => w.startsWith(needle) || lev(needle, w, 1) <= 1)) { score += 5; found = true; }
        }
        if (found) matched++;
      }
      const ok = mode === 'and' ? matched === allNeedles.length : matched > 0;
      if (!ok) continue;
      const hitList = [...hits.values()].sort((a, b) => b.score - a.score).slice(0, 4).map(hh => ({
        pageId: hh.e.pageId,
        page: hh.e.pageId ? (item.pageIds || []).indexOf(hh.e.pageId) + 1 : 0,
        source: hh.e.source,
        snippet: snippet(hh.e.text, hh.e.n, hh.needle),
        needle: hh.needle,
      }));
      const recency = Math.max(0, 1 - (Date.now() - (item.updated || 0)) / (365 * 86400000));
      out.push({ item, score: score + recency + (item.favorite ? 0.5 : 0), hits: hitList, partial: mode === 'or' });
    }
    return out;
  };
  let res = run('and');
  if (!res.length && allNeedles.length > 1) res = run('or');
  res.sort((a, b) => b.score - a.score || b.item.updated - a.item.updated);
  return res.slice(0, limit);
}

export function searchTerms(q) {
  const Q = parseQuery(q);
  return [...Q.terms, ...Q.phrases];
}

// Búsqueda dentro de un documento abierto.
export async function searchInDoc(docId, q) {
  const terms = searchTerms(q);
  if (!terms.length) return [];
  const pageIds = state.items.get(docId)?.pageIds || [];
  const all = (await entries()).filter(e => e.docId === docId && (!e.pageId || pageIds.includes(e.pageId)));
  const out = [];
  for (const e of all) {
    let first = null;
    for (const t of terms) {
      if (e.n.includes(t)) { first = first || t; continue; }
      const f = fuzzyIn(e, t);
      if (f) { first = first || f; continue; }
      first = null;
      break;
    }
    if (first) out.push({ pageId: e.pageId, source: e.source, snippet: snippet(e.text, e.n, first), needle: first });
  }
  return out;
}
