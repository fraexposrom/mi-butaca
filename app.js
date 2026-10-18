/* Mi Butaca — películas, series, anime y libros terminados.
   Los datos viven en historial.json de un repositorio privado de GitHub.
   Sin conexión se guardan en el móvil y se suben en cuanto vuelve la red. */
'use strict';

const ARCHIVO = 'historial.json';
const LS = { items: 'mb_items', sha: 'mb_sha', cfg: 'mb_cfg', sucio: 'mb_sucio' };

const PLATAFORMAS = ['Cine', 'Netflix', 'HBO', 'Prime Video', 'RTVE', '3Cat', 'Atresmedia',
  'Telegram', 'Stremio', 'Descargada', 'TV', 'Otros'];
const GENEROS = {
  general: ['Acción', 'Animación', 'Aventura', 'Bélica', 'Ciencia ficción', 'Comedia', 'Crimen',
    'Documental', 'Drama', 'Familiar', 'Fantasía', 'Histórica', 'Misterio', 'Musical', 'Romance',
    'Suspense', 'Terror', 'Thriller', 'Western'],
  anime: ['Shōnen', 'Seinen', 'Shōjo', 'Isekai', 'Mecha', 'Slice of life', 'Deportes', 'Acción',
    'Aventura', 'Comedia', 'Drama', 'Fantasía', 'Misterio', 'Romance', 'Ciencia ficción', 'Terror'],
};
const NOMBRE_TIPO = { pelicula: 'Película', serie: 'Serie', anime: 'Anime', libro: 'Libro' };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- almacenamiento local ---------------- */
function leerLS(k, def) {
  try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; }
}
function escribirLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* lleno o bloqueado */ } }

let items = leerLS(LS.items, []);
let sha = leerLS(LS.sha, null);
let cfg = leerLS(LS.cfg, null);
let sucio = leerLS(LS.sucio, false);

function guardarLocal() { escribirLS(LS.items, items); escribirLS(LS.sha, sha); escribirLS(LS.sucio, sucio); }
const visibles = () => items.filter(i => !i.borrado);
const esPend = i => i.estado === 'pendiente';
const terminados = () => visibles().filter(i => !esPend(i));
const pendientes = () => visibles().filter(esPend);
const ahora = () => new Date().toISOString();
const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const ANIO_ACTUAL = new Date().getFullYear();
/** Año en que se vio o leyó; los registros antiguos sin «anio» lo toman de sus fechas. */
const anioDe = i => Number(i.anio) || Number(String(i.fechaFin || i.fechaVisto || i.creado || '').slice(0, 4)) || ANIO_ACTUAL;
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------------- GitHub ---------------- */
function aB64(txt) {
  const bytes = new TextEncoder().encode(txt); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function deB64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
async function gh(ruta, opt = {}, c = cfg) {
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}${ruta}`, {
    ...opt, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${c.token}`,
      'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  return r;
}
/** Devuelve {items, sha} del repositorio, o {items:[], sha:null} si el archivo aún no existe. */
async function bajar(c = cfg) {
  const r = await gh(`/contents/${ARCHIVO}`, {}, c);
  if (r.status === 404) {
    const repo = await gh('', {}, c);
    if (repo.status === 404) throw new Error('No encuentro el repositorio, o el token no tiene acceso a él.');
    return { items: [], sha: null };
  }
  if (r.status === 401) throw new Error('El token no es válido o ha caducado.');
  if (r.status === 403) throw new Error('El token no tiene permiso para leer el repositorio.');
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
  const j = await r.json();
  let texto;
  if (j.encoding === 'base64' && j.content) texto = deB64(j.content);
  else { // archivos de más de 1 MB
    const b = await gh(`/git/blobs/${j.sha}`, {}, c); if (!b.ok) throw new Error(`GitHub respondió ${b.status}.`);
    texto = deB64((await b.json()).content);
  }
  let datos;
  try { datos = JSON.parse(texto || '{}'); } catch { throw new Error(`${ARCHIVO} no es un JSON válido. Revísalo en GitHub.`); }
  const lista = Array.isArray(datos) ? datos : (datos.items || []);
  lista.forEach(i => { if (!i.id) i.id = nuevoId(); if (!i.actualizado) i.actualizado = i.creado || '1970-01-01T00:00:00Z'; });
  return { items: lista, sha: j.sha };
}
/** Une dos listas: por cada id gana la versión con «actualizado» más reciente. */
function unir(a, b) {
  const m = new Map(); for (const i of a) m.set(i.id, i);
  for (const i of b) { const x = m.get(i.id); if (!x || (i.actualizado || '') > (x.actualizado || '')) m.set(i.id, i); }
  return [...m.values()];
}

