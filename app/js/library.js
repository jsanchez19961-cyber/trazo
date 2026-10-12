// Biblioteca: barra lateral, vistas de documentos y organización.
import { h, esc, fmtDate, fmtSize, debounce, pickFiles, saveFile, safeFileName, norm } from './util.js';
import { icon, KIND_ICON } from './icons.js';
import {
  state, on, liveItems, createNotebook, createBoard, updateItem, updateItems, trashItems, restoreItems,
  deleteItemsForever, duplicateItem, saveFolder, deleteFolder, folderPath, isDescendant, saveProject, deleteProject,
  saveCollection, deleteCollection, addToCollection, removeFromCollection, saveTag, deleteTag, getPages, getBlob,
  getDocTexts, PAPERS, PAPER_COLORS, PAGE_SIZES, KINDS, TAG_COLORS,
} from './store.js';
import {
  toast, errorToast, modal, confirmDialog, promptDialog, menu, pickFolder, pickTags, choose, colorGrid,
  emptyState, highlight, folderTree, closePopover,
} from './ui.js';
import { importFiles, importImage, fileKind } from './importer.js';
import { search, searchTerms, sourceLabel } from './search.js';
import { paperSvg } from './paper.js';
import { renderSettings, backupFlow, restoreFlow } from './settings.js';
import { syncChip, connectAndSync } from './syncui.js';

const STATUS = { activo: 'Activo', pausa: 'En pausa', terminado: 'Terminado' };
const SORTS = { updated: 'Última modificación', opened: 'Último abierto', created: 'Fecha de creación', title: 'Nombre' };

let L = null;

function lsGet(k, d) { try { const v = localStorage.getItem('trazo.' + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem('trazo.' + k, JSON.stringify(v)); } catch { /* nada */ } }

export function go(hash) { location.hash = hash; }
export const openDoc = (id, page) => go('#/doc/' + id + (page ? '/' + page : ''));

// ================= Montaje =================
export function showLibrary(root, route) {
  if (!L || !L.el.isConnected) build(root);
  const same = L.route && L.route.name === route.name && L.route.id === route.id;
  L.route = route;
  if (!same) { L.selectMode = false; L.selected.clear(); }
  L.el.classList.remove('nav-open');
  renderSidebar();
  renderMain();
  if (!same) L.main.scrollTop = 0;
}

export function hideLibrary() {
  if (L) { L.el.remove(); L = null; }
}

function build(root) {
  root.innerHTML = '';
  L = {
    route: null, selectMode: false, selected: new Set(), expanded: new Set(lsGet('expanded', [])),
    snoozeBackup: false, unsub: [],
  };
  L.sidebar = h('aside', { class: 'sidebar' });
  L.scrim = h('div', { class: 'scrim', onclick: () => L.el.classList.remove('nav-open') });
  L.title = h('h1', { class: 'top-title' });
  L.search = h('input', { class: 'search-input', type: 'search', placeholder: 'Buscar en todo…', enterkeyhint: 'search', 'aria-label': 'Buscar' });
  L.search.addEventListener('keydown', e => { if (e.key === 'Enter') { const q = L.search.value.trim(); if (q) go('#/buscar/' + encodeURIComponent(q)); } });
  L.search.addEventListener('input', debounce(() => {
    if (!L) return;
    const q = L.search.value.trim();
    if (q.length < 2) return;
    const hash = '#/buscar/' + encodeURIComponent(q);
    if (L.route?.name === 'buscar') location.replace(hash);
    else location.hash = hash;
  }, 400));
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn nav-toggle', 'aria-label': 'Menú', onclick: () => L.el.classList.toggle('nav-open') }, icon('menu')),
    L.title,
    h('div', { class: 'search-box' }, icon('search', 20), L.search),
    syncChip(L.unsub),
    h('button', { class: 'btn primary new-btn', onclick: e => newMenu(e.currentTarget) }, icon('plus', 20), h('span', null, 'Nuevo')),
  );
  L.banner = h('div', { class: 'banner-host' });
  L.content = h('div', { class: 'lib-content' });
  L.bulk = h('div', { class: 'bulk-bar hidden' });
  L.main = h('main', { class: 'lib-main' }, top, L.banner, L.content);
  L.dropHint = h('div', { class: 'drop-hint hidden' }, icon('upload', 40), h('p', null, 'Suelta aquí para importar'));
  L.el = h('div', { class: 'lib' }, L.sidebar, L.scrim, L.main, L.bulk, L.dropHint);
  root.appendChild(L.el);

  const rerender = debounce(() => { if (L && L.el.isConnected) { renderSidebar(); renderMain(); } }, 60);
  for (const ev of ['items', 'folders', 'projects', 'collections', 'tags', 'settings']) L.unsub.push(on(ev, rerender));

  // Arrastrar archivos desde el ordenador.
  let depth = 0;
  L.el.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; L.dropHint.classList.remove('hidden'); } });
  L.el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) L.dropHint.classList.add('hidden'); });
  L.el.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  L.el.addEventListener('drop', async e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    L.dropHint.classList.add('hidden');
    await doImport([...e.dataTransfer.files]);
  });
}

// ================= Barra lateral =================
function navItem(label, iconName, hash, { count, active, color, drop, onMore, depth = 0, chevron } = {}) {
  const a = h('a', { class: 'nav-item' + (active ? ' active' : ''), href: hash, style: depth ? { paddingLeft: 10 + depth * 16 + 'px' } : null },
    chevron || null,
    h('span', { class: 'ic', style: color ? { color } : null }, icon(iconName, 20)),
    h('span', { class: 'nav-label' }, label),
    count != null ? h('span', { class: 'nav-count' }, count) : null,
    onMore ? h('button', { class: 'nav-more', 'aria-label': 'Opciones', onclick: e => { e.preventDefault(); e.stopPropagation(); onMore(e.currentTarget); } }, icon('more', 18)) : null,
  );
  if (drop) {
    a.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/trazo-ids')) { e.preventDefault(); a.classList.add('drop'); } });
    a.addEventListener('dragleave', () => a.classList.remove('drop'));
    a.addEventListener('drop', e => {
      a.classList.remove('drop');
      const ids = JSON.parse(e.dataTransfer.getData('text/trazo-ids') || '[]');
      if (ids.length) { e.preventDefault(); drop(ids); }
    });
  }
  return a;
}

function section(title, onAdd, addLabel) {
  return h('div', { class: 'nav-section' }, h('span', null, title),
    onAdd ? h('button', { class: 'icon-btn sm', 'aria-label': addLabel, title: addLabel, onclick: onAdd }, icon('plus', 18)) : null);
}

