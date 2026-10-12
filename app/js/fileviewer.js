// Vista de archivos que no son cuadernos ni PDF (Word, texto, audio, vídeo…).
import { h, fmtSize, fmtDate, saveFile, sanitizeHtml, esc } from './util.js';
import { icon } from './icons.js';
import { state, getBlob, getDocTexts, saveItem } from './store.js';
import { loadMammoth } from './libs.js';
import { renameItem, exportItemsCopy, pickProject } from './library.js';
import { ext } from './importer.js';
import { pickTags, pickFolder, errorToast } from './ui.js';
import { sourceLabel } from './search.js';

export async function showFileViewer(root, item, back) {
  item.opened = Date.now();
  saveItem(item, { silent: true, norev: true });
  root.innerHTML = '';
  const title = h('button', { class: 'ed-title', onclick: () => renameItem(item).then(() => { title.textContent = item.title; }) }, item.title);
  const body = h('div', { class: 'fv-body' }, h('p', { class: 'muted' }, 'Cargando…'));
  const el = h('div', { class: 'editor fileview' },
    h('header', { class: 'ed-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: back }, icon('back')),
      title, h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: async () => { const b = await getBlob(item.blobId); if (b) saveFile(b, item.fileName || item.title); } }, icon('download', 18), h('span', { class: 'hide-sm' }, 'Descargar / abrir con…')),
      h('button', { class: 'icon-btn', 'aria-label': 'Etiquetas', title: 'Etiquetas', onclick: async () => { const t = await pickTags(item.tags || []); if (t) { item.tags = t; await saveItem(item); } } }, icon('tag')),
      h('button', { class: 'icon-btn', 'aria-label': 'Mover', title: 'Mover a carpeta', onclick: async () => { const f = await pickFolder({ current: item.folderId }); if (f !== undefined) { item.folderId = f; await saveItem(item); } } }, icon('move')),
      h('button', { class: 'icon-btn', 'aria-label': 'Proyecto', title: 'Proyecto', onclick: () => pickProject([item.id]) }, icon('project')),
      h('button', { class: 'icon-btn', 'aria-label': 'Copia editable', title: 'Exportar copia', onclick: () => exportItemsCopy([item.id]) }, icon('archive'))),
    body);
  root.appendChild(el);
  document.title = item.title + ' · Trazo';
  const urls = [];
  try {
    const blob = await getBlob(item.blobId);
    body.innerHTML = '';
    body.appendChild(h('p', { class: 'muted' }, [item.fileName, fmtSize(item.size), 'importado ' + fmtDate(item.created)].filter(Boolean).join(' · ')));
    if (!blob) { body.appendChild(h('p', null, 'No se encuentra el archivo.')); return () => {}; }
    const e = ext(item.fileName || ''), type = item.mime || blob.type || '';
    const url = URL.createObjectURL(blob);
    urls.push(url);
    if (type.startsWith('audio/')) body.appendChild(h('audio', { controls: true, src: url, class: 'fv-media' }));
    else if (type.startsWith('video/')) body.appendChild(h('video', { controls: true, src: url, class: 'fv-media', playsinline: true }));
    else if (type.startsWith('image/')) body.appendChild(h('img', { src: url, class: 'fv-img', alt: item.title }));
    else if (e === 'docx') {
      const m = await loadMammoth();
      const res = await m.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
      body.appendChild(h('article', { class: 'fv-doc', html: sanitizeHtml(res.value) }));
    } else if (e === 'md' || e === 'markdown') {
      body.appendChild(h('article', { class: 'fv-doc', html: miniMarkdown(await blob.text()) }));
    } else if (type.startsWith('text/') || ['txt', 'csv', 'tsv', 'json', 'xml', 'log', 'ini', 'yaml', 'yml'].includes(e)) {
      const txt = await blob.text();
      if (e === 'csv' || e === 'tsv') body.appendChild(csvTable(txt, e === 'tsv' ? '\t' : null));
      else body.appendChild(h('pre', { class: 'fv-pre' }, txt.slice(0, 400000)));
    } else {
      body.appendChild(h('div', { class: 'empty' }, icon('file', 44), h('h3', null, 'Sin vista previa'), h('p', null, 'Este tipo de archivo se guarda tal cual. Usa «Descargar / abrir con…» para abrirlo con otra aplicación.')));
      const texts = await getDocTexts(item.id);
      for (const t of texts) body.append(h('h3', null, sourceLabel(t.source)), h('pre', { class: 'fv-pre' }, t.text.slice(0, 200000)));
    }
  } catch (err) { errorToast(err); }
  return () => { for (const u of urls) URL.revokeObjectURL(u); el.remove(); };
}

function csvTable(txt, sep) {
  const lines = txt.split(/\r?\n/).filter(Boolean).slice(0, 2000);
  const d = sep || (lines[0] && lines[0].split(';').length > lines[0].split(',').length ? ';' : ',');
  const rows = lines.map(l => l.split(d));
  return h('div', { class: 'fv-table-wrap' }, h('table', { class: 'fv-table' }, rows.map((r, i) => h('tr', null, r.map(c => h(i ? 'td' : 'th', null, c.replace(/^"|"$/g, '')))))));
}

function miniMarkdown(md) {
  const lines = esc(md).split(/\r?\n/);
  let out = '', inList = false;
  for (const l of lines) {
    const m = /^(#{1,3})\s+(.*)/.exec(l);
    if (/^\s*[-*]\s+/.test(l)) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (m) out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
    else if (l.trim()) out += '<p>' + inline(l) + '</p>';
  }
  if (inList) out += '</ul>';
  return out;
}
const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