let cadena = Promise.resolve();
function sincronizar(motivo) { cadena = cadena.then(() => sincronizarYa(motivo)).catch(() => {}); return cadena; }
async function sincronizarYa() {
  if (!cfg) { pintarEstado(); return; }
  if (!navigator.onLine) { pintarEstado(); return; }
  pintarEstado('girando');
  try {
    for (let intento = 0; intento < 4; intento++) {
      const remoto = await bajar();
      const antes = JSON.stringify(ordenar(items));
      items = unir(remoto.items, items);
      sha = remoto.sha;
      const hayQueSubir = sucio || remoto.sha === null || JSON.stringify(ordenar(remoto.items)) !== JSON.stringify(ordenar(items));
      if (!hayQueSubir) { sucio = false; guardarLocal(); if (antes !== JSON.stringify(ordenar(items))) pintarTodo(); break; }
      const cuerpo = { version: 1, actualizado: ahora(), items: ordenar(items) };
      const r = await gh(`/contents/${ARCHIVO}`, { method: 'PUT', body: JSON.stringify({
        message: `${cfg.nombre || 'Mi Butaca'}: actualiza el historial`,
        content: aB64(JSON.stringify(cuerpo, null, 1) + '\n'), ...(sha ? { sha } : {}),
      }) });
      if (r.status === 409 || r.status === 422) continue; // otro móvil guardó a la vez: se vuelve a unir
      if (r.status === 403 || r.status === 404) throw new Error('El token no tiene permiso de escritura (Contents: Read and write).');
      if (!r.ok) throw new Error(`GitHub respondió ${r.status} al guardar.`);
      sha = (await r.json()).content.sha; sucio = false; guardarLocal(); pintarTodo(); break;
    }
    ultimoError = null;
  } catch (e) {
    ultimoError = e.message || 'Sin conexión con GitHub.';
  }
  pintarEstado();
}
let ultimoError = null;
const ordenar = l => [...l].sort((a, b) => (a.creado || '').localeCompare(b.creado || '') || a.id.localeCompare(b.id));

function pintarEstado(modo) {
  const dot = $('#syncDot'), txt = $('#syncTxt');
  dot.className = 'dot';
  if (!cfg) { txt.textContent = 'Solo en este móvil'; dot.classList.add('pend'); return; }
  if (modo === 'girando') { dot.classList.add('pend', 'girando'); txt.textContent = 'Sincronizando…'; return; }
  if (ultimoError) { dot.classList.add('err'); txt.textContent = 'Error al sincronizar'; return; }
  if (!navigator.onLine) { dot.classList.add('pend'); txt.textContent = sucio ? 'Sin conexión · pendiente' : 'Sin conexión'; return; }
  if (sucio) { dot.classList.add('pend'); txt.textContent = 'Pendiente de subir'; return; }
  dot.classList.add('ok'); txt.textContent = 'Guardado en GitHub';
}

/* ---------------- pestañas ---------------- */
const TITULOS = { vistas: 'Vistas', anadir: 'Añadir', leidos: 'Leídos' };
function irA(tab) {
  $$('.tab').forEach(s => { s.hidden = s.id !== `tab-${tab}`; });
  $$('.barra button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#tituloSeccion').textContent = TITULOS[tab];
  window.scrollTo(0, 0);
}
$$('.barra button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.tab !== 'anadir' && editandoId) salirEdicion();
  irA(b.dataset.tab);
}));

let segV = 'hecho', segL = 'hecho';
function pintarSegmentos() {
  $$('#segV button').forEach(b => b.classList.toggle('on', b.dataset.s === segV));
  $$('#segL button').forEach(b => b.classList.toggle('on', b.dataset.s === segL));
  $('#vHecho').hidden = segV !== 'hecho'; $('#vPend').hidden = segV !== 'pendiente';
  $('#lHecho').hidden = segL !== 'hecho'; $('#lPend').hidden = segL !== 'pendiente';
}
$('#segV').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { segV = b.dataset.s; pintarSegmentos(); window.scrollTo(0, 0); } });
$('#segL').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { segL = b.dataset.s; pintarSegmentos(); window.scrollTo(0, 0); } });
function irLista(t, seg) {
  if (t === 'libro') { segL = seg; irA('leidos'); } else { segV = seg; irA('vistas'); }
  pintarSegmentos();
}

/* ---------------- formulario ---------------- */
const form = $('#form');
let tipo = 'pelicula';
let plataforma = null;
let formato = 'Kindle';
let editandoId = null;
let modo = 'hecho'; // 'hecho' = ya terminado · 'pendiente' = lo quiero ver/leer

$('#plataformas').innerHTML = PLATAFORMAS.map(p => `<button type="button" class="chip" data-v="${p}">${p}</button>`).join('');
$('#plataformas').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  plataforma = plataforma === b.dataset.v ? null : b.dataset.v; pintarChips();
  if (plataforma === 'Otros') $('#plataformaOtro').focus();
});
$('#formatos').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { formato = b.dataset.v; pintarChips(); } });
function pintarChips() {
  $$('#plataformas .chip').forEach(b => b.classList.toggle('on', b.dataset.v === plataforma));
  $$('#formatos .chip').forEach(b => b.classList.toggle('on', b.dataset.v === formato));
  $('#plataformaOtro').hidden = plataforma !== 'Otros';
}