function renderSidebar() {
  const r = L.route, items = liveItems();
  const sb = L.sidebar;
  sb.innerHTML = '';
  sb.appendChild(h('div', { class: 'brand' }, h('span', { class: 'brand-logo' }, icon('logo', 26)), h('span', null, 'Trazo')));
  const nav = h('nav', { class: 'nav' });
  nav.append(
    navItem('Inicio', 'home', '#/', { active: r.name === 'inicio' }),
    navItem('Biblioteca', 'folder', '#/biblioteca', { active: r.name === 'biblioteca', drop: ids => moveTo(ids, null) }),
    navItem('Todos los documentos', 'grid', '#/todo', { active: r.name === 'todo', count: items.length }),
    navItem('Favoritos', 'star', '#/favoritos', { active: r.name === 'favoritos', count: items.filter(i => i.favorite).length || null, drop: ids => updateItems(ids, it => { it.favorite = true; }) }),
  );
  // Carpetas
  nav.appendChild(section('Carpetas', () => newFolder(null), 'Nueva carpeta'));
  const tree = folderTree();
  const visible = new Set([null]);
  for (const { folder } of tree) {
    if (!visible.has(folder.parentId || null)) continue;
    const kids = tree.some(t => t.folder.parentId === folder.id);
    const depth = folderPath(folder.id).length - 1;
    if (L.expanded.has(folder.id)) visible.add(folder.id);
    const chev = kids ? h('button', {
      class: 'chev' + (L.expanded.has(folder.id) ? ' open' : ''), 'aria-label': 'Desplegar',
      onclick: e => { e.preventDefault(); e.stopPropagation(); L.expanded.has(folder.id) ? L.expanded.delete(folder.id) : L.expanded.add(folder.id); lsSet('expanded', [...L.expanded]); renderSidebar(); },
    }, icon('chevR', 16)) : h('span', { class: 'chev-space' });
    nav.appendChild(navItem(folder.name, 'folder', '#/carpeta/' + folder.id, {
      active: r.name === 'carpeta' && r.id === folder.id, color: folder.color || null, depth, chevron: chev,
      count: items.filter(i => i.folderId === folder.id).length || null,
      drop: ids => moveTo(ids, folder.id), onMore: a => folderMenu(folder, a),
    }));
  }
  // Proyectos
  nav.appendChild(section('Proyectos', () => editProject(), 'Nuevo proyecto'));
  const projects = [...state.projects.values()].sort((a, b) => (a.status === 'terminado') - (b.status === 'terminado') || a.name.localeCompare(b.name, 'es'));
  for (const p of projects) {
    nav.appendChild(navItem(p.name, 'project', '#/proyecto/' + p.id, {
      active: r.name === 'proyecto' && r.id === p.id, color: p.color, count: items.filter(i => i.projectId === p.id).length || null,
      drop: ids => updateItems(ids, it => { it.projectId = p.id; }).then(() => toast(`Añadido a «${p.name}»`)), onMore: a => projectMenu(p, a),
    }));
  }
  if (projects.length) nav.appendChild(navItem('Ver todos los proyectos', 'list', '#/proyectos', { active: r.name === 'proyectos' }));
  // Colecciones
  nav.appendChild(section('Colecciones', () => newCollection(), 'Nueva colección'));
  for (const c of [...state.collections.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    nav.appendChild(navItem(c.name, c.kind === 'smart' ? 'sparkle' : 'collection', '#/coleccion/' + c.id, {
      active: r.name === 'coleccion' && r.id === c.id, count: c.kind === 'manual' ? (c.itemIds || []).filter(id => state.items.get(id) && !state.items.get(id).trashed).length || null : null,
      drop: c.kind === 'manual' ? ids => addToCollection(c.id, ids).then(() => toast(`Añadido a «${c.name}»`)) : null, onMore: a => collectionMenu(c, a),
    }));
  }
  // Etiquetas
  nav.appendChild(section('Etiquetas', () => newTag(), 'Nueva etiqueta'));
  const tagWrap = h('div', { class: 'tag-cloud' });
  for (const t of [...state.tags.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    const chip = h('a', { class: 'tag-chip' + (r.name === 'etiqueta' && r.id === t.id ? ' on' : ''), href: '#/etiqueta/' + t.id, style: { '--tag': t.color } }, h('span', { class: 'dot' }), t.name);
    chip.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/trazo-ids')) { e.preventDefault(); chip.classList.add('drop'); } });
    chip.addEventListener('dragleave', () => chip.classList.remove('drop'));
    chip.addEventListener('drop', e => {
      chip.classList.remove('drop');
      const ids = JSON.parse(e.dataTransfer.getData('text/trazo-ids') || '[]');
      if (ids.length) { e.preventDefault(); updateItems(ids, it => { it.tags = [...new Set([...(it.tags || []), t.id])]; }); }
    });
    tagWrap.appendChild(chip);
  }
  if (state.tags.size) nav.appendChild(tagWrap);
  nav.appendChild(h('div', { class: 'nav-section' }));
  const trashCount = [...state.items.values()].filter(i => i.trashed).length;
  nav.append(
    navItem('Papelera', 'trash', '#/papelera', { active: r.name === 'papelera', count: trashCount || null, drop: ids => trashItems(ids) }),
    navItem('Ajustes y copias', 'settings', '#/ajustes', { active: r.name === 'ajustes' }),
  );
  sb.appendChild(nav);
}

// ================= Contenido =================
function setTitle(t) {
  L.title.textContent = t;
  document.title = t + ' · Trazo';
}

function renderMain() {
  const r = L.route;
  const c = L.content;
  c.innerHTML = '';
  renderBanner();
  if (r.name !== 'buscar' && document.activeElement !== L.search) L.search.value = '';
  switch (r.name) {
    case 'inicio': return viewHome(c);
    case 'biblioteca': return viewFolder(c, null);
    case 'carpeta': return state.folders.has(r.id) ? viewFolder(c, r.id) : notFound(c);
    case 'todo': setTitle('Todos los documentos'); return listing(c, liveItems(), { showFolder: true });
    case 'favoritos': setTitle('Favoritos'); return listing(c, liveItems().filter(i => i.favorite), { showFolder: true, empty: ['star', 'Sin favoritos', 'Marca con la estrella los documentos que uses más.'] });
    case 'proyectos': return viewProjects(c);
    case 'proyecto': return state.projects.has(r.id) ? viewProject(c, state.projects.get(r.id)) : notFound(c);
    case 'coleccion': return state.collections.has(r.id) ? viewCollection(c, state.collections.get(r.id)) : notFound(c);
    case 'etiqueta': return state.tags.has(r.id) ? viewTag(c, state.tags.get(r.id)) : notFound(c);
    case 'papelera': return viewTrash(c);
    case 'buscar': return viewSearch(c, r.q || '');
    case 'ajustes': setTitle('Ajustes y copias de seguridad'); return renderSettings(c);
    default: return viewHome(c);
  }
}

function notFound(c) {
  setTitle('No encontrado');
  c.appendChild(emptyState('info', 'No existe', 'Puede que se haya borrado.', [h('a', { class: 'btn', href: '#/' }, 'Ir al inicio')]));
}

function renderBanner() {
  L.banner.innerHTML = '';
  const s = state.settings;
  const n = liveItems().length;
  if (!n || L.snoozeBackup) return;
  if (s.driveEnabled) {
    // Con Drive activado, la copia es la sincronización.
    const last = s.driveSync?.last || 0;
    const d = (Date.now() - last) / 86400000;
    if (d < 2) return;
    L.banner.appendChild(h('div', { class: 'banner' }, icon('cloudOff', 20),
      h('span', null, last ? `Hace ${Math.floor(d)} días que no se guarda en Google Drive.` : 'Todavía no se ha guardado nada en Google Drive.'),
      h('button', { class: 'btn primary sm', onclick: () => connectAndSync() }, 'Sincronizar'),
      h('button', { class: 'btn ghost sm', onclick: () => { L.snoozeBackup = true; renderBanner(); } }, 'Más tarde')));
    return;
  }
  const days = (Date.now() - (s.lastBackup || 0)) / 86400000;
  if (days < (s.backupDays || 7)) return;
  const lastChange = Math.max(...[...state.items.values()].map(i => i.updated || 0));
  if (s.lastBackup && lastChange < s.lastBackup) return;
  L.banner.appendChild(h('div', { class: 'banner' }, icon('archive', 20),
    h('span', null, s.lastBackup ? `Tu última copia de seguridad es de hace ${Math.floor(days)} días.` : 'Aún no has hecho ninguna copia de seguridad. Tus notas solo están en este dispositivo.'),
    h('button', { class: 'btn primary sm', onclick: () => backupFlow() }, 'Hacer copia'),
    h('button', { class: 'btn ghost sm', onclick: () => { L.snoozeBackup = true; renderBanner(); } }, 'Más tarde')));
}

// ----- Inicio -----
function viewHome(c) {
  setTitle('Inicio');
  const items = liveItems();
  const quick = h('div', { class: 'quick' },
    quickBtn('notebook', 'Cuaderno', 'Notas a mano o con teclado', () => newNotebookDialog()),
    quickBtn('board', 'Pizarra', 'Lienzo libre para esquemas', () => newBoard()),
    quickBtn('upload', 'Importar', 'PDF, imágenes, documentos', () => importDialog()),
    quickBtn('camera', 'Foto', 'Fotografía una pizarra o papel', () => takePhoto()),
  );
  c.appendChild(quick);
  if (!items.length) {
    c.appendChild(emptyState('logo', 'Bienvenido a Trazo', 'Crea un cuaderno, una pizarra o importa un PDF para empezar. Todo se guarda en este dispositivo; haz copias de seguridad desde Ajustes.'));
    return;
  }
  const recent = [...items].sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 8);
  c.appendChild(h('h2', { class: 'sec-title' }, 'Continuar'));
  c.appendChild(grid(recent, { showFolder: true }));
  const favs = items.filter(i => i.favorite).sort((a, b) => b.updated - a.updated).slice(0, 8);
  if (favs.length) {
    c.appendChild(h('h2', { class: 'sec-title' }, h('a', { href: '#/favoritos' }, 'Favoritos'), icon('chevR', 18)));
    c.appendChild(grid(favs, { showFolder: true }));
  }
  const active = [...state.projects.values()].filter(p => p.status === 'activo');
  if (active.length) {
    c.appendChild(h('h2', { class: 'sec-title' }, h('a', { href: '#/proyectos' }, 'Proyectos activos'), icon('chevR', 18)));
    c.appendChild(h('div', { class: 'proj-grid' }, active.map(projectCard)));
  }
}

function quickBtn(ic, title, sub, fn) {
  return h('button', { class: 'quick-btn', onclick: fn }, h('span', { class: 'quick-ic' }, icon(ic, 26)), h('strong', null, title), h('small', null, sub));
}

// ----- Carpetas -----
function viewFolder(c, folderId) {
  const folder = folderId ? state.folders.get(folderId) : null;
  setTitle(folder ? folder.name : 'Biblioteca');
  const crumbs = h('div', { class: 'crumbs' }, h('a', { href: '#/biblioteca' }, 'Biblioteca'));
  if (folder) for (const f of folderPath(folderId)) crumbs.append(icon('chevR', 16), h('a', { href: '#/carpeta/' + f.id }, f.name));
  const head = h('div', { class: 'view-head' }, crumbs,
    h('div', { class: 'row gap' },
      h('button', { class: 'btn sm', onclick: () => newFolder(folderId) }, icon('folderPlus', 18), 'Subcarpeta'),
      folder ? h('button', { class: 'icon-btn', 'aria-label': 'Opciones de carpeta', onclick: e => folderMenu(folder, e.currentTarget) }, icon('more')) : null));
  c.appendChild(head);
  const subs = [...state.folders.values()].filter(f => (f.parentId || null) === folderId).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (subs.length) {
    c.appendChild(h('div', { class: 'folder-grid' }, subs.map(f => {
      const n = liveItems().filter(i => i.folderId === f.id).length;
      const sub = [...state.folders.values()].filter(x => x.parentId === f.id).length;
      const el = h('a', { class: 'folder-tile', href: '#/carpeta/' + f.id },
        h('span', { class: 'ic', style: { color: f.color || 'var(--accent)' } }, icon('folder', 30)),
        h('span', { class: 'ft-text' }, h('strong', null, f.name), h('small', null, [n ? `${n} doc.` : 'Vacía', sub ? ` · ${sub} carpetas` : ''].join(''))),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Opciones', onclick: e => { e.preventDefault(); folderMenu(f, e.currentTarget); } }, icon('more', 18)));
      el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/trazo-ids')) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', e => { el.classList.remove('drop'); const ids = JSON.parse(e.dataTransfer.getData('text/trazo-ids') || '[]'); if (ids.length) { e.preventDefault(); moveTo(ids, f.id); } });
      return el;
    })));
  }
  const docs = liveItems().filter(i => (i.folderId || null) === folderId);
  listing(c, docs, { empty: subs.length ? null : ['folder', folder ? 'Carpeta vacía' : 'Biblioteca vacía', 'Crea un documento aquí con «Nuevo» o arrastra archivos.'] });
}

// ----- Proyectos -----
function projectCard(p) {
  const items = liveItems().filter(i => i.projectId === p.id);
  return h('a', { class: 'proj-card', href: '#/proyecto/' + p.id, style: { '--pc': p.color } },
    h('div', { class: 'proj-top' }, h('span', { class: 'proj-dot' }), h('strong', null, p.name), h('span', { class: 'status s-' + p.status }, STATUS[p.status] || p.status)),
    p.description ? h('p', { class: 'proj-desc' }, p.description) : null,
    h('small', { class: 'muted' }, `${items.length} documentos` + (p.due ? ` · fecha objetivo ${new Date(p.due).toLocaleDateString('es-ES')}` : '')));
}

function viewProjects(c) {
  setTitle('Proyectos');
  c.appendChild(h('div', { class: 'view-head' }, h('p', { class: 'muted' }, 'Agrupa documentos de varias carpetas por proyecto o encargo.'),
    h('button', { class: 'btn sm', onclick: () => editProject() }, icon('plus', 18), 'Nuevo proyecto')));
  const ps = [...state.projects.values()];
  if (!ps.length) { c.appendChild(emptyState('project', 'Sin proyectos', 'Crea uno y asígnale documentos desde su menú «⋯».')); return; }
  for (const st of Object.keys(STATUS)) {
    const list = ps.filter(p => p.status === st);
    if (!list.length) continue;
    c.appendChild(h('h2', { class: 'sec-title' }, STATUS[st]));
    c.appendChild(h('div', { class: 'proj-grid' }, list.map(projectCard)));
  }
}

function viewProject(c, p) {
  setTitle(p.name);
  const head = h('div', { class: 'proj-head', style: { '--pc': p.color } },
    h('div', { class: 'row gap wrap' },
      h('span', { class: 'proj-dot big' }),
      h('button', { class: 'status s-' + p.status, onclick: e => menu(e.currentTarget, Object.entries(STATUS).map(([k, v]) => ({ label: v, checked: p.status === k, onClick: () => saveProject({ ...p, status: k }) }))) }, STATUS[p.status], icon('chevD', 14)),
      p.due ? h('span', { class: 'muted' }, 'Fecha objetivo: ' + new Date(p.due).toLocaleDateString('es-ES')) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: () => editProject(p) }, icon('edit', 18), 'Editar'),
      h('button', { class: 'icon-btn', 'aria-label': 'Más', onclick: e => projectMenu(p, e.currentTarget) }, icon('more'))),
    p.description ? h('p', { class: 'proj-desc' }, p.description) : null);
  c.appendChild(head);
  listing(c, liveItems().filter(i => i.projectId === p.id), { showFolder: true, empty: ['project', 'Proyecto sin documentos', 'Crea uno con «Nuevo» estando aquí, o asigna documentos existentes desde su menú «⋯».'] });
}