$('#tipoSel').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || editandoId) return; ponerTipo(b.dataset.t);
});
function ponerTipo(t) {
  tipo = t;
  $$('#tipoSel button').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  visibilidad();
  $('#anioEtq').textContent = t === 'libro' ? 'Año en que lo leíste' : t === 'pelicula' ? 'Año en que la viste' : 'Año en que la terminaste';
  $('#dlGeneros').innerHTML = (t === 'anime' ? GENEROS.anime : GENEROS.general).concat(generosUsados(t))
    .filter((g, i, a) => a.indexOf(g) === i).map(g => `<option value="${esc(g)}">`).join('');
  $$('.mal', form).forEach(i => i.classList.remove('mal'));
}
/** Muestra solo los campos del tipo y del modo elegidos. */
function visibilidad() {
  $$('[data-para],[data-solo]', form).forEach(el => {
    const p = el.dataset.para, so = el.dataset.solo;
    el.hidden = !!((p && !p.split(' ').includes(tipo)) || (so && so !== modo));
  });
  $('#dondeEtq').innerHTML = modo === 'pendiente' ? '¿Dónde la verás? <small>(opcional)</small>' : '¿Dónde la has visto?';
  $('#btnConvertir').textContent = tipo === 'libro' ? '✓ Ya lo he leído' : '✓ Ya la he visto';
  $('#btnGuardar').textContent = editandoId ? 'Guardar cambios' : modo === 'pendiente'
    ? (tipo === 'libro' ? 'Añadir a Por leer' : 'Añadir a Por ver') : 'Guardar';
}
function ponerModo(m) {
  modo = m;
  $$('#modoSel button').forEach(b => { const on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  visibilidad(); $$('.mal', form).forEach(i => i.classList.remove('mal'));
}
$('#modoSel').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !editandoId) ponerModo(b.dataset.m); });
function generosUsados(t) { return visibles().filter(i => i.tipo === t && i.genero).map(i => i.genero); }