// ----- Colecciones -----
async function viewCollection(c, col) {
  setTitle(col.name);
  const head = h('div', { class: 'view-head' },
    h('p', { class: 'muted' }, col.kind === 'smart' ? ['Colección inteligente: muestra lo que coincide con ', h('code', null, col.query || '(vacía)')] : 'Colección: una selección de documentos de cualquier carpeta.'),
    h('div', { class: 'row gap' },
      col.kind === 'smart' ? h('button', { class: 'btn sm', onclick: () => editSmart(col) }, icon('edit', 18), 'Editar búsqueda') : null,
      h('button', { class: 'icon-btn', 'aria-label': 'Más', onclick: e => collectionMenu(col, e.currentTarget) }, icon('more'))));
  c.appendChild(head);
  if (col.kind === 'smart') {
    const holder = h('div');
    c.appendChild(holder);
    const res = col.query ? await search(col.query) : [];
    listing(holder, res.map(r => r.item), { showFolder: true, keepOrder: true, empty: ['sparkle', 'Nada coincide todavía', 'Cuando haya documentos que cumplan la búsqueda aparecerán aquí solos.'] });
  } else {
    const items = (col.itemIds || []).map(id => state.items.get(id)).filter(i => i && !i.trashed);
    listing(c, items, { showFolder: true, collection: col, empty: ['collection', 'Colección vacía', 'Añade documentos desde su menú «⋯» o arrastrándolos aquí.'] });
  }
}