function limpiarForm() {
  form.reset(); plataforma = null; formato = 'Kindle'; form.fechaFin.value = hoyISO(); form.anio.value = ANIO_ACTUAL; pintarChips();
  $$('.mal', form).forEach(i => i.classList.remove('mal'));
}
function cambiarAnio(n) {
  form.anio.value = n; form.anio.classList.remove('mal');
  if (form.fechaFin.value && Number(form.fechaFin.value.slice(0, 4)) !== n) form.fechaFin.value = '';
}
$('#anioMenos').addEventListener('click', () => cambiarAnio((Number(form.anio.value) || ANIO_ACTUAL) - 1));
$('#anioMas').addEventListener('click', () => cambiarAnio(Math.min(ANIO_ACTUAL + 1, (Number(form.anio.value) || ANIO_ACTUAL) + 1)));
form.anio.addEventListener('change', () => { const n = Number(form.anio.value); if (n >= 1900) cambiarAnio(n); });
form.fechaFin.addEventListener('change', () => { if (form.fechaFin.value) { form.anio.value = form.fechaFin.value.slice(0, 4); form.anio.classList.remove('mal'); } });
/** Lee un precio escrito con coma o punto («19,90», «19.9», «20 €»). Vacío → null; inválido → NaN. */
function leerPrecio(v) {
  const t = String(v || '').replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100) / 100;
}
const euros = n => n.toLocaleString('es-ES', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
const num = v => (v === '' || v == null ? null : Math.max(0, Number(v)));

form.addEventListener('submit', e => {
  e.preventDefault();
  const campoTitulo = tipo === 'libro' ? form.libro : form.titulo;
  const titulo = campoTitulo.value.trim();
  if (!titulo) { campoTitulo.classList.add('mal'); campoTitulo.focus(); avisar(tipo === 'libro' ? 'Falta el nombre del libro' : 'Falta el título'); return; }
  if (plataforma === 'Otros' && !form.plataformaOtro.value.trim() && tipo !== 'libro') {
    form.plataformaOtro.classList.add('mal'); form.plataformaOtro.focus(); avisar('Escribe dónde la has visto'); return;
  }
  const anio = Number(form.anio.value);
  if (modo === 'hecho' && (!Number.isInteger(anio) || anio < 1900 || anio > ANIO_ACTUAL + 1)) {
    form.anio.classList.add('mal'); form.anio.focus(); avisar('Revisa el año'); return;
  }
  const precio = tipo === 'libro' && modo === 'hecho' ? leerPrecio(form.precio.value) : null;
  if (Number.isNaN(precio)) { form.precio.classList.add('mal'); form.precio.focus(); avisar('Revisa el precio (ej. 19,90)'); return; }
  const previo = editandoId ? items.find(i => i.id === editandoId) : null;
  const base = { id: previo ? previo.id : nuevoId(), tipo, titulo, anio, creado: previo ? previo.creado : ahora(),
    actualizado: ahora(), por: cfg?.nombre || previo?.por || '' };
  let item, quitado = null;
  if (modo === 'pendiente') {
    item = { ...base, estado: 'pendiente', nota: form.nota.value.trim(), ganas: form.ganas.checked };
    delete item.anio;
    if (tipo === 'libro') item.autor = form.autor.value.trim();
    else {
      Object.assign(item, { genero: form.genero.value.trim(), plataforma, plataformaOtro: plataforma === 'Otros' ? form.plataformaOtro.value.trim() : '' });
      if (tipo !== 'pelicula') item.temporada = num(form.temporada.value);
    }
  } else if (tipo === 'libro') {
    item = { ...base, autor: form.autor.value.trim(), formato, paginas: num(form.paginas.value), precio, fechaFin: form.fechaFin.value && Number(form.fechaFin.value.slice(0, 4)) === anio ? form.fechaFin.value : null };
  } else {
    item = { ...base, genero: form.genero.value.trim(), plataforma,
      plataformaOtro: plataforma === 'Otros' ? form.plataformaOtro.value.trim() : '', recomienda: form.recomienda.checked,
      fechaVisto: previo?.fechaVisto && Number(previo.fechaVisto.slice(0, 4)) === anio ? previo.fechaVisto : (anio === ANIO_ACTUAL ? hoyISO() : null) };
    if (tipo === 'pelicula') item.duracion = num(form.duracion.value);
    else Object.assign(item, { temporada: num(form.temporada.value), capitulos: num(form.capitulos.value), duracionCap: num(form.duracionCap.value) });
  }
  if (previo) items[items.indexOf(previo)] = item; else items.push(item);
  // Si acabas algo que tenías pendiente, sale de la lista de pendientes
  if (!previo && modo === 'hecho') {
    const p = pendientes().find(i => (i.tipo === 'libro') === (tipo === 'libro') && normal(i.titulo) === normal(titulo));
    if (p) { p.borrado = true; p.actualizado = ahora(); quitado = p; }
  }
  sucio = true; guardarLocal();
  const eraEdicion = !!editandoId, eraConversion = previo && esPend(previo) && modo === 'hecho';
  const lista = tipo === 'libro' ? (modo === 'pendiente' ? 'Por leer' : 'Leídos') : (modo === 'pendiente' ? 'Por ver' : 'Vistas');
  $('#ultimo').textContent = eraEdicion ? '' : `${modo === 'pendiente' ? 'Último pendiente' : 'Último'}: ${NOMBRE_TIPO[tipo]} · ${titulo}`;
  if (eraEdicion) {
    const m = modo; salirEdicion(); irLista(tipo, m);
    avisar(eraConversion ? `¡A ${lista}!` : 'Cambios guardados');
  } else {
    limpiarForm();
    avisar(modo === 'pendiente' ? `${titulo} añadido a ${lista}` : quitado ? `${titulo} guardado y quitado de ${tipo === 'libro' ? 'Por leer' : 'Por ver'}` : `${titulo} guardado`);
  }
  pintarTodo(); sincronizar();
});

function editar(id) {
  const it = items.find(i => i.id === id); if (!it) return;
  editandoId = id; ponerTipo(it.tipo); ponerModo(esPend(it) ? 'pendiente' : 'hecho'); limpiarForm(); form.anio.value = anioDe(it);
  form.nota.value = it.nota || ''; form.ganas.checked = !!it.ganas;
  if (it.tipo === 'libro') {
    form.libro.value = it.titulo; form.autor.value = it.autor || ''; formato = it.formato || 'Kindle';
    form.paginas.value = it.paginas ?? ''; form.precio.value = it.precio != null ? String(it.precio).replace('.', ',') : ''; form.fechaFin.value = it.fechaFin || '';
  } else {
    form.titulo.value = it.titulo; form.genero.value = it.genero || ''; plataforma = it.plataforma || null;
    form.plataformaOtro.value = it.plataformaOtro || ''; form.recomienda.checked = !!it.recomienda;
    form.duracion.value = it.duracion ?? ''; form.temporada.value = it.temporada ?? '';
    form.capitulos.value = it.capitulos ?? ''; form.duracionCap.value = it.duracionCap ?? '';
  }
  pintarChips();
  $('#avisoEdicion').hidden = false; $('#editPre').textContent = 'Editando'; $('#editTitulo').textContent = it.titulo;
  $('#accionesEdicion').hidden = false; $('#btnConvertir').hidden = !esPend(it); visibilidad();
  $('#tipoSel').style.opacity = .5; $('#modoSel').style.opacity = .5; $('#ultimo').textContent = '';
  irA('anadir');
}
/** Pasa un pendiente a terminado: el formulario se completa con lo que ya tenía. */
function convertir() {
  ponerModo('hecho'); form.anio.value = ANIO_ACTUAL;
  if (tipo === 'libro' && !form.fechaFin.value) form.fechaFin.value = hoyISO();
  $('#btnConvertir').hidden = true;
  $('#editPre').textContent = tipo === 'libro' ? 'Completa los datos de lectura de' : 'Completa los datos de';
  $('#btnGuardar').textContent = tipo === 'libro' ? 'Guardar en Leídos' : 'Guardar en Vistas';
  window.scrollTo(0, 0);
}
$('#btnConvertir').addEventListener('click', convertir);
function salirEdicion() {
  editandoId = null; limpiarForm(); ponerModo('hecho');
  $('#avisoEdicion').hidden = true; $('#accionesEdicion').hidden = true; $('#btnConvertir').hidden = true;
  $('#tipoSel').style.opacity = ''; $('#modoSel').style.opacity = ''; visibilidad();
}
$('#btnCancelar').addEventListener('click', () => {
  const it = items.find(i => i.id === editandoId), t = tipo; salirEdicion(); irLista(t, it && esPend(it) ? 'pendiente' : 'hecho');
});
$('#btnBorrar').addEventListener('click', () => {
  const it = items.find(i => i.id === editandoId); if (!it) return;
  if (!confirm(`¿Borrar «${it.titulo}»?`)) return;
  it.borrado = true; it.actualizado = ahora(); sucio = true; guardarLocal();
  const t = it.tipo, m = esPend(it) ? 'pendiente' : 'hecho'; salirEdicion(); irLista(t, m); pintarTodo(); sincronizar();
  avisar('Borrado');
});

/* ---------------- listas ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const donde = i => (i.plataforma === 'Otros' ? (i.plataformaOtro || 'Otros') : i.plataforma) || '';
const minutos = i => i.tipo === 'pelicula' ? (i.duracion || 0) : (i.capitulos || 0) * (i.duracionCap || 0);
function horas(min) {
  if (min < 60) return `${min} min`;
  const h = min / 60; return h >= 100 ? `${Math.round(h)} h` : `${h.toFixed(1).replace('.', ',').replace(',0', '')} h`;
}
function fechaCorta(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let filtro = 'todo';
let anioV = 'todos', anioL = 'todos';
$('#filtroVistas').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; filtro = b.dataset.f;
  $$('#filtroVistas .chip').forEach(c => c.classList.toggle('on', c === b)); pintarVistas();
});
$('#anioVistas').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { anioV = b.dataset.a; pintarVistas(); } });
$('#anioLeidos').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { anioL = b.dataset.a; pintarLeidos(); } });
$('#buscarVistas').addEventListener('input', pintarVistas);
$('#buscarLeidos').addEventListener('input', pintarLeidos);
document.addEventListener('click', e => { const b = e.target.closest('.item'); if (b) editar(b.dataset.id); });

/** Pinta los chips de año (solo los años con algo) y devuelve el año elegido, válido. */
function chipsAnios(el, lista, sel) {
  const anios = [...new Set(lista.map(anioDe))].sort((a, b) => b - a);
  if (sel !== 'todos' && !anios.includes(Number(sel))) sel = 'todos';
  el.hidden = !anios.length;
  el.innerHTML = [`<button class="chip${sel === 'todos' ? ' on' : ''}" data-a="todos">Todos los años</button>`]
    .concat(anios.map(a => `<button class="chip${String(a) === String(sel) ? ' on' : ''}" data-a="${a}">${a}</button>`)).join('');
  return sel;
}
const porFecha = (fa, fb) => (b, a) => (fa(a) || '').localeCompare(fa(b) || '') || (a.creado || '').localeCompare(b.creado || '');
/** Agrupa por año (más reciente primero) conservando el orden de cada grupo. */
function porAnio(lista) {
  const g = new Map();
  for (const i of lista) { const k = anioDe(i); if (!g.has(k)) g.set(k, []); g.get(k).push(i); }
  return [...g].sort((a, b) => b[0] - a[0]);
}
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function pintarVistas() {
  const todos = terminados().filter(i => i.tipo !== 'libro');
  anioV = chipsAnios($('#anioVistas'), todos, anioV);
  const q = normal($('#buscarVistas').value);
  const porTipo = i => filtro === 'todo' || (filtro === 'rec' ? i.recomienda : i.tipo === filtro);
  const porAnioSel = i => anioV === 'todos' || anioDe(i) === Number(anioV);
  const base = todos.filter(i => porTipo(i) && porAnioSel(i));
  const lista = base.filter(i => !q || normal([i.titulo, i.genero, donde(i), NOMBRE_TIPO[i.tipo]].join(' ')).includes(q))
    .sort(porFecha(i => i.fechaVisto || i.creado));
  const totMin = base.reduce((s, i) => s + minutos(i), 0);
  const rec = base.length ? Math.round(100 * base.filter(i => i.recomienda).length / base.length) : 0;
  const cuando = anioV === 'todos' ? '' : ` en ${anioV}`;
  $('#statsVistas').innerHTML = `
    <div class="stat"><b>${base.length}</b><span>${filtro === 'pelicula' ? 'películas' : 'títulos'}${cuando}</span></div>
    <div class="stat"><b>${horas(totMin)}</b><span>vistas${cuando}</span></div>
    <div class="stat"><b>${rec}%</b><span>recomendadas</span></div>`;
  if (!lista.length) { $('#listaVistas').innerHTML = `<ul class="lista">${vacio(todos.length, '¿Qué has visto últimamente?', 'Añádelo desde el botón central.')}</ul>`; return; }
  $('#listaVistas').innerHTML = porAnio(lista).map(([anio, l]) => {
    const min = l.reduce((s, i) => s + minutos(i), 0);
    return `<h2 class="grupo"><span>${anio}</span><small>${plural(l.length, 'título', 'títulos')}${min ? ' · ' + horas(min) : ''}</small></h2>
    <ul class="lista">${l.map(i => {
      const partes = [NOMBRE_TIPO[i.tipo]];
      if (i.tipo === 'pelicula') { if (i.duracion) partes.push(`${i.duracion} min`); }
      else {
        if (i.temporada != null) partes.push(`T${i.temporada}`);
        if (i.capitulos) partes.push(`${i.capitulos} cap.${i.duracionCap ? ` × ${i.duracionCap} min` : ''}`);
      }
      if (i.genero) partes.push(i.genero); if (donde(i)) partes.push(donde(i));
      const f = i.fechaVisto && Number(i.fechaVisto.slice(0, 4)) === anio ? fechaCorta(i.fechaVisto) : '';
      return `<li><button class="item" data-id="${esc(i.id)}"><span class="marca ${i.tipo}"></span><span class="cuerpo">
        <span class="t"><em>${esc(i.titulo)}</em>${i.recomienda ? '<span class="rec" title="La recomendaría">👍</span>' : ''}</span>
        <span class="m">${partes.map(esc).join(' · ')}</span></span><span class="d">${f}</span></button></li>`;
    }).join('')}</ul>`;
  }).join('');
}

function pintarLeidos() {
  const todos = terminados().filter(i => i.tipo === 'libro');
  anioL = chipsAnios($('#anioLeidos'), todos, anioL);
  const q = normal($('#buscarLeidos').value);
  const base = todos.filter(i => anioL === 'todos' || anioDe(i) === Number(anioL));
  const lista = base.filter(i => !q || normal([i.titulo, i.autor, i.formato].join(' ')).includes(q))
    .sort(porFecha(i => i.fechaFin || i.creado));
  const pags = base.reduce((s, i) => s + (i.paginas || 0), 0);
  const conPags = base.filter(i => i.paginas);
  $('#statsLeidos').innerHTML = anioL === 'todos' ? `
    <div class="stat"><b>${base.length}</b><span>libros</span></div>
    <div class="stat"><b>${todos.filter(i => anioDe(i) === ANIO_ACTUAL).length}</b><span>en ${ANIO_ACTUAL}</span></div>
    <div class="stat"><b>${pags.toLocaleString('es-ES')}</b><span>páginas</span></div>` : `
    <div class="stat"><b>${base.length}</b><span>libros en ${anioL}</span></div>
    <div class="stat"><b>${pags.toLocaleString('es-ES')}</b><span>páginas</span></div>
    <div class="stat"><b>${conPags.length ? Math.round(pags / conPags.length).toLocaleString('es-ES') : '–'}</b><span>págs. por libro</span></div>`;
  if (!lista.length) { $('#listaLeidos').innerHTML = `<ul class="lista">${vacio(todos.length, '¿Qué has leído últimamente?', 'Añádelo desde el botón central eligiendo «Libro».')}</ul>`; return; }
  $('#listaLeidos').innerHTML = porAnio(lista).map(([anio, l]) => {
    const p = l.reduce((s, i) => s + (i.paginas || 0), 0);
    const gasto = l.reduce((s, i) => s + (i.precio || 0), 0);
    return `<h2 class="grupo"><span>${anio}</span><small>${plural(l.length, 'libro', 'libros')}${p ? ' · ' + p.toLocaleString('es-ES') + ' págs.' : ''}${gasto ? ' · ' + euros(gasto) : ''}</small></h2>
    <ul class="lista">${l.map(i => {
      const partes = [i.autor, i.formato, i.paginas ? `${i.paginas} págs.` : '', i.precio != null ? euros(i.precio) : ''].filter(Boolean);
      return `<li><button class="item" data-id="${esc(i.id)}"><span class="marca libro"></span><span class="cuerpo">
        <span class="t"><em>${esc(i.titulo)}</em></span><span class="m">${partes.map(esc).join(' · ')}</span></span>
        <span class="d">${fechaCorta(i.fechaFin)}</span></button></li>`;
    }).join('')}</ul>`;
  }).join('');
}
let filtroPV = 'todo', filtroPL = 'todo';
$('#filtroPorVer').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; filtroPV = b.dataset.f;
  $$('#filtroPorVer .chip').forEach(c => c.classList.toggle('on', c === b)); pintarPorVer();
});
$('#filtroPorLeer').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; filtroPL = b.dataset.f;
  $$('#filtroPorLeer .chip').forEach(c => c.classList.toggle('on', c === b)); pintarPorLeer();
});
$('#buscarPorVer').addEventListener('input', pintarPorVer);
$('#buscarPorLeer').addEventListener('input', pintarPorLeer);
const ordenPend = (a, b) => (b.ganas ? 1 : 0) - (a.ganas ? 1 : 0) || (b.creado || '').localeCompare(a.creado || '');