function viewTag(c, t) {
  setTitle('#' + t.name);
  c.appendChild(h('div', { class: 'view-head' }, h('span', { class: 'tag-chip big on', style: { '--tag': t.color } }, h('span', { class: 'dot' }), t.name),
    h('button', { class: 'icon-btn', 'aria-label': 'Opciones', onclick: e => tagMenu(t, e.currentTarget) }, icon('more'))));
  listing(c, liveItems().filter(i => (i.tags || []).includes(t.id)), { showFolder: true });
}

// ----- Papelera -----
function viewTrash(c) {
  setTitle('Papelera');
  const items = [...state.items.values()].filter(i => i.trashed).sort((a, b) => b.trashed - a.trashed);
  c.appendChild(h('div', { class: 'view-head' }, h('p', { class: 'muted' }, 'Lo que está aquí se borra solo a los 30 días.'),
    items.length ? h('button', { class: 'btn danger sm', onclick: async () => {
      if (await confirmDialog(`Se borrarán definitivamente ${items.length} documentos. No se puede deshacer.`, { title: 'Vaciar papelera', ok: 'Vaciar', danger: true })) {
        await deleteItemsForever(items.map(i => i.id));
        toast('Papelera vacía');
      }
    } }, icon('trash', 18), 'Vaciar papelera') : null));
  if (!items.length) { c.appendChild(emptyState('trash', 'La papelera está vacía', '')); return; }
  c.appendChild(h('div', { class: 'list' }, items.map(it => h('div', { class: 'row-item' },
    thumbBox(it, true),
    h('div', { class: 'ri-text' }, h('strong', null, it.title), h('small', null, `${KINDS[it.kind]} · a la papelera ${fmtDate(it.trashed)}`)),
    h('button', { class: 'btn sm', onclick: () => restoreItems([it.id]).then(() => toast('Restaurado')) }, icon('restore', 18), 'Restaurar'),
    h('button', { class: 'icon-btn', 'aria-label': 'Borrar definitivamente', onclick: async () => {
      if (await confirmDialog(`«${it.title}» se borrará para siempre.`, { title: 'Borrar definitivamente', ok: 'Borrar', danger: true })) deleteItemsForever([it.id]);
    } }, icon('close'))))));
}

// ----- Búsqueda -----
async function viewSearch(c, q) {
  setTitle('Buscar');
  if (document.activeElement !== L.search) L.search.value = q;
  const filters = h('div', { class: 'chips' });
  const kinds = [['', 'Todo'], ['tipo:cuaderno', 'Cuadernos'], ['tipo:pdf', 'PDF'], ['tipo:pizarra', 'Pizarras'], ['tipo:archivo', 'Archivos']];
  const base = q.replace(/\btipo:\S+/g, '').trim();
  for (const [k, label] of kinds) {
    const on = k ? q.includes(k) : !/\btipo:/.test(q);
    filters.appendChild(h('button', { class: 'chip' + (on ? ' on' : ''), onclick: () => go('#/buscar/' + encodeURIComponent((base + ' ' + k).trim())) }, label));
  }
  const save = h('button', { class: 'btn sm', onclick: async () => {
    const name = await promptDialog('Guardar como colección inteligente', { value: base, label: 'Nombre de la colección' });
    if (name) { const col = await saveCollection({ name, kind: 'smart', query: q }); go('#/coleccion/' + col.id); }
  } }, icon('sparkle', 18), 'Guardar búsqueda');
  c.appendChild(h('div', { class: 'view-head' }, filters, q ? save : null));
  c.appendChild(h('p', { class: 'muted help' }, 'Busca en títulos, etiquetas, texto escrito, PDF, texto reconocido en imágenes y transcripciones. Sin tildes ni mayúsculas. Usa "comillas" para frases exactas y #etiqueta para filtrar.'));
  if (!q) return;
  const holder = h('div', { class: 'results' }, h('p', { class: 'muted' }, 'Buscando…'));
  c.appendChild(holder);
  const res = await search(q);
  if (L.route.name !== 'buscar' || L.route.q !== q) return;
  holder.innerHTML = '';
  if (!res.length) { holder.appendChild(emptyState('search', 'Sin resultados', 'Prueba con otras palabras o menos filtros.')); return; }
  if (res[0].partial) holder.appendChild(h('p', { class: 'muted' }, 'No hay documentos con todas las palabras. Estos contienen alguna:'));
  const terms = searchTerms(q);
  for (const r of res) {
    const it = r.item;
    const folder = it.folderId ? state.folders.get(it.folderId)?.name : null;
    const el = h('div', { class: 'result' },
      h('a', { class: 'result-head', href: '#/doc/' + it.id }, thumbBox(it, true),
        h('div', { class: 'ri-text' }, h('strong', { html: highlight(it.title, terms) }), h('small', null, [KINDS[it.kind], folder, fmtDate(it.updated)].filter(Boolean).join(' · ')))),
      r.hits.length ? h('div', { class: 'hits' }, r.hits.map(hit => h('a', { class: 'hit', href: '#/doc/' + it.id + (hit.page ? '/' + hit.page : '') },
        h('span', { class: 'hit-src' }, (hit.page ? `Pág. ${hit.page} · ` : '') + sourceLabel(hit.source)),
        h('span', { class: 'hit-text', html: highlight(hit.snippet, [...terms, hit.needle]) })))) : null);
    holder.appendChild(el);
  }
}

// ================= Listados =================
function listing(c, items, opts = {}) {
  const sort = state.settings.librarySort || 'updated';
  const view = state.settings.libraryView || 'grid';
  if (!opts.keepOrder) {
    items = [...items].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'es', { numeric: true });
      return (b[sort] || 0) - (a[sort] || 0);
    });
  }
  const bar = h('div', { class: 'list-bar' },
    h('span', { class: 'muted' }, items.length === 1 ? '1 documento' : `${items.length} documentos`),
    h('span', { class: 'grow' }),
    opts.keepOrder ? null : h('button', { class: 'btn ghost sm', onclick: e => menu(e.currentTarget, Object.entries(SORTS).map(([k, v]) => ({ label: v, checked: sort === k, onClick: () => setSetting('librarySort', k) })), { align: 'end' }) }, icon('sort', 18), h('span', { class: 'hide-sm' }, SORTS[sort])),
    h('button', { class: 'icon-btn', 'aria-label': view === 'grid' ? 'Ver como lista' : 'Ver como cuadrícula', onclick: () => setSetting('libraryView', view === 'grid' ? 'list' : 'grid') }, icon(view === 'grid' ? 'list' : 'grid', 20)),
    items.length ? h('button', { class: 'btn ghost sm' + (L.selectMode ? ' on' : ''), onclick: () => { L.selectMode = !L.selectMode; L.selected.clear(); renderMain(); } }, icon('select', 18), L.selectMode ? 'Cancelar' : 'Seleccionar') : null,
  );
  if (items.length) c.appendChild(bar);
  if (!items.length) {
    if (opts.empty) c.appendChild(emptyState(...opts.empty));
    renderBulk(items);
    return;
  }
  c.appendChild(view === 'grid' ? grid(items, opts) : list(items, opts));
  renderBulk(items);
}

async function setSetting(k, v) {
  const m = await import('./store.js');
  await m.setSetting(k, v);
}

function thumbBox(it, small) {
  const box = h('div', { class: 'thumb' + (small ? ' small' : '') + ' k-' + it.kind });
  if (it.thumb) box.appendChild(h('img', { src: it.thumb, alt: '', loading: 'lazy', draggable: false }));
  else box.appendChild(h('span', { class: 'thumb-ic' }, icon(KIND_ICON[it.kind] || 'file', small ? 22 : 40), it.kind === 'file' && !small ? h('small', null, (it.fileName || '').split('.').pop().toUpperCase()) : null));
  return box;
}

function badges(it) {
  const tags = (it.tags || []).map(id => state.tags.get(id)).filter(Boolean);
  if (!tags.length) return null;
  return h('div', { class: 'card-tags' }, tags.slice(0, 3).map(t => h('span', { class: 'tag-chip xs', style: { '--tag': t.color } }, h('span', { class: 'dot' }), t.name)),
    tags.length > 3 ? h('span', { class: 'muted xs' }, '+' + (tags.length - 3)) : null);
}

function metaLine(it, opts) {
  const parts = [];
  if (it.kind === 'pdf') parts.push('PDF');
  else if (it.kind === 'board') parts.push('Pizarra');
  else if (it.kind === 'file') parts.push(((it.fileName || '').split('.').pop() || 'archivo').toUpperCase() + (it.size ? ' · ' + fmtSize(it.size) : ''));
  if (it.pageIds?.length > 1) parts.push(it.pageIds.length + ' pág.');
  parts.push(fmtDate(it.updated));
  if (opts.showFolder && it.folderId && state.folders.get(it.folderId)) parts.push(state.folders.get(it.folderId).name);
  return parts.join(' · ');
}

function bindItemEl(el, it) {
  el.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    if (L.selectMode) { toggleSel(it.id); return; }
    openDoc(it.id);
  });
  el.addEventListener('contextmenu', e => { e.preventDefault(); itemMenu(it, { x: e.clientX, y: e.clientY }); });
  if (matchMedia('(pointer: fine)').matches) {
    el.draggable = true;
    el.addEventListener('dragstart', e => {
      const ids = L.selected.has(it.id) ? [...L.selected] : [it.id];
      e.dataTransfer.setData('text/trazo-ids', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    });
  }
  // Pulsación larga en táctil: menú.
  let lp;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    lp = setTimeout(() => { lp = null; el.dataset.lp = '1'; itemMenu(it, { x: e.clientX, y: e.clientY }); }, 550);
  });
  const cancel = () => { clearTimeout(lp); };
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointermove', e => { if (e.pointerType === 'touch' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 6)) cancel(); });
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', e => { if (el.dataset.lp) { delete el.dataset.lp; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}

function grid(items, opts = {}) {
  return h('div', { class: 'grid' }, items.map(it => {
    const el = h('a', { class: 'card' + (L.selected.has(it.id) ? ' sel' : ''), href: '#/doc/' + it.id, dataset: { id: it.id } },
      thumbBox(it),
      L.selectMode ? h('span', { class: 'check' + (L.selected.has(it.id) ? ' on' : '') }, icon('check', 16)) : null,
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, it.title),
        h('div', { class: 'card-meta' }, metaLine(it, opts)),
        badges(it)),
      h('div', { class: 'card-actions' },
        h('button', { class: 'icon-btn sm star' + (it.favorite ? ' on' : ''), 'aria-label': 'Favorito', onclick: () => updateItem(it.id, { favorite: !it.favorite }, { touch: false }) }, icon(it.favorite ? 'starFill' : 'star', 18)),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Opciones', onclick: e => itemMenu(it, e.currentTarget, opts) }, icon('more', 18))));
    bindItemEl(el, it);
    return el;
  }));
}