function filtrarPorVer() {
  const q = normal($('#buscarPorVer').value);
  return pendientes().filter(i => i.tipo !== 'libro')
    .filter(i => filtroPV === 'todo' || (filtroPV === 'ganas' ? i.ganas : i.tipo === filtroPV))
    .filter(i => !q || normal([i.titulo, i.genero, donde(i), i.nota, NOMBRE_TIPO[i.tipo]].join(' ')).includes(q))
    .sort(ordenPend);
}
function filtrarPorLeer() {
  const q = normal($('#buscarPorLeer').value);
  return pendientes().filter(i => i.tipo === 'libro')
    .filter(i => filtroPL === 'todo' || i.ganas)
    .filter(i => !q || normal([i.titulo, i.autor, i.nota].join(' ')).includes(q))
    .sort(ordenPend);
}
const metaPend = i => i.tipo === 'libro' ? [i.autor].filter(Boolean)
  : [NOMBRE_TIPO[i.tipo], i.temporada != null && i.tipo !== 'pelicula' ? `T${i.temporada}` : '', i.genero, donde(i)].filter(Boolean);
function filaPend(i) {
  return `<li><button class="item" data-id="${esc(i.id)}"><span class="marca ${i.tipo}"></span><span class="cuerpo">
    <span class="t"><em>${esc(i.titulo)}</em>${i.ganas ? '<span class="ganas" title="Muchas ganas">⭐</span>' : ''}</span>
    <span class="m">${metaPend(i).map(esc).join(' · ')}</span>${i.nota ? `<span class="nota">${esc(i.nota)}</span>` : ''}</span>
    <span class="d">${fechaCorta(i.creado)}</span></button></li>`;
}
function pintarPorVer() {
  const total = pendientes().filter(i => i.tipo !== 'libro').length, l = filtrarPorVer();
  $('#elegirV').hidden = !total;
  $('#listaPorVer').innerHTML = l.length ? l.map(filaPend).join('')
    : vacio(total, 'Nada pendiente todavía', 'Apunta lo que quieras ver desde el botón central, eligiendo «Lo tengo pendiente».');
}
function pintarPorLeer() {
  const total = pendientes().filter(i => i.tipo === 'libro').length, l = filtrarPorLeer();
  $('#elegirL').hidden = !total;
  $('#listaPorLeer').innerHTML = l.length ? l.map(filaPend).join('')
    : vacio(total, 'Nada pendiente todavía', 'Apunta lo que quieras leer desde el botón central, eligiendo «Libro» y «Lo tengo pendiente».');
}