function list(items, opts = {}) {
  return h('div', { class: 'list' }, items.map(it => {
    const el = h('a', { class: 'row-item' + (L.selected.has(it.id) ? ' sel' : ''), href: '#/doc/' + it.id },
      L.selectMode ? h('span', { class: 'check' + (L.selected.has(it.id) ? ' on' : '') }, icon('check', 16)) : null,
      thumbBox(it, true),
      h('div', { class: 'ri-text' }, h('strong', null, it.title), h('small', null, metaLine(it, opts))),
      badges(it),
      h('button', { class: 'icon-btn sm star' + (it.favorite ? ' on' : ''), 'aria-label': 'Favorito', onclick: () => updateItem(it.id, { favorite: !it.favorite }, { touch: false }) }, icon(it.favorite ? 'starFill' : 'star', 18)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Opciones', onclick: e => itemMenu(it, e.currentTarget, opts) }, icon('more', 18)));
    bindItemEl(el, it);
    return el;
  }));
}

// ================= Selección múltiple =================
function toggleSel(id) {
  L.selected.has(id) ? L.selected.delete(id) : L.selected.add(id);
  renderMain();
}

function renderBulk(items) {
  const b = L.bulk;
  b.innerHTML = '';
  if (!L.selectMode) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  const ids = () => [...L.selected];
  const n = L.selected.size;
  const need = fn => () => { if (!n) { toast('Selecciona algún documento'); return; } fn(); };
  b.append(
    h('span', { class: 'bulk-count' }, n === 1 ? '1 seleccionado' : `${n} seleccionados`),
    h('button', { class: 'btn ghost sm', onclick: () => { items.forEach(i => L.selected.add(i.id)); renderMain(); } }, 'Todos'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn sm', onclick: need(async () => { const f = await pickFolder({}); if (f !== undefined) { await moveTo(ids(), f); } }) }, icon('move', 18), h('span', { class: 'hide-sm' }, 'Mover')),
    h('button', { class: 'btn sm', onclick: need(() => bulkTags(ids())) }, icon('tag', 18), h('span', { class: 'hide-sm' }, 'Etiquetar')),
    h('button', { class: 'btn sm', onclick: need(() => pickProject(ids())) }, icon('project', 18), h('span', { class: 'hide-sm' }, 'Proyecto')),
    h('button', { class: 'btn sm', onclick: need(() => pickCollection(ids())) }, icon('collection', 18), h('span', { class: 'hide-sm' }, 'Colección')),
    h('button', { class: 'btn sm', onclick: need(() => exportItemsCopy(ids())) }, icon('download', 18), h('span', { class: 'hide-sm' }, 'Exportar')),
    h('button', { class: 'btn danger sm', onclick: need(async () => { await trashItems(ids()); toast(`${n} a la papelera`, { action: { label: 'Deshacer', onClick: () => restoreItems(ids()) } }); L.selected.clear(); }) }, icon('trash', 18)),
    h('button', { class: 'icon-btn', 'aria-label': 'Terminar selección', onclick: () => { L.selectMode = false; L.selected.clear(); renderMain(); } }, icon('close')),
  );
}

async function bulkTags(ids) {
  const items = ids.map(id => state.items.get(id));
  const common = [...state.tags.keys()].filter(t => items.every(i => (i.tags || []).includes(t)));
  const res = await pickTags(common);
  if (!res) return;
  const removed = common.filter(t => !res.includes(t));
  await updateItems(ids, it => { it.tags = [...new Set([...(it.tags || []).filter(t => !removed.includes(t)), ...res])]; });
}

// ================= Menús de documento =================
function itemMenu(it, anchor, opts = {}) {
  const inCol = opts.collection;
  menu(anchor, [
    { label: 'Abrir', icon: 'link', onClick: () => openDoc(it.id) },
    { label: 'Renombrar', icon: 'edit', onClick: () => renameItem(it) },
    { label: it.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', icon: 'star', onClick: () => updateItem(it.id, { favorite: !it.favorite }, { touch: false }) },
    { sep: true },
    { label: 'Mover a carpeta…', icon: 'move', onClick: async () => { const f = await pickFolder({ current: it.folderId }); if (f !== undefined) moveTo([it.id], f); } },
    { label: 'Proyecto…', icon: 'project', onClick: () => pickProject([it.id]) },
    { label: 'Etiquetas…', icon: 'tag', onClick: async () => { const t = await pickTags(it.tags || []); if (t) updateItem(it.id, { tags: t }, { touch: false }); } },
    { label: 'Añadir a colección…', icon: 'collection', onClick: () => pickCollection([it.id]) },
    inCol ? { label: 'Quitar de esta colección', icon: 'close', onClick: () => removeFromCollection(inCol.id, [it.id]) } : null,
    { sep: true },
    { label: 'Duplicar', icon: 'copy', onClick: async () => { const c = await duplicateItem(it.id); toast(`Creado «${c.title}»`); } },
    it.kind !== 'file' ? { label: 'Exportar PDF', icon: 'pdf', onClick: () => exportItemPdf(it) } : null,
    { label: 'Exportar copia editable', icon: 'archive', onClick: () => exportItemsCopy([it.id]) },
    it.blobId ? { label: 'Descargar el archivo original', icon: 'download', onClick: () => downloadOriginal(it) } : null,
    { label: 'Información', icon: 'info', onClick: () => itemInfo(it) },
    { sep: true },
    { label: 'Mover a la papelera', icon: 'trash', danger: true, onClick: async () => { await trashItems([it.id]); toast(`«${it.title}» en la papelera`, { action: { label: 'Deshacer', onClick: () => restoreItems([it.id]) } }); } },
  ], { align: 'end' });
}

export async function renameItem(it) {
  const t = await promptDialog('Renombrar', { value: it.title });
  if (t) await updateItem(it.id, { title: t });
}

async function moveTo(ids, folderId) {
  await updateItems(ids, it => { it.folderId = folderId; });
  toast(folderId ? `Movido a «${state.folders.get(folderId)?.name}»` : 'Movido a la Biblioteca');
}

export async function pickProject(ids) {
  const opts = [{ label: 'Sin proyecto', value: '__none', icon: 'close' }, ...[...state.projects.values()].map(p => ({ label: p.name, value: p.id, icon: 'project', desc: STATUS[p.status] })), { label: 'Nuevo proyecto…', value: '__new', icon: 'plus' }];
  const v = await choose('Asignar a proyecto', opts);
  if (v == null) return;
  let pid = v === '__none' ? null : v;
  if (v === '__new') { const p = await editProject(); if (!p) return; pid = p.id; }
  await updateItems(ids, it => { it.projectId = pid; });
  toast(pid ? `Asignado a «${state.projects.get(pid)?.name}»` : 'Sin proyecto');
}

export async function pickCollection(ids) {
  const manual = [...state.collections.values()].filter(c => c.kind === 'manual');
  const v = await choose('Añadir a colección', [...manual.map(c => ({ label: c.name, value: c.id, icon: 'collection' })), { label: 'Nueva colección…', value: '__new', icon: 'plus' }]);
  if (v == null) return;
  let cid = v;
  if (v === '__new') {
    const name = await promptDialog('Nueva colección', { placeholder: 'Nombre' });
    if (!name) return;
    cid = (await saveCollection({ name, kind: 'manual' })).id;
  }
  await addToCollection(cid, ids);
  toast(`Añadido a «${state.collections.get(cid)?.name}»`);
}

export async function exportItemPdf(it) {
  const t = toast('Preparando PDF…', { duration: 0 });
  try {
    const { exportPdf } = await import('./exporter.js');
    const pages = await getPages(it.id);
    const blob = await exportPdf(it, pages, (i, n) => t.update(`Preparando PDF… ${i}/${n}`));
    t.close();
    await saveFile(blob, safeFileName(it.title) + '.pdf');
  } catch (e) { t.close(); errorToast(e); }
}

export async function exportItemsCopy(ids) {
  const t = toast('Preparando copia…', { duration: 0 });
  try {
    const { exportBackup } = await import('./backup.js');
    const blob = await exportBackup({ itemIds: ids });
    t.close();
    const name = ids.length === 1 ? safeFileName(state.items.get(ids[0])?.title) : `Trazo-${ids.length}-documentos`;
    await saveFile(blob, name + '.trazo.zip');
    toast('Copia lista. Para abrirla en otro dispositivo: Importar y elegir este archivo.', { duration: 6000 });
  } catch (e) { t.close(); errorToast(e); }
}

async function downloadOriginal(it) {
  const b = await getBlob(it.blobId);
  if (b) saveFile(b, it.fileName || safeFileName(it.title));
}

async function itemInfo(it) {
  const texts = await getDocTexts(it.id);
  const chars = texts.reduce((a, t) => a + t.text.length, 0);
  const rows = [
    ['Tipo', KINDS[it.kind]],
    ['Creado', new Date(it.created).toLocaleString('es-ES')],
    ['Modificado', new Date(it.updated).toLocaleString('es-ES')],
    it.pageIds?.length ? ['Páginas', it.pageIds.length] : null,
    it.fileName ? ['Archivo original', it.fileName] : null,
    it.size ? ['Tamaño', fmtSize(it.size)] : null,
    ['Carpeta', it.folderId ? folderPath(it.folderId).map(f => f.name).join(' › ') : 'Biblioteca'],
    ['Proyecto', it.projectId ? state.projects.get(it.projectId)?.name || '—' : '—'],
    ['Etiquetas', (it.tags || []).map(id => state.tags.get(id)?.name).filter(Boolean).join(', ') || '—'],
    ['Texto para buscar', chars ? `${chars.toLocaleString('es-ES')} caracteres (${[...new Set(texts.map(t => sourceLabel(t.source)))].join(', ')})` : 'Ninguno todavía'],
  ].filter(Boolean);
  modal({ title: it.title, body: h('dl', { class: 'info-list' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, String(v))])) });
}

// ================= Carpetas, proyectos, colecciones, etiquetas =================
async function newFolder(parentId) {
  const name = await promptDialog(parentId ? 'Nueva subcarpeta' : 'Nueva carpeta', { placeholder: 'Nombre de la carpeta' });
  if (!name) return;
  const f = await saveFolder({ name, parentId });
  if (parentId) { L.expanded.add(parentId); lsSet('expanded', [...L.expanded]); }
  go('#/carpeta/' + f.id);
}

const FOLDER_COLORS = [null, '#3a6df0', '#13804a', '#f08a24', '#d12a2a', '#7a4fd6', '#d6409f', '#0d9bd8', '#8a5a2b'];

function folderMenu(f, anchor) {
  menu(anchor, [
    { label: 'Abrir', icon: 'folder', onClick: () => go('#/carpeta/' + f.id) },
    { label: 'Renombrar', icon: 'edit', onClick: async () => { const n = await promptDialog('Renombrar carpeta', { value: f.name }); if (n) saveFolder({ ...f, name: n }); } },
    { label: 'Color', icon: 'palette', onClick: () => {
      let m;
      m = modal({ title: 'Color de la carpeta', body: colorGrid(FOLDER_COLORS.map(c => c || '#3a6df0'), f.color || '#3a6df0', c => { saveFolder({ ...f, color: c }); m.close(); }) });
    } },
    { label: 'Nueva subcarpeta', icon: 'folderPlus', onClick: () => newFolder(f.id) },
    { label: 'Mover a…', icon: 'move', onClick: async () => {
      const dest = await pickFolder({ title: 'Mover carpeta a', current: f.parentId || null, exclude: f.id });
      if (dest === undefined) return;
      if (dest && isDescendant(dest, f.id)) { toast('No se puede mover dentro de sí misma', { type: 'error' }); return; }
      saveFolder({ ...f, parentId: dest });
    } },
    { sep: true },
    { label: 'Eliminar carpeta', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmDialog(`Se elimina la carpeta «${f.name}». Sus documentos y subcarpetas NO se borran: pasan a la carpeta superior.`, { title: 'Eliminar carpeta', ok: 'Eliminar', danger: true })) {
        const parent = f.parentId;
        await deleteFolder(f.id);
        if (L.route.name === 'carpeta' && L.route.id === f.id) go(parent ? '#/carpeta/' + parent : '#/biblioteca');
      }
    } },
  ], { align: 'end' });
}

export async function editProject(p = null) {
  return new Promise(res => {
    const name = h('input', { class: 'input', placeholder: 'Nombre del proyecto' });
    name.value = p?.name || '';
    const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'Descripción (opcional)' });
    desc.value = p?.description || '';
    const due = h('input', { class: 'input', type: 'date' });
    due.value = p?.due || '';
    const status = h('select', { class: 'input' }, Object.entries(STATUS).map(([k, v]) => h('option', { value: k, selected: (p?.status || 'activo') === k }, v)));
    let color = p?.color || TAG_COLORS[state.projects.size % TAG_COLORS.length];
    const colors = h('div');
    const paint = () => { colors.innerHTML = ''; colors.appendChild(colorGrid(TAG_COLORS, color, c => { color = c; paint(); }, { custom: false })); };
    paint();
    modal({
      title: p ? 'Editar proyecto' : 'Nuevo proyecto',
      body: h('div', { class: 'form' },
        h('label', { class: 'field-label' }, 'Nombre'), name,
        h('label', { class: 'field-label' }, 'Estado'), status,
        h('label', { class: 'field-label' }, 'Fecha objetivo'), due,
        h('label', { class: 'field-label' }, 'Color'), colors,
        h('label', { class: 'field-label' }, 'Descripción'), desc),
      onClose: v => res(v && v.id ? v : null),
      actions: [{ label: 'Cancelar', onClick: () => null }, {
        label: p ? 'Guardar' : 'Crear', primary: true, onClick: async () => {
          if (!name.value.trim()) { name.focus(); return false; }
          return saveProject({ ...(p || {}), name: name.value.trim(), description: desc.value.trim(), due: due.value, status: status.value, color });
        },
      }],
    });
  });
}

function projectMenu(p, anchor) {
  menu(anchor, [
    { label: 'Editar', icon: 'edit', onClick: () => editProject(p) },
    ...Object.entries(STATUS).map(([k, v]) => ({ label: 'Marcar: ' + v, checked: p.status === k, onClick: () => saveProject({ ...p, status: k }) })),
    { sep: true },
    { label: 'Eliminar proyecto', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmDialog(`Se elimina el proyecto «${p.name}». Sus documentos no se borran.`, { title: 'Eliminar proyecto', ok: 'Eliminar', danger: true })) {
        await deleteProject(p.id);
        if (L.route.name === 'proyecto' && L.route.id === p.id) go('#/proyectos');
      }
    } },
  ], { align: 'end' });
}

async function newCollection() {
  const kind = await choose('Nueva colección', [
    { label: 'Colección manual', value: 'manual', icon: 'collection', desc: 'Tú eliges qué documentos entran, de cualquier carpeta.' },
    { label: 'Colección inteligente', value: 'smart', icon: 'sparkle', desc: 'Se llena sola con lo que coincide con una búsqueda (por ejemplo: #obra tipo:pdf).' },
  ]);
  if (!kind) return;
  const name = await promptDialog('Nombre de la colección', { placeholder: kind === 'smart' ? 'Ej.: Fichas técnicas' : 'Ej.: Para revisar' });
  if (!name) return;
  const c = await saveCollection({ name, kind });
  if (kind === 'smart') await editSmart(c);
  go('#/coleccion/' + c.id);
}