/* «Elige por mí»: sorteo entre lo pendiente (con el filtro activo); lo que tiene ⭐ cuenta triple. */
let sorteoLista = [], sorteoUltimo = null, sorteoLibro = false;
function elegirPorMi(libros) {
  const l = libros ? filtrarPorLeer() : filtrarPorVer();
  if (!l.length) { avisar('No hay nada con ese filtro'); return; }
  sorteoLista = l; sorteoUltimo = null; sorteoLibro = libros;
  $('#sorteoPre').textContent = libros ? '¿Y si lees…' : '¿Y si ves…';
  $('#sorteoOtra').disabled = l.length < 2;
  tirar(); $('#sorteo').showModal();
}
function tirar() {
  const pool = sorteoLista.length > 1 ? sorteoLista.filter(i => i.id !== sorteoUltimo) : sorteoLista;
  const peso = i => (i.ganas ? 3 : 1);
  let r = Math.random() * pool.reduce((s, i) => s + peso(i), 0), elegido = pool[0];
  for (const i of pool) { r -= peso(i); if (r < 0) { elegido = i; break; } }
  sorteoUltimo = elegido.id;
  const c = $('#sorteoCarta'), i = elegido;
  const sub = i.tipo === 'libro' ? [i.autor] : [i.temporada != null && i.tipo !== 'pelicula' ? `Temporada ${i.temporada}` : '', i.genero, donde(i)];
  c.innerHTML = `<span class="tipo-t">${NOMBRE_TIPO[i.tipo]}${i.ganas ? ' · ⭐ muchas ganas' : ''}</span><h3>${esc(i.titulo)}</h3>
    ${sub.filter(Boolean).length ? `<p>${sub.filter(Boolean).map(esc).join(' · ')}</p>` : ''}${i.nota ? `<p class="nota">«${esc(i.nota)}»</p>` : ''}`;
  c.classList.remove('gira'); void c.offsetWidth; c.classList.add('gira');
}
$('#elegirV').addEventListener('click', () => elegirPorMi(false));
$('#elegirL').addEventListener('click', () => elegirPorMi(true));
$('#sorteoOtra').addEventListener('click', tirar);
$('#sorteoVale').addEventListener('click', () => { $('#sorteo').close(); avisar(sorteoLibro ? '¡Buena lectura! 📖' : '¡A disfrutarla! 🍿'); });
$('#sorteoCerrar').addEventListener('click', () => $('#sorteo').close());