async function editSmart(c) {
  const q = await promptDialog('Búsqueda de la colección', {
    value: c.query || '', label: 'Palabras, "frases", #etiquetas y tipo:pdf / tipo:cuaderno / tipo:pizarra / tipo:archivo', placeholder: 'Ej.: #obra tipo:pdf',
  });
  if (q != null) await saveCollection({ ...state.collections.get(c.id), query: q });
}

function collectionMenu(c, anchor) {
  menu(anchor, [
    { label: 'Renombrar', icon: 'edit', onClick: async () => { const n = await promptDialog('Renombrar colección', { value: c.name }); if (n) saveCollection({ ...c, name: n }); } },
    c.kind === 'smart' ? { label: 'Editar búsqueda', icon: 'search', onClick: () => editSmart(c) } : null,
    { sep: true },
    { label: 'Eliminar colección', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmDialog(`Se elimina la colección «${c.name}». Los documentos no se borran.`, { title: 'Eliminar colección', ok: 'Eliminar', danger: true })) {
        await deleteCollection(c.id);
        if (L.route.name === 'coleccion' && L.route.id === c.id) go('#/');
      }
    } },
  ], { align: 'end' });
}

async function newTag() {
  const name = await promptDialog('Nueva etiqueta', { placeholder: 'Ej.: urgente' });
  if (name) await saveTag({ name: name.replace(/^#/, '').trim() });
}

function tagMenu(t, anchor) {
  menu(anchor, [
    { label: 'Renombrar', icon: 'edit', onClick: async () => { const n = await promptDialog('Renombrar etiqueta', { value: t.name }); if (n) saveTag({ ...t, name: n.replace(/^#/, '') }); } },
    { label: 'Color', icon: 'palette', onClick: () => { let m; m = modal({ title: 'Color de la etiqueta', body: colorGrid(TAG_COLORS, t.color, c => { saveTag({ ...t, color: c }); m.close(); }) }); } },
    { sep: true },
    { label: 'Eliminar etiqueta', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmDialog(`Se quita la etiqueta «${t.name}» de todos los documentos.`, { title: 'Eliminar etiqueta', ok: 'Eliminar', danger: true })) { await deleteTag(t.id); go('#/'); }
    } },
  ], { align: 'end' });
}

// ================= Crear e importar =================
function context() {
  const r = L?.route || {};
  return {
    folderId: r.name === 'carpeta' ? r.id : null,
    projectId: r.name === 'proyecto' ? r.id : null,
    collectionId: r.name === 'coleccion' && state.collections.get(r.id)?.kind === 'manual' ? r.id : null,
  };
}

async function afterCreate(items, ctx) {
  if (ctx.collectionId && items.length) await addToCollection(ctx.collectionId, items.map(i => i.id));
}

function newMenu(anchor) {
  menu(anchor, [
    { label: 'Cuaderno', icon: 'notebook', hint: 'notas', onClick: () => newNotebookDialog() },
    { label: 'Pizarra (lienzo libre)', icon: 'board', onClick: () => newBoard() },
    { sep: true },
    { label: 'Importar archivos…', icon: 'upload', onClick: () => importDialog() },
    { label: 'Hacer una foto', icon: 'camera', onClick: () => takePhoto() },
    { sep: true },
    { label: 'Carpeta', icon: 'folderPlus', onClick: () => newFolder(context().folderId) },
    { label: 'Proyecto', icon: 'project', onClick: () => editProject() },
    { label: 'Colección', icon: 'collection', onClick: () => newCollection() },
  ], { align: 'end' });
}

function paperPreview(type, color, w = 300, hgt = 400) {
  const s = `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="xMidYMid slice"><rect width="${w}" height="${hgt}" fill="${color}"/>${paperSvg(type, w, hgt, 'pv' + type + Math.random().toString(36).slice(2, 6))}</svg>`;
  return h('span', { class: 'paper-pv', html: s });
}

export function newNotebookDialog(ctxOverride) {
  const ctx = ctxOverride || context();
  const s = state.settings;
  let paper = s.defaultPaper, color = s.defaultPaperColor, size = s.defaultSize;
  const title = h('input', { class: 'input', placeholder: 'Título' });
  title.value = 'Notas ' + new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  const papers = h('div', { class: 'paper-pick' });
  const colors = h('div', { class: 'row gap wrap' });
  const sizeSel = h('select', { class: 'input' }, Object.entries(PAGE_SIZES).map(([k, v]) => h('option', { value: k, selected: k === size }, v.name)));
  sizeSel.addEventListener('change', () => { size = sizeSel.value; });
  const paint = () => {
    papers.innerHTML = '';
    for (const [k, v] of Object.entries(PAPERS)) {
      papers.appendChild(h('button', { class: 'paper-opt' + (k === paper ? ' on' : ''), onclick: () => { paper = k; paint(); } }, paperPreview(k, color), h('span', null, v)));
    }
    colors.innerHTML = '';
    for (const [c, name] of Object.entries(PAPER_COLORS)) {
      colors.appendChild(h('button', { class: 'paper-color' + (c === color ? ' on' : ''), style: { '--c': c }, title: name, onclick: () => { color = c; paint(); } }, name));
    }
  };
  paint();
  modal({
    title: 'Nuevo cuaderno', wide: true,
    body: h('div', { class: 'form' }, h('label', { class: 'field-label' }, 'Título'), title,
      h('label', { class: 'field-label' }, 'Papel'), papers,
      h('label', { class: 'field-label' }, 'Color del papel'), colors,
      h('label', { class: 'field-label' }, 'Tamaño de página'), sizeSel),
    actions: [{ label: 'Cancelar', onClick: () => null }, {
      label: 'Crear', primary: true, onClick: async () => {
        const item = await createNotebook({ title: title.value.trim() || 'Cuaderno sin título', folderId: ctx.folderId, projectId: ctx.projectId, paper, paperColor: color, size });
        await afterCreate([item], ctx);
        openDoc(item.id);
      },
    }],
  });
}

async function newBoard() {
  const ctx = context();
  const item = await createBoard({ title: 'Pizarra ' + new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), folderId: ctx.folderId, projectId: ctx.projectId });
  await afterCreate([item], ctx);
  openDoc(item.id);
}

async function importDialog() {
  const files = await pickFiles({ accept: '', multiple: true });
  if (files.length) await doImport(files);
}

async function doImport(files) {
  const ctx = context();
  const backups = files.filter(f => fileKind(f) === 'backup');
  const rest = files.filter(f => fileKind(f) !== 'backup');
  for (const b of backups) await restoreFlow(b);
  if (!rest.length) return;
  const items = await importFiles(rest, ctx);
  await afterCreate(items, ctx);
  if (items.length === 1) openDoc(items[0].id);
  else if (items.length) toast(`${items.length} documentos importados`);
}

async function takePhoto() {
  const files = await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' });
  if (!files.length) return;
  const ctx = context();
  try {
    const item = await importImage(files[0], ctx);
    await afterCreate([item], ctx);
    openDoc(item.id);
  } catch (e) { errorToast(e); }
}