function vacio(hayAlgo, titulo, texto) {
  return hayAlgo ? '<li class="vacio"><b>Nada coincide</b>Prueba con otra búsqueda o filtro.</li>'
    : `<li class="vacio"><b>${titulo}</b>${texto}</li>`;
}
function pintarTodo() {
  pintarVistas(); pintarLeidos(); pintarPorVer(); pintarPorLeer(); pintarSegmentos();
  const n = (l, libro) => l.filter(i => (i.tipo === 'libro') === libro).length || '';
  $('#nVistas').textContent = n(terminados(), false); $('#nPorVer').textContent = n(pendientes(), false);
  $('#nLeidos').textContent = n(terminados(), true); $('#nPorLeer').textContent = n(pendientes(), true);
  $('#dlAutores').innerHTML = [...new Set(visibles().filter(i => i.autor).map(i => i.autor))].map(a => `<option value="${esc(a)}">`).join('');
  pintarEstado();
}

/* ---------------- ajustes ---------------- */
const dlg = $('#ajustes'), fa = $('#formAjustes');
$('#btnSync').addEventListener('click', () => {
  fa.owner.value = cfg?.owner || ''; fa.repo.value = cfg?.repo || 'mi-butaca-datos';
  fa.token.value = cfg?.token || ''; fa.nombre.value = cfg?.nombre || '';
  const est = $('#estadoConexion');
  est.className = 'estado' + (ultimoError ? ' err' : cfg ? ' ok' : '');
  est.textContent = ultimoError || (cfg ? `Conectado a ${cfg.owner}/${cfg.repo}` : 'Sin conectar: los datos solo están en este móvil.');
  $('#btnDesconectar').disabled = !cfg;
  dlg.showModal();
});
$('#btnCerrar').addEventListener('click', () => dlg.close());
$('#btnConectar').addEventListener('click', async () => {
  const nuevo = { owner: fa.owner.value.trim(), repo: fa.repo.value.trim(), token: fa.token.value.trim(), nombre: fa.nombre.value.trim() };
  const est = $('#estadoConexion');
  if (!nuevo.owner || !nuevo.repo || !nuevo.token) { est.className = 'estado err'; est.textContent = 'Rellena usuario, repositorio y token.'; return; }
  est.className = 'estado'; est.textContent = 'Comprobando…';
  try {
    await bajar(nuevo);
    cfg = nuevo; escribirLS(LS.cfg, cfg); ultimoError = null;
    if (visibles().length) sucio = true; // lo que había en el móvil se suma al repositorio
    guardarLocal(); await sincronizar();
    if (ultimoError) { est.className = 'estado err'; est.textContent = ultimoError; return; }
    est.className = 'estado ok'; est.textContent = `Conectado a ${cfg.owner}/${cfg.repo}`;
    setTimeout(() => dlg.close(), 700); avisar('Conectado con GitHub');
  } catch (e) { est.className = 'estado err'; est.textContent = e.message || 'No se pudo conectar.'; }
});
$('#btnDesconectar').addEventListener('click', () => {
  if (!confirm('¿Desconectar este móvil? Tus datos siguen en GitHub; aquí se queda una copia.')) return;
  cfg = null; ultimoError = null; try { localStorage.removeItem(LS.cfg); } catch { /* */ }
  sha = null; sucio = false; guardarLocal(); pintarEstado(); dlg.close();
});
$('#btnExportar').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 1, items: ordenar(items) }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `mi-butaca-${hoyISO()}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ---------------- varios ---------------- */
let tToast;
function avisar(t) { const el = $('#toast'); el.textContent = t; el.classList.add('ver'); clearTimeout(tToast); tToast = setTimeout(() => el.classList.remove('ver'), 2200); }
addEventListener('online', () => sincronizar());
addEventListener('offline', () => pintarEstado());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

ponerTipo('pelicula'); ponerModo('hecho'); limpiarForm(); pintarTodo(); sincronizar();
