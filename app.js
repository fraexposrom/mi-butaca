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
/** Sello de modificación: siempre posterior al anterior, aunque el reloj de otro móvil vaya adelantado. */
/** Fecha ISO → milisegundos (comparar como texto falla con «…00Z» frente a «…00.001Z»). */
const ms = iso => Date.parse(iso || '') || 0;
const sello = prev => { const n = Date.now(), p = ms(prev?.actualizado); return new Date(p >= n ? p + 1 : n).toISOString(); };
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
  if (c === cfg && cfg) {
    if (r.status === 401) tokenMalo = true; else if (r.ok) tokenMalo = false;
    // GitHub indica la caducidad del token en esta cabecera (si el navegador la deja leer, se guarda sola)
    const exp = (r.headers.get('github-authentication-token-expiration') || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp) && cfg.caduca !== exp) { cfg.caduca = exp; escribirLS(LS.cfg, cfg); }
  }
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
  lista.forEach(i => { if (!i.id) i.id = nuevoId(); if (!i.actualizado) i.actualizado = i.creado || '1970-01-01T00:00:00Z'; normalizar(i); });
  return { items: lista, sha: j.sha };
}
/** Une dos listas: por cada id gana la versión con «actualizado» más reciente. */
/** Deja los campos numéricos como números (por si se editaron a mano en GitHub como texto, p. ej. "19,90"). */
function normalizar(i) {
  for (const k of ['anio', 'paginas', 'duracion', 'capitulos', 'duracionCap', 'temporada', 'temporadaFin']) {
    if (i[k] == null) continue;
    const n = typeof i[k] === 'number' ? i[k] : Number(String(i[k]).replace(',', '.').trim() || NaN);
    i[k] = Number.isFinite(n) ? n : null;
  }
  if (i.precio != null && typeof i.precio !== 'number') { const n = leerPrecio(i.precio); i.precio = Number.isNaN(n) ? null : n; }
  return i;
}
function unir(a, b) {
  const m = new Map(); for (const i of a) m.set(i.id, i);
  for (const i of b) { const x = m.get(i.id); if (!x || ms(i.actualizado) > ms(x.actualizado)) m.set(i.id, i); }
  return [...m.values()];
}

let cadena = Promise.resolve();
function sincronizar(motivo) { cadena = cadena.then(() => sincronizarYa(motivo)).catch(() => {}); return cadena; }
/** Ejecuta f en la misma cola que la sincronización (así nunca se pisan) y devuelve su resultado. */
function enCola(f) { const p = cadena.then(f); cadena = p.catch(() => {}); return p; }

/* ---- config.json: ajustes compartidos en el repositorio de datos (hoy, la clave de TMDB). Nunca toca historial.json ---- */
const CONFIG = 'config.json';
async function leerConfig(c = cfg) {
  const r = await gh(`/contents/${CONFIG}`, {}, c);
  if (r.status === 404) return { datos: null, sha: null };
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al leer ${CONFIG}.`);
  const j = await r.json();
  let datos;
  try { datos = JSON.parse(deB64(j.content || '') || '{}'); } catch { datos = null; }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) datos = { _mal: true };
  return { datos, sha: j.sha };
}
/** Cambia solo las claves indicadas de config.json (null = quitarla), conservando el resto. */
async function escribirConfig(cambio) {
  for (let intento = 0; intento < 3; intento++) {
    const { datos, sha: shaC } = await leerConfig();
    if (datos?._mal) throw new Error(`${CONFIG} no es un JSON válido. Revísalo en GitHub.`);
    const nuevo = { ...(datos || {}), ...cambio };
    for (const k of Object.keys(nuevo)) if (nuevo[k] == null) delete nuevo[k];
    const r = await gh(`/contents/${CONFIG}`, { method: 'PUT', body: JSON.stringify({
      message: `${cfg.nombre || 'Mi Butaca'}: ${cambio.tmdb ? 'guarda' : 'quita'} la clave de TMDB`,
      content: aB64(JSON.stringify(nuevo, null, 2) + '\n'), ...(shaC ? { sha: shaC } : {}),
    }) });
    if (r.status === 409 || r.status === 422) continue;
    if (r.status === 403 || r.status === 404) throw new Error('El token no tiene permiso de escritura (Contents: Read and write).');
    if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
    return;
  }
  throw new Error('GitHub está ocupado. Inténtalo de nuevo.');
}
/** Al sincronizar: manda la clave del repositorio; una clave puesta solo en este móvil se comparte. */
async function sincronizarClave() {
  const { datos } = await leerConfig();
  if (datos?._mal) return; // config.json mal escrito a mano: no se toca nada
  const remota = typeof datos?.tmdb === 'string' ? datos.tmdb.trim() : '';
  const local = claveTMDB(), origen = leerLS(LS_TMDB_ORIGEN, 'movil');
  if (remota) {
    if (remota !== local || origen !== 'repo') { escribirLS(LS_TMDB, remota); escribirLS(LS_TMDB_ORIGEN, 'repo'); tmdbAhoraNo = false; }
  } else if (local && origen === 'repo') borrarClaveLocal(); // se quitó desde otro móvil o desde GitHub
  else if (local) { await escribirConfig({ tmdb: local }); escribirLS(LS_TMDB_ORIGEN, 'repo'); }
}
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
    try { await sincronizarClave(); } catch { /* la clave compartida no es imprescindible: se reintenta la próxima vez */ }
  } catch (e) {
    ultimoError = e.message || 'Sin conexión con GitHub.';
  }
  pintarEstado();
  if ($('#ajustes').open) pintarClaveTMDB();
}
let ultimoError = null, tokenMalo = false;
const ordenar = l => [...l].sort((a, b) => (a.creado || '').localeCompare(b.creado || '') || a.id.localeCompare(b.id));

function pintarEstado(modo) {
  pintarAvisos();
  const dot = $('#syncDot'), txt = $('#syncTxt');
  dot.className = 'dot';
  if (!cfg) { txt.textContent = 'Solo en este móvil'; dot.classList.add('pend'); return; }
  if (modo === 'girando') { dot.classList.add('pend', 'girando'); txt.textContent = 'Sincronizando…'; return; }
  if (ultimoError) { dot.classList.add('err'); txt.textContent = tokenMalo ? 'Token caducado' : 'Error al sincronizar'; return; }
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
  pintarDlTitulos(); deshacerAuto();
  $('#dlGeneros').innerHTML = (t === 'anime' ? GENEROS.anime : GENEROS.general).concat(generosUsados(t))
    .filter((g, i, a) => a.indexOf(g) === i).map(g => `<option value="${esc(g)}">`).join('');
  $$('.mal', form).forEach(i => i.classList.remove('mal'));
}
/** Muestra solo los campos del tipo y del modo elegidos. */
function visibilidad() {
  $$('[data-para],[data-solo]', form).forEach(el => {
    const p = el.dataset.para, so = el.dataset.solo;
    el.hidden = !!((p && !p.split(' ').includes(tipo)) || (so && so !== modo) || (el.dataset.sirec && !form.recomienda.checked));
  });
  const libro = tipo === 'libro';
  $('#recEtq').textContent = libro ? 'Lo recomendaría' : 'La recomendaría';
  $('#porqueEtq').innerHTML = `¿Por qué ${libro ? 'lo' : 'la'} recomiendas? <small>(opcional)</small>`;
  $('#revEtq').innerHTML = libro ? 'Es una relectura <small>(ya lo había leído)</small>' : 'Es un revisionado <small>(ya la había visto)</small>';
  $('#estrenoEtq').innerHTML = (libro ? 'Fecha de publicación' : tipo === 'pelicula' ? 'Fecha de estreno' : 'Fecha de estreno de la temporada') + ' <small>(opcional)</small>';
  pintarDuplicado();
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
form.recomienda.addEventListener('change', () => { visibilidad(); if (form.recomienda.checked) form.porque.focus({ preventScroll: true }); });
form.revisionado.addEventListener('change', pintarDuplicado);
$('#modoSel').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !editandoId) ponerModo(b.dataset.m); });
function generosUsados(t) { return visibles().filter(i => i.tipo === t && i.genero).map(i => i.genero); }

function limpiarForm() {
  ultimoAuto = ''; autoCampos = []; autoPlat = null; $('#autoHint').hidden = true;
  portadaSel = null; mostrarPortadaForm(); if (typeof cerrarEnlaceForm === 'function') cerrarEnlaceForm();
  form.reset(); plataforma = null; formato = 'Kindle'; form.fechaFin.value = hoyISO(); form.anio.value = ANIO_ACTUAL; pintarChips();
  $$('.mal', form).forEach(i => i.classList.remove('mal'));
  visibilidad();
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
/** Lee «4», «1-4», «1–4», «1 a 4»… → {ini, fin}. Vacío → nulls; inválido → null. */
function leerTemporadas(v) {
  const t = String(v || '').trim().toLowerCase().replace(/^t/, '');
  if (!t) return { ini: null, fin: null };
  let m = t.match(/^(\d{1,3})$/);
  if (m) return { ini: Number(m[1]), fin: null };
  m = t.match(/^(\d{1,3})\s*(?:-|–|—|a|al|y|hasta)\s*t?(\d{1,3})$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (b < a) return null;
  return { ini: a, fin: b > a ? b : null };
}
const textoTemporadas = i => i.temporada == null ? '' : i.temporadaFin ? `${i.temporada}-${i.temporadaFin}` : String(i.temporada);
const etiquetaTemp = i => i.temporada == null || i.tipo === 'pelicula' ? '' : i.temporadaFin ? `T${i.temporada}–T${i.temporadaFin}` : `T${i.temporada}`;
/* ---- duplicados ---- */
const campoTitulo = () => (tipo === 'libro' ? form.libro : form.titulo);
/** ¿Se pisan las temporadas? Sin temporada en alguno de los dos, se considera que sí. */
function solapa(i, t) {
  if (!t || t.ini == null || i.temporada == null) return true;
  const a1 = i.temporada, b1 = i.temporadaFin || i.temporada, a2 = t.ini, b2 = t.fin || t.ini;
  return a1 <= b2 && a2 <= b1;
}
function analizarDup() {
  const t = normal(campoTitulo().value.trim());
  if (!t) return { choca: [], pend: [], hechos: [] };
  const mismos = visibles().filter(i => i.id !== editandoId && i.tipo === tipo && normal(i.titulo) === t);
  const hechos = mismos.filter(i => !esPend(i)).sort((a, b) => anioDe(b) - anioDe(a)), pend = mismos.filter(esPend);
  const temps = tipo === 'serie' || tipo === 'anime' ? leerTemporadas(form.temporada.value) : null;
  return { hechos, pend, choca: tipo === 'serie' || tipo === 'anime' ? hechos.filter(i => solapa(i, temps)) : hechos };
}
function pintarDuplicado() {
  const box = $('#avisoDup'); if (!box) return;
  const { choca, pend, hechos } = analizarDup(), libro = tipo === 'libro';
  let h = '', suave = false;
  if (modo === 'hecho') {
    if (choca.length && !form.revisionado.checked) {
      const u = choca[0];
      h = `Ya tienes «${esc(u.titulo)}»${etiquetaTemp(u) ? ' ' + etiquetaTemp(u) : ''} en ${libro ? 'Leídos' : 'Vistas'} (${anioDe(u)}).
        ${libro ? '¿Lo has vuelto a leer?' : '¿La has vuelto a ver?'}<br><button type="button" id="marcarRev">Sí, es ${libro ? 'una relectura' : 'un revisionado'}</button>`;
    } else if (pend.length && !editandoId) {
      h = `Lo tenías en ${libro ? 'Por leer' : 'Por ver'}: al guardarlo saldrá de esa lista.`; suave = true;
    }
  } else if (pend.length) {
    h = `«${esc(pend[0].titulo)}» ya está en ${libro ? 'Por leer' : 'Por ver'}.`;
  } else if (hechos.length) {
    h = `Ya ${libro ? 'lo leíste' : 'la viste'} en ${anioDe(hechos[0])}. Puedes apuntarlo igualmente para repetir.`; suave = true;
  }
  // Solo se redibuja si cambia: si no, un toque en «Sí, es un revisionado» justo al salir del título se perdería
  if (box.dataset.html !== h) { box.innerHTML = h; box.dataset.html = h; }
  box.hidden = !h; box.classList.toggle('suave', suave);
}
$('#avisoDup').addEventListener('click', e => { if (e.target.id === 'marcarRev') { form.revisionado.checked = true; pintarDuplicado(); } });

/* ---- autocompletar con lo que ya tienes ---- */
let ultimoAuto = '', autoCampos = [], autoPlat = null;
/** Deshace lo autocompletado (si no lo has cambiado tú) cuando cambias a otro título. */
function deshacerAuto() {
  for (const { el, v } of autoCampos) if (el.value === String(v)) el.value = '';
  if (autoPlat && plataforma === autoPlat) { plataforma = null; form.plataformaOtro.value = ''; pintarChips(); }
  autoCampos = []; autoPlat = null; ultimoAuto = ''; $('#autoHint').hidden = true;
}
function pintarDlTitulos() {
  const vistos = new Set(), opts = [];
  for (const i of visibles().filter(i => i.tipo === tipo).sort((a, b) => ms(b.actualizado) - ms(a.actualizado))) {
    const k = normal(i.titulo); if (vistos.has(k)) continue; vistos.add(k); opts.push(`<option value="${esc(i.titulo)}">`);
  }
  $('#dlTitulos').innerHTML = opts.join('');
}
/** Al elegir un título que ya existe, rellena lo que esté vacío con sus datos (y propone la siguiente temporada). */
function autocompletar() {
  if (editandoId) return;
  const campo = campoTitulo(), t = normal(campo.value.trim());
  if (!t || t === ultimoAuto) return;
  const previos = visibles().filter(i => i.tipo === tipo && normal(i.titulo) === t).sort((a, b) => ms(b.actualizado) - ms(a.actualizado));
  if (!previos.length) return;
  if (ultimoAuto) deshacerAuto();
  ultimoAuto = t;
  const p = previos[0], hechos = previos.filter(i => !esPend(i));
  const rellenados = [];
  const set = (el, v, nombre) => { if (v != null && v !== '' && !el.value) { el.value = v; autoCampos.push({ el, v }); rellenados.push(nombre); } };
  campo.value = p.titulo;
  if (tipo === 'libro') { set(form.autor, p.autor, 'autor'); set(form.paginas, p.paginas, 'páginas'); }
  else {
    set(form.genero, p.genero, 'género');
    if (!plataforma && p.plataforma) { plataforma = autoPlat = p.plataforma; form.plataformaOtro.value = p.plataformaOtro || ''; rellenados.push('plataforma'); }
    if (tipo === 'pelicula') set(form.duracion, p.duracion, 'duración');
    else {
      set(form.duracionCap, p.duracionCap, 'duración del capítulo');
      const conTemp = hechos.filter(i => i.temporada != null);
      if (!form.temporada.value && conTemp.length) {
        const sig = Math.max(...conTemp.map(i => i.temporadaFin || i.temporada)) + 1;
        form.temporada.value = sig; autoCampos.push({ el: form.temporada, v: sig }); rellenados.push('siguiente temporada');
      } else set(form.temporada, textoTemporadas(p), 'temporada');
    }
  }
  if (p.portada && !portadaSel?.url) { portadaSel = { url: p.portada, fuente: 'tu historial', anilistId: p.anilistId, isbn: p.isbn }; mostrarPortadaForm(); rellenados.push('portada'); }
  pintarChips();
  const hint = $('#autoHint'); hint.classList.remove('oferta');
  hint.textContent = rellenados.length ? `✓ Rellenado con lo que ya tenías: ${rellenados.join(', ')}.` : 'Ya estaba todo rellenado.';
  hint.hidden = false;
  pintarDuplicado();
}
/** Al escribir a mano un título que ya tienes, ofrece rellenar (no lo hace solo: así nada se mueve al tocar otro botón). */
function ofrecerAuto() {
  const hint = $('#autoHint'), t = normal(campoTitulo().value.trim());
  if (editandoId || !t || t === ultimoAuto) { if (!ultimoAuto) hint.hidden = true; return; }
  const p = visibles().filter(i => i.tipo === tipo && normal(i.titulo) === t).sort((a, b) => ms(b.actualizado) - ms(a.actualizado))[0];
  if (!p) { hint.hidden = true; return; }
  hint.classList.add('oferta');
  hint.innerHTML = `Ya tienes «${esc(p.titulo)}».<button type="button" id="btnAuto">Rellenar con sus datos</button>`;
  hint.hidden = false;
}
$('#autoHint').addEventListener('click', e => { if (e.target.id === 'btnAuto') autocompletar(); });
for (const campo of [form.titulo, form.libro]) {
  campo.addEventListener('input', e => {
    if (ultimoAuto && normal(campo.value.trim()) !== ultimoAuto) deshacerAuto();
    // Elegir una sugerencia de la lista (datalist) rellena al momento; escribir a mano solo lo ofrece
    if (!e.inputType || e.inputType === 'insertReplacementText') autocompletar(); else ofrecerAuto();
    pintarDuplicado();
  });
}
form.temporada.addEventListener('input', pintarDuplicado);

/* ---------------- portadas y datos automáticos (anime: AniList · libros: Google Books / Open Library) ---------------- */
let portadaSel = null; // { url, fuente, anilistId?, isbn? }
function mostrarPortadaForm() {
  const caja = $('#portadaForm');
  if (!portadaSel?.url) { caja.hidden = true; return; }
  $('#portadaImg').src = portadaSel.url; $('#portadaFuente').textContent = portadaSel.fuente ? `De ${portadaSel.fuente}` : '';
  caja.hidden = false;
}
$('#quitarPortada').addEventListener('click', () => { portadaSel = null; mostrarPortadaForm(); });
// Si la portada no carga (p. ej. Open Library no la tiene para ese ISBN), no se guarda
$('#portadaImg').addEventListener('error', () => { if (portadaSel) portadaSel.url = ''; $('#portadaForm').hidden = true; });
/** Un resultado cuya portada no carga pasa a «sin portada» (así nunca se guarda una imagen rota). */
window.portadaRota = (img, n) => {
  const lista = img.closest('#compLista') ? resComp : resultados, libro = !!lista[n]?.ext?.isbn || tipo === 'libro';
  if (lista[n]) lista[n].portada = '';
  const small = img.parentNode.querySelector('small'); if (small && !small.textContent.includes('sin portada')) small.textContent += ' · sin portada';
  img.outerHTML = `<span class="sin">${libro ? '📖' : '🍥'}</span>`;
};

const GENERO_ANILIST = { Action: 'Acción', Adventure: 'Aventura', Comedy: 'Comedia', Drama: 'Drama', Fantasy: 'Fantasía',
  Horror: 'Terror', 'Mahou Shoujo': 'Fantasía', Mecha: 'Mecha', Music: 'Musical', Mystery: 'Misterio', Psychological: 'Psicológico',
  Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Slice of Life': 'Slice of life', Sports: 'Deportes', Supernatural: 'Sobrenatural', Thriller: 'Suspense' };
const FORMATO_ANILIST = { TV: 'Serie', TV_SHORT: 'Serie corta', MOVIE: 'Película', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Musical' };
const https = u => (u ? String(u).replace(/^http:\/\//, 'https://').replace('&edge=curl', '') : '');
const fechaFuzzy = d => (d?.year && d?.month && d?.day ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : '');

async function pedir(url, opt = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  try { return await fetch(url, { ...opt, signal: ctl.signal }); } finally { clearTimeout(t); }
}
async function buscarAnime(q) {
  const query = `query($q:String){Page(perPage:10){media(search:$q,type:ANIME,isAdult:false,sort:SEARCH_MATCH){
    id title{romaji english} format episodes duration genres status seasonYear startDate{year month day}
    coverImage{large extraLarge} nextAiringEpisode{airingAt episode}}}}`;
  const r = await pedir('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { q } }) });
  if (r.status === 429) throw new Error('AniList está saturado ahora mismo. Prueba en un minuto.');
  if (!r.ok) throw new Error(`AniList respondió ${r.status}.`);
  const lista = (await r.json())?.data?.Page?.media || [];
  return lista.map(m => {
    const titulo = m.title?.english || m.title?.romaji || '', alt = m.title?.english && m.title?.romaji !== m.title?.english ? m.title.romaji : '';
    const genero = (m.genres || []).map(g => GENERO_ANILIST[g]).find(Boolean) || '';
    let estreno = '';
    if (m.status === 'NOT_YET_RELEASED') estreno = fechaFuzzy(m.startDate);
    else if (m.nextAiringEpisode?.episode === 1) estreno = iso(new Date(m.nextAiringEpisode.airingAt * 1000));
    const sub = [FORMATO_ANILIST[m.format] || '', m.seasonYear || '', m.episodes ? `${m.episodes} cap.` : m.status === 'RELEASING' ? 'En emisión' : '',
      m.duration ? `${m.duration} min` : '', genero].filter(Boolean).join(' · ');
    return { titulo, alt, sub, portada: https(m.coverImage?.large || m.coverImage?.extraLarge), fuente: 'AniList',
      datos: { capitulos: m.episodes, duracionCap: m.duration, genero, estreno }, ext: { anilistId: m.id } };
  }).filter(x => x.titulo);
}
async function buscarLibroGoogle(q) {
  const r = await pedir(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=15&printType=books`);
  if (!r.ok) throw new Error(`Google Books respondió ${r.status}.`);
  const items = (await r.json())?.items || [];
  return items.map(v => {
    const vi = v.volumeInfo || {}, ids = vi.industryIdentifiers || [];
    const isbn = (ids.find(x => x.type === 'ISBN_13') || ids.find(x => x.type === 'ISBN_10'))?.identifier || '';
    const portada = https(vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail) || (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : '');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(vi.publishedDate || '') ? vi.publishedDate : '';
    return { titulo: vi.title || '', alt: vi.subtitle || '', idioma: vi.language || '',
      sub: [(vi.authors || []).join(', '), (vi.publishedDate || '').slice(0, 4), vi.pageCount ? `${vi.pageCount} págs.` : '', (vi.language || '').toUpperCase()].filter(Boolean).join(' · '),
      portada, fuente: 'Google Books', datos: { autor: (vi.authors || []).join(', '), paginas: vi.pageCount, estreno: fecha > hoyISO() ? fecha : '' }, ext: { isbn } };
  }).filter(x => x.titulo).sort((a, b) => (b.idioma === 'es') - (a.idioma === 'es')); // primero las ediciones en español
}
async function buscarLibroOpenLibrary(q) {
  const r = await pedir(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=15&fields=key,title,author_name,number_of_pages_median,cover_i,first_publish_year,isbn`);
  if (!r.ok) throw new Error(`Open Library respondió ${r.status}.`);
  return ((await r.json())?.docs || []).map(d => ({
    titulo: d.title || '', alt: '', sub: [(d.author_name || []).slice(0, 2).join(', '), d.first_publish_year || '', d.number_of_pages_median ? `${d.number_of_pages_median} págs.` : ''].filter(Boolean).join(' · '),
    portada: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '', fuente: 'Open Library',
    datos: { autor: (d.author_name || [])[0] || '', paginas: d.number_of_pages_median, estreno: '' }, ext: { isbn: (d.isbn || [])[0] || '' },
  })).filter(x => x.titulo);
}
/* Wikipedia: se busca en español (entiende tus títulos) y la portada se toma del artículo en inglés,
   porque la Wikipedia en español no admite imágenes con derechos de autor (casi todas las portadas). */
async function buscarWikipedia(q) {
  const api = (l, par) => `https://${l}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&${par}`;
  const IMG = 'piprop=thumbnail&pithumbsize=400&pilicense=any';
  const json = async u => { const r = await pedir(u); if (!r.ok) throw new Error(`Wikipedia respondió ${r.status}.`); return r.json(); };
  const enc = encodeURIComponent(q);
  const [es, en] = await Promise.allSettled([
    json(api('es', `generator=search&gsrlimit=6&gsrsearch=${enc}&prop=pageimages|description|langlinks&lllang=en&${IMG}`)),
    json(api('en', `generator=search&gsrlimit=4&gsrsearch=${enc}&prop=pageimages|description&${IMG}`)),
  ]);
  if (es.status === 'rejected' && en.status === 'rejected') throw es.reason;
  const paginas = r => (r.status === 'fulfilled' ? r.value?.query?.pages || [] : []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const esP = paginas(es), enP = paginas(en);
  const enlaceEn = p => { const l = (p.langlinks || [])[0]; return l ? l.title || l['*'] || '' : ''; };
  const titulosEn = [...new Set(esP.map(enlaceEn).filter(Boolean))];
  const imgEn = new Map();
  if (titulosEn.length) {
    try {
      const d = await json(api('en', `titles=${encodeURIComponent(titulosEn.join('|'))}&redirects=1&prop=pageimages&${IMG}`));
      const ruta = new Map([...(d.query?.normalized || []), ...(d.query?.redirects || [])].map(x => [x.from, x.to]));
      const fin = t => { let v = t; for (let n = 0; n < 3 && ruta.has(v); n++) v = ruta.get(v); return v; };
      const miniaturas = new Map((d.query?.pages || []).map(x => [x.title, x.thumbnail?.source]));
      for (const t of titulosEn) imgEn.set(t, miniaturas.get(fin(t)));
    } catch { /* sin la inglesa, se usa la imagen en español si la hay */ }
  }
  const out = [], usadas = new Set(), cubiertos = new Set();
  const meter = r => { if (!r.portada || usadas.has(r.portada)) return; usadas.add(r.portada); out.push(r); };
  for (const x of esP) {
    const en_ = enlaceEn(x); if (en_) cubiertos.add(en_);
    meter({ titulo: x.title, alt: en_ && en_ !== x.title ? en_ : '', sub: x.description || 'Artículo de Wikipedia', portada: https((en_ && imgEn.get(en_)) || x.thumbnail?.source),
      fuente: 'Wikipedia', datos: {}, ext: {} });
  }
  for (const x of enP) if (!cubiertos.has(x.title))
    meter({ titulo: x.title, alt: '', sub: x.description || 'Wikipedia en inglés', portada: https(x.thumbnail?.source), fuente: 'Wikipedia', datos: {}, ext: {} });
  return out;
}
/* ---- TMDB (películas y series): necesita una clave gratuita, que se pide la primera vez y se guarda en el móvil ---- */
const LS_TMDB = 'mb_tmdb', LS_TMDB_ORIGEN = 'mb_tmdb_origen'; // origen: 'repo' (compartida) o 'movil' (aún sin compartir)
function borrarClaveLocal() { for (const k of [LS_TMDB, LS_TMDB_ORIGEN]) try { localStorage.removeItem(k); } catch { /* */ } }
const claveTMDB = () => leerLS(LS_TMDB, '') || '';
let tmdbAhoraNo = false; // si dices «Ahora no», no se vuelve a pedir hasta que reabras la app
/** Llama a TMDB. Admite la «API Key» (va en la dirección) o el «Read Access Token» (va en la cabecera). */
async function tmdb(ruta, params = {}, clave = claveTMDB()) {
  const token = clave.length > 40, qs = new URLSearchParams({ ...params, ...(token ? {} : { api_key: clave }) });
  const r = await pedir(`https://api.themoviedb.org/3${ruta}?${qs}`, { headers: { accept: 'application/json', ...(token ? { Authorization: `Bearer ${clave}` } : {}) } });
  if (r.status === 401) { const e = new Error('La clave de TMDB no es válida o tu cuenta aún no está confirmada.'); e.clave = true; throw e; }
  if (r.status === 429) throw new Error('TMDB está saturado ahora mismo. Prueba en un minuto.');
  if (!r.ok) throw new Error(`TMDB respondió ${r.status}.`);
  return r.json();
}
const posterTMDB = (p, t = 'w342') => (p ? `https://image.tmdb.org/t/p/${t}${p}` : '');
const GENERO_TMDB = { 'Action & Adventure': 'Acción', 'Sci-Fi & Fantasy': 'Ciencia ficción', 'War & Politics': 'Bélica', Familia: 'Familiar',
  Historia: 'Histórica', 'Música': 'Musical', Kids: 'Familiar', 'Película de TV': '', News: '', Talk: '', Soap: 'Drama', Reality: '' };
const generoTMDB = gs => (gs || []).map(g => (g.name in GENERO_TMDB ? GENERO_TMDB[g.name] : g.name)).find(Boolean) || '';
async function buscarTMDB(t, q) {
  const peli = t === 'pelicula';
  const d = await tmdb(peli ? '/search/movie' : '/search/tv', { query: q, language: 'es-ES', include_adult: 'false', page: '1' });
  return (d.results || []).slice(0, 10).map(x => {
    const titulo = peli ? x.title : x.name, orig = peli ? x.original_title : x.original_name, fecha = (peli ? x.release_date : x.first_air_date) || '';
    return { titulo, alt: orig && orig !== titulo ? orig : '', sub: [peli ? 'Película' : 'Serie', fecha.slice(0, 4)].filter(Boolean).join(' · '),
      portada: posterTMDB(x.poster_path), fuente: 'TMDB', datos: {}, ext: { tmdbId: x.id }, detalle: () => (peli ? detallePeli(x.id) : detalleSerie(x.id)) };
  }).filter(x => x.titulo);
}
/** Película: duración, género y fecha de estreno en España (cine o plataforma) si la hay; si no, la original. */
async function detallePeli(id) {
  const d = await tmdb(`/movie/${id}`, { language: 'es-ES', append_to_response: 'release_dates' });
  const es = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'ES');
  const fechasES = (es?.release_dates || []).filter(x => x.type === 3 || x.type === 4).map(x => (x.release_date || '').slice(0, 10)).filter(Boolean).sort();
  const hoy = hoyISO(), enEsp = fechasES.find(f => f >= hoy);
  return { duracion: d.runtime || null, genero: generoTMDB(d.genres),
    estreno: enEsp || ((d.release_date || '') > hoy ? d.release_date : ''), estrenoDe: enEsp ? 'en España' : 'original' };
}
/** Serie: duración del capítulo, género y, por temporada, nº de capítulos, fecha y póster. */
async function detalleSerie(id) {
  const d = await tmdb(`/tv/${id}`, { language: 'es-ES' });
  return { duracionCap: (d.episode_run_time || [])[0] || d.last_episode_to_air?.runtime || d.next_episode_to_air?.runtime || null, genero: generoTMDB(d.genres),
    temporadas: (d.seasons || []).filter(x => x.season_number > 0).map(x => ({ n: x.season_number, caps: x.episode_count, fecha: x.air_date || '', poster: posterTMDB(x.poster_path) })),
    proximo: d.next_episode_to_air || null };
}
/** De los datos de una serie, lo que corresponde a las temporadas indicadas («3» o «1-3»). */
function datosDeTemporadas(det, t) {
  if (!det?.temporadas || !t || t.ini == null) return {};
  const sel = det.temporadas.filter(x => x.n >= t.ini && x.n <= (t.fin || t.ini));
  if (!sel.length) return {};
  const out = { capitulos: sel.reduce((a, x) => a + (x.caps || 0), 0) || null, portadaTemp: sel[0].poster || '' };
  if (sel[0].fecha > hoyISO()) { out.estreno = sel[0].fecha; out.estrenoDe = 'original'; }
  if (det.proximo?.season_number === sel[0].n && det.proximo?.episode_number === 1 && det.proximo.air_date) { out.estreno = det.proximo.air_date; out.estrenoDe = 'original'; }
  return out;
}
/** Pide la clave de TMDB (con los pasos para conseguirla). Devuelve true si se guarda una válida. */
function pedirClaveTMDB() {
  return new Promise(res => {
    const dlg = $('#tmdbDlg'), inp = $('#tmdbInput'), err = $('#tmdbErr'), guardar = $('#tmdbGuardar'), ahoraNo = $('#tmdbAhoraNo');
    inp.value = ''; err.textContent = ''; dlg.querySelector('details').open = !claveTMDB();
    const fin = v => { guardar.onclick = ahoraNo.onclick = null; dlg.onclose = null; if (dlg.open) dlg.close(); res(v); };
    guardar.onclick = async () => {
      const k = inp.value.trim();
      if (!k) { err.textContent = 'Pega primero tu clave.'; return; }
      if (/[^\x21-\x7e]/.test(k)) { err.textContent = 'La clave tiene espacios o caracteres que no son suyos. Vuelve a copiarla.'; return; }
      err.textContent = ''; guardar.disabled = true; guardar.textContent = 'Comprobando…';
      try { await tmdb('/configuration', {}, k); }
      catch (e) {
        err.textContent = e.clave ? 'Esa clave no es válida. Comprueba que la has copiado entera y que confirmaste tu correo en TMDB.' : 'No se pudo comprobar la clave (¿sin conexión?). Inténtalo de nuevo.';
        guardar.disabled = false; guardar.textContent = 'Guardar'; return;
      }
      escribirLS(LS_TMDB, k); escribirLS(LS_TMDB_ORIGEN, 'movil'); tmdbAhoraNo = false;
      if (cfg) { // se comparte con todos los móviles conectados al repositorio de datos
        guardar.textContent = 'Compartiendo…';
        try { await enCola(() => escribirConfig({ tmdb: k })); escribirLS(LS_TMDB_ORIGEN, 'repo'); avisar('Clave guardada para todos los móviles conectados'); }
        catch { avisar('Clave guardada en este móvil. Se compartirá al sincronizar'); }
      } else avisar('Clave guardada. Se compartirá cuando conectes con GitHub');
      guardar.disabled = false; guardar.textContent = 'Guardar'; fin(true);
    };
    ahoraNo.onclick = () => { tmdbAhoraNo = true; fin(false); };
    dlg.onclose = () => fin(false);
    dlg.showModal(); inp.focus();
  });
}
/** Antes de buscar una película o serie: si no hay clave (y no has dicho «Ahora no»), la pide. */
async function asegurarClave(t) {
  if ((t === 'pelicula' || t === 'serie') && !claveTMDB() && !tmdbAhoraNo) await pedirClaveTMDB();
}

/** Consulta todas las fuentes a la vez y junta los resultados. Solo falla si fallan todas. */
async function buscarTodo(t, q) {
  const fuentes = t === 'libro'
    ? [['Google Books', buscarLibroGoogle, 8], ['Open Library', buscarLibroOpenLibrary, 5], ['Wikipedia', buscarWikipedia, 5]]
    : t === 'anime' ? [['AniList', buscarAnime, 8], ['Wikipedia', buscarWikipedia, 5]]
    : claveTMDB() ? [['TMDB', x => buscarTMDB(t, x), 10], ['Wikipedia', buscarWikipedia, 4]] : [['Wikipedia', buscarWikipedia, 6]];
  const res = await Promise.allSettled(fuentes.map(([, f]) => f(q)));
  const lista = [], fallos = []; let primerError = null;
  let claveMala = false;
  res.forEach((r, n) => {
    if (r.status === 'fulfilled') lista.push(...r.value.slice(0, fuentes[n][2]));
    else { fallos.push(fuentes[n][0]); primerError = primerError || r.reason; if (r.reason?.clave) claveMala = true; }
  });
  if (fallos.length === fuentes.length) { if (claveMala) primerError.clave = true; throw primerError; }
  // Open Library repite a veces el mismo libro que Google: se quita si Google ya lo trae con portada
  const conPortada = new Set(lista.filter(r => r.fuente === 'Google Books' && r.portada).map(r => r.ext?.isbn).filter(Boolean));
  return { lista: lista.filter(r => !(r.fuente === 'Open Library' && r.ext?.isbn && conPortada.has(r.ext.isbn))), fallos, claveMala,
    sinClave: (t === 'pelicula' || t === 'serie') && !claveTMDB() };
}
const avisoFallos = f => f.length ? `${f.join(' y ')} no ${f.length > 1 ? 'han' : 'ha'} respondido; te enseño el resto.` : '';
/** Mensaje bajo la búsqueda: fuentes caídas, clave mala o sin clave (con botón para ponerla). */
function notaBusqueda(r) {
  if (r.claveMala) return `${esc('La clave de TMDB no es válida: solo ves resultados de Wikipedia.')}<button type="button" data-clave>Cambiar clave</button>`;
  if (r.sinClave) return `Sin clave de TMDB solo busco en Wikipedia.<button type="button" data-clave>Añadir clave</button>`;
  return esc(avisoFallos(r.fallos));
}
const NOMBRE_BUSCAR = { pelicula: 'Buscar película', serie: 'Buscar serie', anime: 'Buscar anime', libro: 'Buscar libro' };
const FUENTES_BUSCAR = { pelicula: 'Datos y portadas de TMDB · portadas también de Wikipedia. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.',
  serie: 'Datos y portadas de TMDB · portadas también de Wikipedia. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.',
  anime: 'Datos y portadas de AniList · portadas también de Wikipedia', libro: 'Datos y portadas de Google Books, Open Library y Wikipedia' };
async function buscarLibro(q) {
  try { const l = await buscarLibroGoogle(q); if (l.length) return l; } catch { /* si Google falla, se prueba con Open Library */ }
  return buscarLibroOpenLibrary(q);
}

let resultados = [];
async function abrirBusqueda() {
  const libro = tipo === 'libro';
  await asegurarClave(tipo);
  $('#busTitulo').textContent = NOMBRE_BUSCAR[tipo];
  $('#busFuente').textContent = FUENTES_BUSCAR[tipo];
  const q = [campoTitulo().value.trim(), libro ? form.autor.value.trim() : ''].filter(Boolean).join(' ');
  $('#busQ').value = q; $('#busQ').placeholder = libro ? 'Título y, si quieres, autor' : { anime: 'Título del anime', pelicula: 'Título de la película', serie: 'Título de la serie' }[tipo];
  $('#busLista').innerHTML = ''; $('#busEstado').textContent = q ? '' : 'Escribe el título y pulsa Buscar.';
  $('#busqueda').showModal();
  if (q) buscarAhora(); else $('#busQ').focus();
}
async function buscarAhora() {
  const q = $('#busQ').value.trim(); if (!q) return;
  const libro = tipo === 'libro', est = $('#busEstado'), ul = $('#busLista');
  est.textContent = 'Buscando…'; ul.innerHTML = '';
  if (!navigator.onLine) { est.textContent = 'Sin conexión. Puedes rellenarlo a mano.'; return; }
  try {
    const r_ = await buscarTodo(tipo, q);
    resultados = r_.lista;
    est.innerHTML = resultados.length ? notaBusqueda(r_)
      : `No he encontrado nada${r_.fallos.length ? ` (${esc(avisoFallos(r_.fallos).split(';')[0])})` : ''}. Prueba con otro título${libro ? ' o con el ISBN (isbn:978…)' : tipo === 'anime' ? ' (en anime, a veces funciona mejor en inglés o japonés)' : ''}, o pega el enlace de una imagen.${r_.claveMala || r_.sinClave ? ' ' + notaBusqueda(r_) : ''}`;
    ul.innerHTML = resultados.map((r, n) => `<li><button type="button" class="bus-res" data-res="${n}">
      ${r.portada ? `<img src="${esc(r.portada)}" alt="" loading="lazy" onerror="portadaRota(this, ${n})">` : `<span class="sin">${ICONO_TIPO[tipo]}</span>`}
      <span><b>${esc(r.titulo)}</b>${r.alt ? `<i>${esc(r.alt)}</i>` : ''}<small>${esc(r.sub)}</small><span class="fte">${esc(r.fuente)}</span></span></button></li>`).join('');
  } catch (e) {
    est.innerHTML = e.name === 'AbortError' ? 'La búsqueda ha tardado demasiado. Inténtalo de nuevo.'
      : `${esc(e.message && !e.message.startsWith('Failed') ? e.message : 'No se pudo conectar.')} Puedes rellenarlo a mano.${e.clave ? '<button type="button" data-clave>Cambiar clave</button>' : ''}`;
  }
}
// «Cambiar / Añadir clave» desde el mensaje de la búsqueda: la pide y repite la búsqueda
for (const [estado, repetir] of [['#busEstado', () => buscarAhora()], ['#compEstado', () => buscarCompletar()]])
  $(estado).addEventListener('click', async e => { if (e.target.closest('[data-clave]') && await pedirClaveTMDB()) repetir(); });
/** Aplica un resultado: rellena lo que esté vacío y pone la portada. */
function aplicarResultado(r) {
  const hechos = [], set = (el, v, nombre) => { if (v != null && v !== '' && !el.value) { el.value = v; hechos.push(nombre); } };
  if (r.datos.temporadas) Object.assign(r.datos, datosDeTemporadas(r.datos, leerTemporadas(form.temporada.value)));
  if (r.datos.portadaTemp) r = { ...r, portada: r.datos.portadaTemp };
  set(campoTitulo(), r.titulo, 'título');
  if (tipo === 'libro') { set(form.autor, r.datos.autor, 'autor'); if (modo === 'hecho') set(form.paginas, r.datos.paginas, 'páginas'); }
  else {
    if (modo === 'hecho') {
      set(form.capitulos, r.datos.capitulos, 'capítulos'); set(form.duracionCap, r.datos.duracionCap, 'duración');
      if (tipo === 'pelicula') set(form.duracion, r.datos.duracion, 'duración');
    }
    set(form.genero, r.datos.genero, 'género');
  }
  if (modo === 'pendiente') set(form.estreno, r.datos.estreno, r.datos.estrenoDe ? `fecha de estreno (${r.datos.estrenoDe})` : 'fecha de estreno');
  if (r.portada) { portadaSel = { url: r.portada, fuente: r.fuente, ...r.ext }; hechos.push('portada'); }
  else portadaSel = { url: '', fuente: r.fuente, ...r.ext };
  mostrarPortadaForm();
  const hint = $('#autoHint'); hint.classList.remove('oferta');
  hint.textContent = (hechos.length ? `✓ Datos de ${r.fuente}: ${hechos.join(', ')}. Puedes corregir lo que quieras.` : `Ya estaba todo rellenado.`)
    + (tipo === 'serie' && r.datos.temporadas && !form.temporada.value ? ' Pon la temporada y vuelve a buscar para rellenar sus capítulos.' : '');
  hint.hidden = false; pintarDuplicado();
}
$('#btnBuscarDatos').addEventListener('click', abrirBusqueda);
$('#busForm').addEventListener('submit', e => { e.preventDefault(); buscarAhora(); });
$('#busCerrar').addEventListener('click', () => $('#busqueda').close());
/** Los resultados de TMDB traen lo básico; al elegir uno se piden sus detalles (duración, temporadas, estreno). */
async function cargarDetalle(r, est) {
  if (!r.detalle || r.cargado) return;
  est.textContent = 'Cargando datos…';
  try { Object.assign(r.datos, await r.detalle()); r.cargado = true; est.textContent = ''; }
  catch (e) { est.textContent = ''; avisar(e.clave ? 'Clave de TMDB no válida: solo se pone la portada' : 'No se pudieron cargar los detalles: solo se pone la portada'); }
}
$('#busLista').addEventListener('click', async e => {
  const b = e.target.closest('[data-res]'); if (!b) return;
  const r = resultados[Number(b.dataset.res)];
  await cargarDetalle(r, $('#busEstado'));
  aplicarResultado(r); $('#busqueda').close();
});

/* ---- completar portadas de registros antiguos (asistente, uno a uno) ---- */
const ORDEN_COMPLETAR = { anime: 0, libro: 1, pelicula: 2, serie: 3 };
const sinPortada = () => visibles().filter(i => !i.portada && !i.sinPortada)
  .sort((a, b) => ORDEN_COMPLETAR[a.tipo] - ORDEN_COMPLETAR[b.tipo] || a.titulo.localeCompare(b.titulo, 'es'));
let cola = [], posCola = 0, anadidas = 0, saltadas = 0, resComp = [];
function abrirCompletar() {
  cola = sinPortada().map(i => i.id); posCola = 0; anadidas = 0; saltadas = 0;
  if (!cola.length) { avisar('Todo tu historial ya tiene portada'); return; }
  $('#ajustes').close(); $('#completar').showModal(); mostrarActual();
}
function mostrarActual() {
  const total = cola.length;
  $('#compBarra').style.width = `${Math.round(100 * posCola / total)}%`;
  if (posCola >= total) return finCompletar();
  const i = items.find(x => x.id === cola[posCola]);
  if (!i || i.borrado || i.portada) { posCola++; return mostrarActual(); }
  $('#compProgreso').textContent = `${posCola + 1} de ${total}`;
  const det = [i.tipo === 'libro' ? i.autor : etiquetaTemp(i), esPend(i) ? (i.tipo === 'libro' ? 'Por leer' : 'Por ver') : anioDe(i)].filter(Boolean).join(' · ');
  $('#compActual').className = 'comp-actual';
  $('#compActual').innerHTML = `<span class="que">${ICONO_TIPO[i.tipo]} ${NOMBRE_TIPO[i.tipo]} sin portada</span><h3>${esc(i.titulo)}</h3>${det ? `<p>${esc(det)}</p>` : ''}`;
  $('#compForm').hidden = false; $('#compPie').hidden = false; $('#btnCompEnlace').hidden = false; cerrarEnlaceComp();
  $('#compQ').value = [i.titulo, i.tipo === 'libro' ? i.autor : ''].filter(Boolean).join(' ');
  buscarCompletar();
}
async function buscarCompletar() {
  const i = items.find(x => x.id === cola[posCola]); if (!i) return;
  const q = $('#compQ').value.trim(), est = $('#compEstado'), ul = $('#compLista');
  ul.innerHTML = ''; resComp = [];
  if (!q) { est.textContent = 'Escribe un título y pulsa Buscar.'; return; }
  await asegurarClave(i.tipo);
  if (!navigator.onLine) { est.textContent = 'Sin conexión. Puedes salir y seguir más tarde.'; return; }
  est.textContent = 'Buscando…';
  const idBuscado = i.id;
  try {
    const r_ = await buscarTodo(i.tipo, q);
    if (cola[posCola] !== idBuscado) return; // ya se ha pasado al siguiente
    resComp = r_.lista.slice(0, 10);
    est.innerHTML = resComp.length ? notaBusqueda(r_) : `Sin resultados. Prueba con otro texto, pega el enlace de una imagen o salta este.${r_.claveMala || r_.sinClave ? ' ' + notaBusqueda(r_) : ''}`;
    ul.innerHTML = resComp.map((r, n) => `<li><button type="button" class="bus-res${n === 0 ? ' prob' : ''}" data-comp="${n}">
      ${r.portada ? `<img src="${esc(r.portada)}" alt="" loading="lazy" onerror="portadaRota(this, ${n})">` : `<span class="sin">${ICONO_TIPO[i.tipo]}</span>`}
      <span>${n === 0 ? '<span class="etq">Más probable</span>' : ''}<b>${esc(r.titulo)}</b>${r.alt ? `<i>${esc(r.alt)}</i>` : ''}<small>${esc(r.sub)}${r.portada ? '' : ' · sin portada'}</small><span class="fte">${esc(r.fuente)}</span></span></button></li>`).join('');
  } catch (e) {
    if (cola[posCola] !== idBuscado) return;
    est.innerHTML = e.name === 'AbortError' ? 'La búsqueda ha tardado demasiado. Pulsa Buscar para reintentar.'
      : `${esc(e.message && !e.message.startsWith('Failed') ? e.message : 'No se pudo conectar.')} Pulsa Buscar para reintentar, o salta este.${e.clave ? '<button type="button" data-clave>Cambiar clave</button>' : ''}`;
  }
}
/** Guarda la portada elegida y rellena lo que estuviera vacío (sin tocar lo que ya tenías). */
async function usarResultado(n) {
  const r = resComp[n], i = items.find(x => x.id === cola[posCola]);
  if (!r || !i) return;
  await cargarDetalle(r, $('#compEstado'));
  if (r.datos.temporadas) Object.assign(r.datos, datosDeTemporadas(r.datos, { ini: i.temporada ?? null, fin: i.temporadaFin || null }));
  const portada = r.datos.portadaTemp || r.portada;
  if (!portada) { avisar('Ese resultado no tiene portada: elige otro o salta'); return; }
  const vacio = k => i[k] == null || i[k] === '';
  i.portada = portada;
  if (r.ext?.isbn && vacio('isbn')) i.isbn = r.ext.isbn;
  if (r.ext?.anilistId && vacio('anilistId')) i.anilistId = r.ext.anilistId;
  if (r.ext?.tmdbId && vacio('tmdbId')) i.tmdbId = r.ext.tmdbId;
  if (i.tipo === 'pelicula' && !esPend(i) && vacio('duracion') && r.datos.duracion) i.duracion = r.datos.duracion;
  if (i.tipo === 'libro') { if (vacio('autor') && r.datos.autor) i.autor = r.datos.autor; if (!esPend(i) && vacio('paginas') && r.datos.paginas) i.paginas = r.datos.paginas; }
  else {
    if (!esPend(i)) { if (vacio('capitulos') && r.datos.capitulos) i.capitulos = r.datos.capitulos; if (vacio('duracionCap') && r.datos.duracionCap) i.duracionCap = r.datos.duracionCap; }
    if (vacio('genero') && r.datos.genero) i.genero = r.datos.genero;
  }
  if (esPend(i) && vacio('estreno') && r.datos.estreno) i.estreno = r.datos.estreno;
  i.actualizado = sello(i); sucio = true; guardarLocal();
  anadidas++; posCola++; mostrarActual();
}
function finCompletar() {
  $('#compProgreso').textContent = ''; $('#compBarra').style.width = '100%';
  $('#compForm').hidden = true; $('#compPie').hidden = true; $('#compLista').innerHTML = ''; $('#compEstado').textContent = '';
  $('#btnCompEnlace').hidden = true; cerrarEnlaceComp();
  const quedan = sinPortada().length;
  $('#compActual').className = 'comp-actual fin';
  $('#compActual').innerHTML = `<h3>${anadidas ? `✓ ${anadidas} ${anadidas === 1 ? 'portada añadida' : 'portadas añadidas'}` : 'Sin cambios'}</h3>
    <p>${saltadas ? `${saltadas} ${saltadas === 1 ? 'saltado' : 'saltados'}: puedes repasarlos otro día desde Ajustes.` : quedan ? '' : 'Todos tus animes y libros tienen ya portada.'}</p>
    <button type="button" class="principal" id="compListo">Listo</button>`;
  pintarTodo(); if (anadidas) sincronizar();
}
function cerrarCompletar() { $('#completar').close(); pintarTodo(); if (anadidas) sincronizar(); }
$('#btnCompletar').addEventListener('click', abrirCompletar);
function pintarClaveTMDB() {
  const k = claveTMDB(), fin = `(…${k.slice(-4)})`;
  $('#tmdbEstado').textContent = !k ? 'Sin clave: las películas y series solo buscan en Wikipedia'
    : leerLS(LS_TMDB_ORIGEN, 'movil') === 'repo' ? `Compartida en tu repositorio de datos ${fin}`
    : cfg ? `Solo en este móvil ${fin}: se compartirá al sincronizar` : `Solo en este móvil ${fin}: se compartirá al conectar con GitHub`;
  $('#tmdbCambiar').textContent = k ? 'Cambiar' : 'Añadir';
  $('#tmdbQuitar').hidden = !k;
}
$('#tmdbCambiar').addEventListener('click', async () => { await pedirClaveTMDB(); pintarClaveTMDB(); });
$('#tmdbQuitar').addEventListener('click', async () => {
  const compartida = cfg && leerLS(LS_TMDB_ORIGEN, 'movil') === 'repo';
  if (!confirm(compartida ? '¿Quitar la clave de TMDB? Se quitará de todos los móviles conectados a tu repositorio de datos.' : '¿Quitar la clave de TMDB de este móvil?')) return;
  if (compartida) {
    try { await enCola(() => escribirConfig({ tmdb: null })); }
    catch (e) { avisar(`No se pudo quitar del repositorio: ${e.message || 'sin conexión'}`); return; }
  }
  borrarClaveLocal(); tmdbAhoraNo = false; pintarClaveTMDB(); avisar('Clave de TMDB quitada');
});
$('#compCerrar').addEventListener('click', cerrarCompletar);
$('#compForm').addEventListener('submit', e => { e.preventDefault(); buscarCompletar(); });
$('#compLista').addEventListener('click', e => { const b = e.target.closest('[data-comp]'); if (b) usarResultado(Number(b.dataset.comp)); });
$('#compSaltar').addEventListener('click', () => { saltadas++; posCola++; mostrarActual(); });
$('#compNunca').addEventListener('click', () => {
  const i = items.find(x => x.id === cola[posCola]);
  if (i) { i.sinPortada = true; i.actualizado = sello(i); sucio = true; guardarLocal(); }
  posCola++; mostrarActual();
});
$('#compActual').addEventListener('click', e => { if (e.target.id === 'compListo') cerrarCompletar(); });

/* ---- portada a partir del enlace de una imagen (Google Imágenes › «Copiar dirección de la imagen») ---- */
function normalizarEnlace(raw) {
  let u = String(raw || '').trim();
  if (!u) throw new Error('Pega primero la dirección de la imagen.');
  if (/^data:image\//i.test(u)) {
    if (u.length > 120000) throw new Error('Esa imagen viene incrustada y es demasiado grande. Ábrela primero y copia su dirección.');
    return u;
  }
  u = u.replace(/^http:\/\//i, 'https://');
  if (!/^https:\/\/\S+$/i.test(u)) throw new Error('Eso no parece la dirección de una imagen (debe empezar por https://).');
  return u;
}
function probarImagen(u) {
  return new Promise((ok, ko) => {
    const im = new Image(), t = setTimeout(() => ko(new Error('La imagen tarda demasiado en cargar. Prueba con otra.')), 10000);
    im.onload = () => { clearTimeout(t); if (im.naturalWidth < 40) ko(new Error('Esa imagen es demasiado pequeña. Busca una más grande.')); else ok(u); };
    im.onerror = () => { clearTimeout(t); ko(new Error('No se pudo cargar esa imagen. Asegúrate de copiar la dirección de la imagen, no la de la página.')); };
    im.src = u;
  });
}
/** Conecta un bloque «pegar enlace»: botón que lo despliega, campo, botón Usar y mensaje de error. */
function montarEnlace(boton, pref, alUsar) {
  const box = $(`#${pref}Box`), inp = $(`#${pref}Url`), err = $(`#${pref}Err`), usar = $(`#${pref}Usar`);
  $(boton).addEventListener('click', () => { box.hidden = !box.hidden; err.textContent = ''; if (!box.hidden) inp.focus(); });
  const probar = async () => {
    err.textContent = ''; usar.disabled = true; const txt = usar.textContent; usar.textContent = '…';
    try { const u = await probarImagen(normalizarEnlace(inp.value)); inp.value = ''; box.hidden = true; alUsar(u); }
    catch (e) { err.textContent = e.message; }
    usar.disabled = false; usar.textContent = txt;
  };
  usar.addEventListener('click', probar);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); probar(); } });
  return () => { box.hidden = true; inp.value = ''; err.textContent = ''; };
}
const cerrarEnlaceForm = montarEnlace('#btnEnlace', 'enlace', u => {
  portadaSel = { ...(portadaSel || {}), url: u, fuente: 'un enlace' }; mostrarPortadaForm();
  const hint = $('#autoHint'); hint.classList.remove('oferta'); hint.textContent = '✓ Portada añadida desde el enlace.'; hint.hidden = false;
});
const cerrarEnlaceComp = montarEnlace('#btnCompEnlace', 'compEnlace', u => {
  const i = items.find(x => x.id === cola[posCola]); if (!i) return;
  i.portada = u; i.actualizado = sello(i); sucio = true; guardarLocal();
  anadidas++; posCola++; mostrarActual();
});

/** Miniatura de portada en las listas; si la imagen falla, vuelve la barrita de color. */
const marcaDe = i => i.portada
  ? `<span class="portada-mini"><img src="${esc(i.portada)}" alt="" loading="lazy" onerror="this.parentNode.outerHTML='<span class=&quot;marca ${i.tipo}&quot;></span>'"></span>`
  : `<span class="marca ${i.tipo}"></span>`;

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
  const temps = tipo === 'serie' || tipo === 'anime' ? leerTemporadas(form.temporada.value) : { ini: null, fin: null };
  if (!temps) { form.temporada.classList.add('mal'); form.temporada.focus(); avisar('Temporada: un número o un rango, p. ej. 1-4'); return; }
  const precio = tipo === 'libro' && modo === 'hecho' ? leerPrecio(form.precio.value) : null;
  if (Number.isNaN(precio)) { form.precio.classList.add('mal'); form.precio.focus(); avisar('Revisa el precio (ej. 19,90)'); return; }
  const dup = analizarDup();
  if (modo === 'hecho' && dup.choca.length && !form.revisionado.checked) {
    const u = dup.choca[0], que = tipo === 'libro' ? 'relectura' : 'revisionado';
    if (!confirm(`Ya tienes «${u.titulo}» en ${tipo === 'libro' ? 'Leídos' : 'Vistas'} (${anioDe(u)}).\n\n¿Guardarlo otra vez sin marcarlo como ${que}?`)) return;
  }
  if (modo === 'pendiente' && dup.pend.length && !confirm(`«${dup.pend[0].titulo}» ya está en ${tipo === 'libro' ? 'Por leer' : 'Por ver'}. ¿Añadirlo otra vez?`)) return;
  const previo = editandoId ? items.find(i => i.id === editandoId) : null;
  const base = { id: previo ? previo.id : nuevoId(), tipo, titulo, anio, creado: previo ? previo.creado : ahora(),
    actualizado: sello(previo), por: cfg?.nombre || previo?.por || '' };
  let item, quitado = null;
  if (modo === 'pendiente') {
    item = { ...base, estado: 'pendiente', nota: form.nota.value.trim(), ganas: form.ganas.checked };
    delete item.anio;
    if (form.estreno.value) item.estreno = form.estreno.value;
    if (tipo === 'libro') item.autor = form.autor.value.trim();
    else {
      Object.assign(item, { genero: form.genero.value.trim(), plataforma, plataformaOtro: plataforma === 'Otros' ? form.plataformaOtro.value.trim() : '' });
      if (tipo !== 'pelicula') { item.temporada = temps.ini; if (temps.fin) item.temporadaFin = temps.fin; }
    }
  } else if (tipo === 'libro') {
    item = { ...base, autor: form.autor.value.trim(), formato, paginas: num(form.paginas.value), precio, recomienda: form.recomienda.checked, fechaFin: form.fechaFin.value && Number(form.fechaFin.value.slice(0, 4)) === anio ? form.fechaFin.value : null };
  } else {
    item = { ...base, genero: form.genero.value.trim(), plataforma,
      plataformaOtro: plataforma === 'Otros' ? form.plataformaOtro.value.trim() : '', recomienda: form.recomienda.checked,
      fechaVisto: previo?.fechaVisto && Number(previo.fechaVisto.slice(0, 4)) === anio ? previo.fechaVisto : (anio === ANIO_ACTUAL ? hoyISO() : null) };
    if (tipo === 'pelicula') item.duracion = num(form.duracion.value);
    else { Object.assign(item, { temporada: temps.ini, capitulos: num(form.capitulos.value), duracionCap: num(form.duracionCap.value) }); if (temps.fin) item.temporadaFin = temps.fin; }
  }
  if (portadaSel?.url) item.portada = portadaSel.url;
  else if (previo?.sinPortada) item.sinPortada = true;
  if (portadaSel?.anilistId) item.anilistId = portadaSel.anilistId;
  if (portadaSel?.isbn) item.isbn = portadaSel.isbn;
  if (portadaSel?.tmdbId) item.tmdbId = portadaSel.tmdbId;
  if (modo === 'hecho') {
    if (form.revisionado.checked) item.revisionado = true;
    if (item.recomienda && form.porque.value.trim()) item.porque = form.porque.value.trim();
  }
  if (modo === 'hecho' && (previo?.dePendiente || (previo && esPend(previo)))) item.dePendiente = true;
  if (previo) items[items.indexOf(previo)] = item; else items.push(item);
  // Si acabas algo que tenías pendiente, sale de la lista de pendientes
  if (!previo && modo === 'hecho') {
    const p = pendientes().find(i => (i.tipo === 'libro') === (tipo === 'libro') && normal(i.titulo) === normal(titulo));
    if (p) { p.borrado = true; p.actualizado = sello(p); quitado = p; item.dePendiente = true; }
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
  form.nota.value = it.nota || ''; form.ganas.checked = !!it.ganas; form.estreno.value = it.estreno || '';
  form.revisionado.checked = !!it.revisionado; form.recomienda.checked = !!it.recomienda; form.porque.value = it.porque || '';
  portadaSel = it.portada || it.anilistId || it.isbn || it.tmdbId ? { url: it.portada || '', anilistId: it.anilistId, isbn: it.isbn, tmdbId: it.tmdbId } : null; mostrarPortadaForm();
  if (it.tipo === 'libro') {
    form.libro.value = it.titulo; form.autor.value = it.autor || ''; formato = it.formato || 'Kindle';
    form.paginas.value = it.paginas ?? ''; form.precio.value = it.precio != null ? String(it.precio).replace('.', ',') : ''; form.fechaFin.value = it.fechaFin || '';
  } else {
    form.titulo.value = it.titulo; form.genero.value = it.genero || ''; plataforma = it.plataforma || null;
    form.plataformaOtro.value = it.plataformaOtro || '';
    form.duracion.value = it.duracion ?? ''; form.temporada.value = textoTemporadas(it);
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
  it.borrado = true; it.actualizado = sello(it); sucio = true; guardarLocal();
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
/* Listas largas: se dibujan por tandas; «Ver más» añade otra tanda. Al filtrar o buscar se vuelve a la primera. */
const TANDA = 40;
/* ---- vista de las listas: cuadrícula de portadas (por defecto) o lista con detalles. Cada móvil recuerda la suya ---- */
const LS_VISTA = 'mb_vista';
let vista = leerLS(LS_VISTA, 'cuadricula') === 'lista' ? 'lista' : 'cuadricula';
const enRejilla = () => vista === 'cuadricula';
const claseLista = () => 'lista' + (enRejilla() ? ' rejilla' : '');
const ICO_REJILLA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>';
const ICO_LISTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="3.5" rx="1.5"/><rect x="3" y="10.25" width="18" height="3.5" rx="1.5"/><rect x="3" y="16.5" width="18" height="3.5" rx="1.5"/></svg>';
function pintarBotonesVista() {
  $$('[data-vista]').forEach(b => {
    b.innerHTML = enRejilla() ? ICO_LISTA : ICO_REJILLA;
    const txt = enRejilla() ? 'Ver como lista' : 'Ver como cuadrícula de portadas';
    b.title = txt; b.setAttribute('aria-label', txt);
  });
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-vista]')) return;
  vista = enRejilla() ? 'lista' : 'cuadricula'; escribirLS(LS_VISTA, vista);
  pintarBotonesVista(); pintarVistas(); pintarLeidos(); pintarPorVer(); pintarPorLeer();
});
/**
 * Casilla de la cuadrícula: portada (o, si no hay o falla, un recuadro con el icono y el título),
 * marcas encima (temporada, 👍/⭐, ↻, estreno) y debajo el título y un dato corto.
 */
function casilla(i, { abajo = '', esquina = '' } = {}) {
  const marcas = [];
  if (etiquetaTemp(i)) marcas.push(`<span class="mc temp">${esc(etiquetaTemp(i))}</span>`);
  const der = [i.recomienda && !esPend(i) ? '<span class="mc" title="Lo recomendaría">👍</span>' : '',
    i.ganas && esPend(i) ? '<span class="mc" title="Muchas ganas">⭐</span>' : '',
    i.revisionado ? `<span class="mc" title="${i.tipo === 'libro' ? 'Relectura' : 'Revisionado'}">↻</span>` : ''].join('');
  return `<li><button class="item casilla" data-id="${esc(i.id)}" aria-label="${esc(i.titulo)}">
    <span class="tapa ${i.tipo}"><span class="sin-tapa"><i>${ICONO_TIPO[i.tipo]}</i><b>${esc(i.titulo)}</b></span>${i.portada ? `<img src="${esc(i.portada)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      ${marcas.join('')}${der ? `<span class="mcs">${der}</span>` : ''}${esquina ? `<span class="mc abajo">${esc(esquina)}</span>` : ''}</span>
    <span class="ct">${esc(i.titulo)}</span>${abajo ? `<span class="cs">${esc(abajo)}</span>` : ''}</button></li>`;
}
const lim = { v: TANDA, l: TANDA, pv: TANDA, pl: TANDA };
const reinicia = (k, f) => () => { lim[k] = TANDA; f(); };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mas]'); if (!b) return;
  const k = b.dataset.mas; lim[k] += TANDA;
  ({ v: pintarVistas, l: pintarLeidos, pv: pintarPorVer, pl: pintarPorLeer })[k]();
});
const botonMas = (k, resto) => resto > 0 ? `<button type="button" class="ver-mas" data-mas="${k}">Ver más · quedan ${resto}</button>` : '';
/** Dato corto bajo la portada: autor en libros; fecha en lo demás (si es de ese año). */
const abajoHecho = (i, anio) => ({ abajo: i.tipo === 'libro' ? i.autor || fechaCorta(i.fechaFin)
  : i.fechaVisto && Number(i.fechaVisto.slice(0, 4)) === anio ? fechaCorta(i.fechaVisto) : NOMBRE_TIPO[i.tipo] });
/** Agrupa por año y dibuja solo hasta «max» elementos; las cabeceras llevan los totales del año completo. */
function porTandas(lista, max, cabecera, fila) {
  let quedan = max, h = '';
  for (const [anio, l] of porAnio(lista)) {
    if (quedan <= 0) break;
    const vis = l.slice(0, quedan); quedan -= vis.length;
    h += cabecera(anio, l) + `<ul class="${claseLista()}">${vis.map(i => enRejilla() ? casilla(i, abajoHecho(i, anio)) : fila(i, anio)).join('')}</ul>`;
  }
  return h;
}
$('#filtroVistas').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; filtro = b.dataset.f;
  $$('#filtroVistas .chip').forEach(c => c.classList.toggle('on', c === b)); lim.v = TANDA; pintarVistas();
});
$('#anioVistas').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { anioV = b.dataset.a; lim.v = TANDA; pintarVistas(); } });
$('#anioLeidos').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { anioL = b.dataset.a; lim.l = TANDA; pintarLeidos(); } });
$('#buscarVistas').addEventListener('input', reinicia('v', () => pintarVistas()));
$('#buscarLeidos').addEventListener('input', reinicia('l', () => pintarLeidos()));
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

/* Una serie o anime apuntado por temporadas cuenta como un solo título; cada película cuenta por separado. */
const claveObra = i => i.tipo === 'pelicula' ? 'id:' + i.id : i.tipo + '|' + normal(i.titulo);
function obras(lista) {
  const m = new Map();
  for (const i of lista) {
    const k = claveObra(i), o = m.get(k) || { titulo: i.titulo, tipo: i.tipo, min: 0, rec: false, registros: 0 };
    o.min += minutos(i); o.rec = o.rec || !!i.recomienda; o.registros++; m.set(k, o);
  }
  return [...m.values()];
}
/** Como ranking(), pero cada serie suma una vez aunque tenga varias temporadas apuntadas. */
function rankingObras(lista, f) {
  const m = new Map();
  for (const i of lista) { const v = f(i); if (!v) continue; if (!m.has(v)) m.set(v, new Set()); m.get(v).add(claveObra(i)); }
  return [...m].map(([v, s]) => [v, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
}

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
  const ob = obras(base);
  const rec = ob.length ? Math.round(100 * ob.filter(o => o.rec).length / ob.length) : 0;
  const cuando = anioV === 'todos' ? '' : ` en ${anioV}`;
  $('#statsVistas').innerHTML = `
    <div class="stat"><b>${ob.length}</b><span>${{ pelicula: 'películas', serie: 'series', anime: 'animes' }[filtro] || 'títulos'}${cuando}</span></div>
    <div class="stat"><b>${horas(totMin)}</b><span>vistas${cuando}</span></div>
    <div class="stat"><b>${rec}%</b><span>recomendadas</span></div>`;
  if (!lista.length) { $('#listaVistas').innerHTML = `<ul class="${claseLista()}">${vacio(todos.length, '¿Qué has visto últimamente?', 'Añádelo desde el botón central.')}</ul>`; return; }
  $('#listaVistas').innerHTML = porTandas(lista, lim.v, (anio, l) => {
    const min = l.reduce((s, i) => s + minutos(i), 0);
    return `<h2 class="grupo"><span>${anio}</span><small>${plural(obras(l).length, 'título', 'títulos')}${min ? ' · ' + horas(min) : ''}</small></h2>`;
  }, (i, anio) => {
      const partes = [NOMBRE_TIPO[i.tipo]];
      if (i.tipo === 'pelicula') { if (i.duracion) partes.push(`${i.duracion} min`); }
      else {
        if (etiquetaTemp(i)) partes.push(etiquetaTemp(i));
        if (i.capitulos) partes.push(`${i.capitulos} cap.${i.duracionCap ? ` × ${i.duracionCap} min` : ''}`);
      }
      if (i.genero) partes.push(i.genero); if (donde(i)) partes.push(donde(i));
      const f = i.fechaVisto && Number(i.fechaVisto.slice(0, 4)) === anio ? fechaCorta(i.fechaVisto) : '';
      return `<li><button class="item" data-id="${esc(i.id)}">${marcaDe(i)}<span class="cuerpo">
        <span class="t"><em>${esc(i.titulo)}</em>${i.recomienda ? '<span class="rec" title="La recomendaría">👍</span>' : ''}${i.revisionado ? '<span class="flag">↻ Revisionado</span>' : ''}</span>
        <span class="m">${partes.map(esc).join(' · ')}</span>${i.porque ? `<span class="nota">«${esc(i.porque)}»</span>` : ''}</span><span class="d">${f}</span></button></li>`;
  }) + botonMas('v', lista.length - lim.v);
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
  if (!lista.length) { $('#listaLeidos').innerHTML = `<ul class="${claseLista()}">${vacio(todos.length, '¿Qué has leído últimamente?', 'Añádelo desde el botón central eligiendo «Libro».')}</ul>`; return; }
  $('#listaLeidos').innerHTML = porTandas(lista, lim.l, (anio, l) => {
    const p = l.reduce((s, i) => s + (i.paginas || 0), 0);
    const gasto = l.reduce((s, i) => s + (i.precio || 0), 0);
    return `<h2 class="grupo"><span>${anio}</span><small>${plural(l.length, 'libro', 'libros')}${p ? ' · ' + p.toLocaleString('es-ES') + ' págs.' : ''}${gasto ? ' · ' + euros(gasto) : ''}</small></h2>`;
  }, i => {
      const partes = [i.autor, i.formato, i.paginas ? `${i.paginas} págs.` : '', i.precio != null ? euros(i.precio) : ''].filter(Boolean);
      return `<li><button class="item" data-id="${esc(i.id)}">${marcaDe(i)}<span class="cuerpo">
        <span class="t"><em>${esc(i.titulo)}</em>${i.recomienda ? '<span class="rec" title="Lo recomendaría">👍</span>' : ''}${i.revisionado ? '<span class="flag">↻ Relectura</span>' : ''}</span>
        <span class="m">${partes.map(esc).join(' · ')}</span>${i.porque ? `<span class="nota">«${esc(i.porque)}»</span>` : ''}</span>
        <span class="d">${fechaCorta(i.fechaFin)}</span></button></li>`;
  }) + botonMas('l', lista.length - lim.l);
}
let filtroPV = 'todo', filtroPL = 'todo';
$('#filtroPorVer').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; filtroPV = b.dataset.f;
  $$('#filtroPorVer .chip').forEach(c => c.classList.toggle('on', c === b)); lim.pv = TANDA; pintarPorVer();
});
$('#filtroPorLeer').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; filtroPL = b.dataset.f;
  $$('#filtroPorLeer .chip').forEach(c => c.classList.toggle('on', c === b)); lim.pl = TANDA; pintarPorLeer();
});
$('#buscarPorVer').addEventListener('input', reinicia('pv', () => pintarPorVer()));
$('#buscarPorLeer').addEventListener('input', reinicia('pl', () => pintarPorLeer()));
/** Fecha de estreno: futura → «📅 12 dic»; ya pasada → «Disponible». */
const yaEstrenado = i => !i.estreno || i.estreno <= hoyISO();
const fechaPend = i => i.estreno ? (yaEstrenado(i) ? 'Disponible' : `📅 ${fechaCorta(i.estreno)}`) : fechaCorta(i.creado);
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
  : [NOMBRE_TIPO[i.tipo], etiquetaTemp(i), i.genero, donde(i)].filter(Boolean);
function filaPend(i) {
  if (enRejilla()) {
    const futuro = i.estreno && !yaEstrenado(i);
    return casilla(i, { abajo: i.tipo === 'libro' ? i.autor || '' : NOMBRE_TIPO[i.tipo], esquina: futuro ? `📅 ${fechaCorta(i.estreno)}` : '' });
  }
  return `<li><button class="item" data-id="${esc(i.id)}">${marcaDe(i)}<span class="cuerpo">
    <span class="t"><em>${esc(i.titulo)}</em>${i.ganas ? '<span class="ganas" title="Muchas ganas">⭐</span>' : ''}</span>
    <span class="m">${metaPend(i).map(esc).join(' · ')}</span>${i.nota ? `<span class="nota">${esc(i.nota)}</span>` : ''}</span>
    <span class="d">${fechaPend(i)}</span></button></li>`;
}
function pintarPorVer() {
  const total = pendientes().filter(i => i.tipo !== 'libro').length, l = filtrarPorVer();
  $('#elegirV').hidden = !total;
  $('#listaPorVer').className = claseLista();
  $('#listaPorVer').innerHTML = l.length ? l.slice(0, lim.pv).map(filaPend).join('') + botonMas('pv', l.length - lim.pv)
    : vacio(total, 'Nada pendiente todavía', 'Apunta lo que quieras ver desde el botón central, eligiendo «Lo tengo pendiente».');
}
function pintarPorLeer() {
  const total = pendientes().filter(i => i.tipo === 'libro').length, l = filtrarPorLeer();
  $('#elegirL').hidden = !total;
  $('#listaPorLeer').className = claseLista();
  $('#listaPorLeer').innerHTML = l.length ? l.slice(0, lim.pl).map(filaPend).join('') + botonMas('pl', l.length - lim.pl)
    : vacio(total, 'Nada pendiente todavía', 'Apunta lo que quieras leer desde el botón central, eligiendo «Libro» y «Lo tengo pendiente».');
}

/* «Elige por mí»: sorteo entre lo pendiente (con el filtro activo); lo que tiene ⭐ cuenta triple. */
let sorteoLista = [], sorteoUltimo = null, sorteoLibro = false;
function elegirPorMi(libros) {
  const todos_ = libros ? filtrarPorLeer() : filtrarPorVer();
  if (!todos_.length) { avisar('No hay nada con ese filtro'); return; }
  const l = todos_.filter(yaEstrenado); // lo que aún no ha salido no se puede ver/leer todavía
  if (!l.length) { avisar(libros ? 'Lo que tienes aún no se ha publicado' : 'Lo que tienes aún no se ha estrenado'); return; }
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
  const sub = i.tipo === 'libro' ? [i.autor] : [i.temporada == null ? '' : i.temporadaFin ? `Temporadas ${i.temporada}–${i.temporadaFin}` : `Temporada ${i.temporada}`, i.genero, donde(i)];
  c.innerHTML = `${i.portada ? `<img class="sorteo-portada" src="${esc(i.portada)}" alt="" onerror="this.remove()">` : ''}<span class="tipo-t">${NOMBRE_TIPO[i.tipo]}${i.ganas ? ' · ⭐ muchas ganas' : ''}</span><h3>${esc(i.titulo)}</h3>
    ${sub.filter(Boolean).length ? `<p>${sub.filter(Boolean).map(esc).join(' · ')}</p>` : ''}${i.nota ? `<p class="nota">«${esc(i.nota)}»</p>` : ''}`;
  c.classList.remove('gira'); void c.offsetWidth; c.classList.add('gira');
}
$('#elegirV').addEventListener('click', () => elegirPorMi(false));
$('#elegirL').addEventListener('click', () => elegirPorMi(true));
$('#sorteoOtra').addEventListener('click', tirar);
$('#sorteoVale').addEventListener('click', () => { $('#sorteo').close(); avisar(sorteoLibro ? '¡Buena lectura! 📖' : '¡A disfrutarla! 🍿'); });
$('#sorteoCerrar').addEventListener('click', () => $('#sorteo').close());

/* ---------------- tu año ---------------- */
let anioRes = null;
/** Cuenta valores y devuelve [[valor, n], …] de más a menos. */
function ranking(lista, f) {
  const m = new Map();
  for (const i of lista) { const v = f(i); if (v) m.set(v, (m.get(v) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
}
const mayor = (l, f) => l.reduce((m, i) => (f(i) > (m ? f(m) : 0) ? i : m), null);
function datosAnio(Y) {
  const T = terminados().filter(i => anioDe(i) === Y);
  const pant = T.filter(i => i.tipo !== 'libro'), libros = T.filter(i => i.tipo === 'libro');
  const min = pant.reduce((s, i) => s + minutos(i), 0), pags = libros.reduce((s, i) => s + (i.paginas || 0), 0);
  const conPags = libros.filter(i => i.paginas), conPrecio = libros.filter(i => i.precio != null);
  const autores = ranking(libros, i => i.autor), obP = obras(pant);
  return {
    nTitulos: obP.length,
    Y, total: T.length, pant, libros, min, pags,
    pelis: pant.filter(i => i.tipo === 'pelicula'), series: pant.filter(i => i.tipo === 'serie'), animes: pant.filter(i => i.tipo === 'anime'),
    caps: pant.reduce((s, i) => s + (i.tipo !== 'pelicula' ? i.capitulos || 0 : 0), 0),
    nSeries: obP.filter(o => o.tipo === 'serie').length, nAnimes: obP.filter(o => o.tipo === 'anime').length,
    generos: rankingObras(pant, i => i.genero), plataformas: rankingObras(pant, donde),
    masLarga: mayor(obP.filter(o => o.tipo !== 'pelicula'), o => o.min), peliLarga: mayor(pant.filter(i => i.tipo === 'pelicula'), i => i.duracion || 0),
    rec: obP.filter(o => o.rec),
    media: conPags.length ? Math.round(pags / conPags.length) : 0, gordo: mayor(libros, i => i.paginas || 0),
    autor: autores[0] && autores[0][1] >= 2 ? autores[0] : null, nAutores: autores.length,
    kindle: libros.filter(i => i.formato === 'Kindle').length, papel: libros.filter(i => i.formato === 'Libro').length,
    gasto: conPrecio.reduce((s, i) => s + i.precio, 0), nPrecio: conPrecio.length,
    tachados: T.filter(i => i.dePendiente).length,
    recLibros: libros.filter(i => i.recomienda),
    revisionados: pant.filter(i => i.revisionado).length, relecturas: libros.filter(i => i.revisionado).length,
  };
}
function aniosConDatos() { return [...new Set(terminados().map(anioDe))].sort((a, b) => b - a); }
function abrirResumen() {
  const anios = aniosConDatos();
  if (!anios.includes(anioRes)) anioRes = anios.includes(ANIO_ACTUAL) ? ANIO_ACTUAL : anios[0] ?? ANIO_ACTUAL;
  pintarResumen(); $('#resumen').showModal(); $('.res-scroll').scrollTop = 0;
}
$('#btnResumen').addEventListener('click', abrirResumen);
$('#resCerrar').addEventListener('click', () => $('#resumen').close());
$('#resAnios').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { anioRes = Number(b.dataset.a); pintarResumen(); $('.res-scroll').scrollTop = 0; } });

function delta(ahora_, antes, unidad) {
  if (antes == null) return '';
  const d = ahora_ - antes;
  return `<em>${d === 0 ? `Igual que en ${anioRes - 1}` : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString('es-ES')}${unidad} ${d > 0 ? 'más' : 'menos'} que en ${anioRes - 1}`}</em>`;
}
function barras(lista, n = 5) {
  const top = lista.slice(0, n), max = top.length ? top[0][1] : 1;
  return `<ul class="barras">${top.map(([v, c]) => `<li><span>${esc(v)}</span><b>${c}</b><div class="pista"><i style="width:${Math.max(4, Math.round(100 * c / max))}%"></i></div></li>`).join('')}</ul>`;
}
const dato = (k, v) => `<div class="res-dato"><span>${k}</span><b>${v}</b></div>`;

function pintarResumen() {
  const anios = aniosConDatos();
  $('#resAnios').hidden = anios.length < 2;
  $('#resAnios').innerHTML = anios.map(a => `<button class="chip${a === anioRes ? ' on' : ''}" data-a="${a}">${a}</button>`).join('');
  const d = datosAnio(anioRes), prev = anios.includes(anioRes - 1) ? datosAnio(anioRes - 1) : null;
  $('#resTitulo').textContent = `Tu ${anioRes}`;
  $('#resImagen').disabled = !d.total;
  if (!d.total) {
    $('#resCuerpo').innerHTML = `<div class="res-vacio"><b>Aún no hay nada en ${anioRes}</b>Cuando termines películas, series o libros, aquí verás tu resumen del año.</div>`;
    return;
  }
  let h = `<section class="res-t res-hero"><h3>Tu ${anioRes} en Mi Butaca<small>${anioRes === ANIO_ACTUAL ? 'En lo que va de año' : 'El año completo'}</small></h3>
    <div class="res-nums">
      <div class="res-num"><b>${d.nTitulos}</b><span>títulos vistos</span>${delta(d.nTitulos, prev?.nTitulos, '')}</div>
      <div class="res-num"><b>${horas(d.min)}</b><span>delante de la pantalla</span>${prev ? delta(Math.round(d.min / 60), Math.round(prev.min / 60), ' h') : ''}</div>
      <div class="res-num"><b>${d.libros.length}</b><span>${d.libros.length === 1 ? 'libro leído' : 'libros leídos'}</span>${delta(d.libros.length, prev?.libros.length, '')}</div>
      <div class="res-num"><b>${d.pags.toLocaleString('es-ES')}</b><span>páginas</span>${delta(d.pags, prev?.pags, '')}</div>
    </div></section>`;

  if (d.pant.length) {
    h += `<section class="res-t"><h3>En pantalla</h3>
      <div class="res-tipos">
        <div><b>${d.pelis.length}</b><span><i style="background:var(--peli)"></i>Películas</span></div>
        <div><b>${d.nSeries}</b><span><i style="background:var(--serie)"></i>Series</span></div>
        <div><b>${d.nAnimes}</b><span><i style="background:var(--anime)"></i>Anime</span></div>
      </div>
      ${d.caps ? dato('Capítulos vistos', d.caps.toLocaleString('es-ES')) : ''}
      ${d.masLarga?.min ? dato('La serie más larga', `${esc(d.masLarga.titulo)} · ${horas(d.masLarga.min)}`) : ''}
      ${d.revisionados ? dato('Revisionados', d.revisionados) : ''}
      ${d.peliLarga?.duracion ? dato('La película más larga', `${esc(d.peliLarga.titulo)} · ${d.peliLarga.duracion} min`) : ''}
      ${dato('Recomendarías', `${d.rec.length} de ${d.nTitulos}`)}
      ${d.generos.length ? `<p class="res-sub">Tus géneros</p>${barras(d.generos)}` : ''}
      ${d.plataformas.length ? `<p class="res-sub">Dónde has visto más</p>${barras(d.plataformas)}` : ''}
      ${d.rec.length ? `<p class="res-sub">Lo que recomiendas</p><div class="res-chips">${d.rec.slice(0, 8).map(i => `<span>👍 ${esc(i.titulo)}</span>`).join('')}${d.rec.length > 8 ? `<span>y ${d.rec.length - 8} más</span>` : ''}</div>` : ''}
    </section>`;
  }
  if (d.libros.length) {
    h += `<section class="res-t"><h3>Libros</h3>
      ${d.media ? dato('Media por libro', `${d.media.toLocaleString('es-ES')} págs.`) : ''}
      ${d.gordo?.paginas ? dato('El más largo', `${esc(d.gordo.titulo)} · ${d.gordo.paginas.toLocaleString('es-ES')} págs.`) : ''}
      ${d.autor ? dato('Autor del año', `${esc(d.autor[0])} · ${d.autor[1]} libros`) : d.nAutores > 1 ? dato('Autores distintos', d.nAutores) : ''}
      ${dato('Kindle / papel', `${d.kindle} / ${d.papel}`)}
      ${d.relecturas ? dato('Relecturas', d.relecturas) : ''}
      ${dato('Recomendarías', `${d.recLibros.length} de ${d.libros.length}`)}
      ${d.nPrecio ? dato('Gastado en libros', `${euros(Math.round(d.gasto * 100) / 100)}${d.nPrecio < d.libros.length ? ` <small>(${d.nPrecio} con precio)</small>` : ''}`) : ''}
      ${d.recLibros.length ? `<p class="res-sub">Libros que recomiendas</p><div class="res-chips">${d.recLibros.slice(0, 8).map(i => `<span>👍 ${esc(i.titulo)}</span>`).join('')}${d.recLibros.length > 8 ? `<span>y ${d.recLibros.length - 8} más</span>` : ''}</div>` : ''}
    </section>`;
  }
  const pv = pendientes().filter(i => i.tipo !== 'libro').length, pl = pendientes().filter(i => i.tipo === 'libro').length;
  if (d.tachados || (anioRes === ANIO_ACTUAL && (pv || pl))) {
    h += `<section class="res-t"><h3>Pendientes</h3>
      ${d.tachados ? dato('Tachados de tu lista', d.tachados) : ''}
      ${anioRes === ANIO_ACTUAL && pv ? dato('Te quedan por ver', pv) : ''}
      ${anioRes === ANIO_ACTUAL && pl ? dato('Te quedan por leer', pl) : ''}
    </section>`;
  }
  $('#resCuerpo').innerHTML = h;
}

/* Imagen para compartir (1080×1920, formato historia) */
function cargarImg(src) { return new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; }); }
function ajustar(ctx, txt, ancho) {
  if (ctx.measureText(txt).width <= ancho) return txt;
  while (txt.length > 1 && ctx.measureText(txt + '…').width > ancho) txt = txt.slice(0, -1);
  return txt + '…';
}
async function imagenResumen() {
  const d = datosAnio(anioRes), W = 1080, H = 1920, P = 90;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), F = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const BG = css('--bg'), CARD = css('--card'), INK = css('--ink'), INK2 = css('--ink2'), ACC = css('--acc'), CHIP = css('--chip');
  const caja = (x, y, w, h, r, col) => { c.fillStyle = col; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  const logo = await cargarImg('iconos/logo.svg');
  if (logo) { c.save(); c.beginPath(); c.roundRect(P, 110, 120, 120, 28); c.clip(); c.drawImage(logo, P, 110, 120, 120); c.restore(); }
  c.fillStyle = INK2; c.font = `600 40px ${F}`; c.fillText('Mi Butaca', P + 150, 160);
  c.fillStyle = INK2; c.font = `500 34px ${F}`; c.fillText(anioRes === ANIO_ACTUAL ? 'En lo que va de año' : 'Resumen del año', P + 150, 210);
  c.fillStyle = INK; c.font = `800 190px ${F}`; c.fillText(`Mi ${anioRes}`, P - 8, 450);
  const nums = [[d.nTitulos, 'títulos vistos'], [horas(d.min), 'de pantalla'], [d.libros.length, d.libros.length === 1 ? 'libro leído' : 'libros leídos'], [d.pags.toLocaleString('es-ES'), 'páginas']];
  const bw = (W - 2 * P - 30) / 2;
  nums.forEach(([v, k], n) => {
    const x = P + (n % 2) * (bw + 30), y = 530 + Math.floor(n / 2) * 250;
    caja(x, y, bw, 220, 36, CARD);
    c.fillStyle = INK; c.font = `800 92px ${F}`; c.fillText(ajustar(c, String(v), bw - 70), x + 40, y + 120);
    c.fillStyle = INK2; c.font = `500 36px ${F}`; c.fillText(k, x + 40, y + 178);
  });
  let y = 1090;
  const LIMITE = H - 170; // por encima del pie
  const lista = (titulo, filas, maxFilas) => {
    const n_ = Math.min(maxFilas, filas.length, Math.floor((LIMITE - y - 40) / 100));
    if (n_ < 1) return;
    c.fillStyle = INK2; c.font = `700 30px ${F}`; c.fillText(titulo.toUpperCase(), P, y); y += 30;
    const max = filas[0][1];
    for (const [v, n] of filas.slice(0, n_)) {
      c.fillStyle = INK; c.font = `600 40px ${F}`; c.fillText(ajustar(c, v, W - 2 * P - 120), P, y + 50);
      c.fillStyle = INK2; c.textAlign = 'right'; c.fillText(String(n), W - P, y + 50); c.textAlign = 'left';
      caja(P, y + 70, W - 2 * P, 14, 7, CHIP); caja(P, y + 70, Math.max(30, (W - 2 * P) * n / max), 14, 7, ACC);
      y += 100;
    }
    y += 50;
  };
  const extra = [d.autor ? `Autor del año: ${d.autor[0]}` : '', d.masLarga?.min ? `Serie más larga: ${d.masLarga.titulo}` : '',
    d.gordo?.paginas ? `Libro más largo: ${d.gordo.titulo}` : '', d.rec.length ? `Recomendarías ${d.rec.length} de ${d.nTitulos}` : ''].filter(Boolean);
  lista('Tus géneros', d.generos, 3);
  lista('Dónde has visto más', d.plataformas, extra.length ? 2 : 3);
  c.font = `500 38px ${F}`;
  for (const t of extra) { if (y > LIMITE) break; c.fillStyle = INK; c.fillText(ajustar(c, '· ' + t, W - 2 * P), P, y); y += 64; }
  c.fillStyle = INK2; c.font = `500 30px ${F}`; c.textAlign = 'center'; c.fillText('Hecho con Mi Butaca', W / 2, H - 80); c.textAlign = 'left';
  return new Promise(r => cv.toBlob(r, 'image/png'));
}
$('#resImagen').addEventListener('click', async () => {
  const b = $('#resImagen'); b.disabled = true; const t = b.textContent; b.textContent = 'Preparando…';
  try {
    const blob = await imagenResumen(), nombre = `mi-butaca-${anioRes}.png`;
    const file = new File([blob], nombre, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Mi ${anioRes} en Mi Butaca` }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      avisar('Imagen guardada en Descargas');
    }
  } catch { avisar('No se pudo crear la imagen'); }
  b.textContent = t; b.disabled = false;
});

function vacio(hayAlgo, titulo, texto) {
  return hayAlgo ? '<li class="vacio"><b>Nada coincide</b>Prueba con otra búsqueda o filtro.</li>'
    : `<li class="vacio"><b>${titulo}</b>${texto}</li>`;
}
function pintarTodo() {
  pintarBotonesVista();
  pintarVistas(); pintarLeidos(); pintarPorVer(); pintarPorLeer(); pintarSegmentos();
  if ($('#resumen').open) pintarResumen();
  if ($('#calendario').open) pintarCalendario();
  pintarDlTitulos();
  const n = (l, libro) => l.filter(i => (i.tipo === 'libro') === libro).length || '';
  $('#nVistas').textContent = obras(terminados().filter(i => i.tipo !== 'libro')).length || ''; $('#nPorVer').textContent = n(pendientes(), false);
  $('#nLeidos').textContent = n(terminados(), true); $('#nPorLeer').textContent = n(pendientes(), true);
  $('#dlAutores').innerHTML = [...new Set(visibles().filter(i => i.autor).map(i => i.autor))].map(a => `<option value="${esc(a)}">`).join('');
  pintarEstado();
}

/* ---------------- ajustes ---------------- */
const dlg = $('#ajustes'), fa = $('#formAjustes');
$('#btnSync').addEventListener('click', () => {
  fa.owner.value = cfg?.owner || ''; fa.repo.value = cfg?.repo || 'mi-butaca-datos';
  fa.token.value = cfg?.token || ''; fa.nombre.value = cfg?.nombre || ''; fa.caduca.value = cfg?.caduca || '';
  $('#avisoExport').checked = !!leerLS(LS_AVISO_EXPORT, false);
  pintarClaveTMDB();
  const nSin = sinPortada().length;
  $('#btnCompletar').textContent = nSin ? `🖼️ Buscar portadas que faltan (${nSin})` : '🖼️ Portadas: todo completo';
  $('#btnCompletar').disabled = !nSin;
  const est = $('#estadoConexion');
  est.className = 'estado' + (ultimoError ? ' err' : cfg ? ' ok' : '');
  est.textContent = ultimoError || (cfg ? `Conectado a ${cfg.owner}/${cfg.repo} · ${$('#syncTxt').textContent}` : 'Sin conectar: los datos solo están en este móvil.');
  $('#btnDesconectar').disabled = !cfg;
  dlg.showModal();
});
$('#btnCerrar').addEventListener('click', () => dlg.close());
$('#btnConectar').addEventListener('click', async () => {
  const nuevo = { owner: fa.owner.value.trim(), repo: fa.repo.value.trim(), token: fa.token.value.trim(), nombre: fa.nombre.value.trim() };
  if (fa.caduca.value) nuevo.caduca = fa.caduca.value;
  const est = $('#estadoConexion');
  if (!nuevo.owner || !nuevo.repo || !nuevo.token) { est.className = 'estado err'; est.textContent = 'Rellena usuario, repositorio y token.'; return; }
  // Un token copiado con un espacio raro o un carácter de más daría un error incomprensible del navegador
  if (/[^\x21-\x7e]/.test(nuevo.token)) { est.className = 'estado err'; est.textContent = 'El token tiene espacios o caracteres que no son suyos. Vuelve a copiarlo de GitHub y pégalo de nuevo.'; return; }
  est.className = 'estado'; est.textContent = 'Comprobando…';
  try {
    await bajar(nuevo);
    cfg = nuevo; escribirLS(LS.cfg, cfg); ultimoError = null; tokenMalo = false;
    try { localStorage.removeItem(LS_TOKEN_LUEGO); } catch { /* */ }
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
/* ---------------- exportar a Excel (CSV) ---------------- */
const COLUMNAS = [
  ['Estado', i => (esPend(i) ? 'Pendiente' : 'Terminado')], ['Tipo', i => NOMBRE_TIPO[i.tipo]], ['Título', i => i.titulo],
  ['Año', i => (esPend(i) ? '' : anioDe(i))], ['Temporada', i => textoTemporadas(i)], ['Capítulos', i => i.capitulos],
  ['Min. por capítulo', i => i.duracionCap], ['Duración (min)', i => i.duracion],
  ['Minutos totales', i => (esPend(i) || i.tipo === 'libro' ? '' : minutos(i))], ['Género', i => i.genero],
  ['Dónde', i => (i.tipo === 'libro' ? '' : donde(i))], ['Autor', i => i.autor], ['Formato', i => (esPend(i) ? '' : i.formato)],
  ['Páginas', i => i.paginas], ['Precio (€)', i => (i.precio != null ? String(i.precio).replace('.', ',') : '')],
  ['Fecha', i => i.fechaFin || i.fechaVisto], ['Recomendado', i => (i.recomienda ? 'Sí' : '')], ['Por qué', i => i.porque],
  ['Revisionado / relectura', i => (i.revisionado ? 'Sí' : '')], ['Estreno', i => i.estreno], ['Nota', i => i.nota],
  ['Muchas ganas', i => (i.ganas ? 'Sí' : '')], ['ISBN', i => i.isbn], ['TMDB', i => i.tmdbId], ['Portada', i => i.portada], ['Añadido', i => (i.creado || '').slice(0, 10)],
];
/** CSV con «;» y BOM UTF-8: Excel en español lo abre directamente en columnas y con acentos. */
function textoCSV() {
  const celda = v => { const t = v == null ? '' : String(v); return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const filas = [...terminados().sort((a, b) => anioDe(b) - anioDe(a) || (a.tipo === 'libro') - (b.tipo === 'libro') || a.titulo.localeCompare(b.titulo, 'es')),
    ...pendientes().sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'))];
  return '﻿' + [COLUMNAS.map(c => c[0]), ...filas.map(i => COLUMNAS.map(c => c[1](i)))].map(f => f.map(celda).join(';')).join('\r\n') + '\r\n';
}
const LS_ESTRENOS_CERRADOS = 'mb_estrenos_cerrados';
const ICONO_TIPO = { pelicula: '🎬', serie: '📺', anime: '🍥', libro: '📖' };
/** Texto del aviso de estreno. Una serie «continúa» si es la temporada 2 o posterior, o si ya viste alguna temporada. */
function textoEstreno(i) {
  const t = `«${i.titulo}»`;
  if (i.tipo === 'libro') return `Publicación del libro ${t}`;
  if (i.tipo === 'pelicula') return `Estreno de la película ${t}`;
  const continua = (i.temporada != null && i.temporada > 1)
    || terminados().some(x => x.tipo === i.tipo && normal(x.titulo) === normal(i.titulo));
  return continua ? `Nueva temporada de ${t}` : `Estreno ${i.tipo === 'anime' ? 'del anime' : 'de la serie'} ${t}`;
}
const detalleEstreno = i => [i.tipo === 'libro' ? i.autor : '', i.temporada != null && i.tipo !== 'pelicula' && i.tipo !== 'libro'
  ? (i.temporadaFin ? `Temporadas ${i.temporada}–${i.temporadaFin}` : `Temporada ${i.temporada}`) : '', i.tipo === 'libro' ? '' : donde(i)].filter(Boolean).join(' · ');
/** Pendientes que se estrenan hoy y no has cerrado. */
function estrenosDeHoy() {
  const hoy = hoyISO(), cerrados = leerLS(LS_ESTRENOS_CERRADOS, {});
  return pendientes().filter(i => i.estreno === hoy && cerrados[i.id] !== hoy).sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
}
function cerrarEstrenos(ids) {
  const hoy = hoyISO(), c = leerLS(LS_ESTRENOS_CERRADOS, {}), limpio = {};
  for (const [k, v] of Object.entries(c)) if (v === hoy) limpio[k] = v; // lo de otros días ya no hace falta
  for (const id of ids) limpio[id] = hoy;
  escribirLS(LS_ESTRENOS_CERRADOS, limpio); pintarAvisos();
}
const LS_EXPORT = a => `mb_export_${a}`, LS_TOKEN_LUEGO = 'mb_token_luego', LS_AVISO_EXPORT = 'mb_aviso_export';
function exportarCSV() {
  const blob = new Blob([textoCSV()], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `mi-butaca-${hoyISO()}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  escribirLS(LS_EXPORT(new Date().getFullYear()), hoyISO());
  avisar('Copia descargada (ábrela con Excel)'); pintarAvisos();
}
$('#btnCSV').addEventListener('click', exportarCSV);
// El recordatorio anual está desactivado hasta que lo actives en Ajustes
$('#avisoExport').addEventListener('change', e => {
  escribirLS(LS_AVISO_EXPORT, e.target.checked); pintarAvisos();
  avisar(e.target.checked ? 'Te avisaré del 1 al 7 de enero' : 'Recordatorio anual desactivado');
});

/* ---------------- avisos: copia de principio de año y caducidad del token ---------------- */
function diasToken() {
  if (!cfg?.caduca) return null;
  const [y, m, d] = cfg.caduca.split('-').map(Number), hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
}
function pintarAvisos() {
  const el = $('#avisos'); if (!el) return;
  const h = [], hoy = new Date(), Y = hoy.getFullYear();
  if (cfg) {
    const dias = diasToken();
    if (tokenMalo || (dias != null && dias < 0)) {
      h.push(`<div class="aviso grave" data-aviso="token"><p>🔑 <b>Tu token de GitHub ha caducado o ya no es válido.</b> Lo que añadas se queda en el móvil y no se guarda en GitHub hasta que lo renueves.</p>
        <div class="acciones"><button class="prim" data-acc="ayuda">Cómo renovarlo</button></div></div>`);
    } else if (dias != null && dias <= 7 && leerLS(LS_TOKEN_LUEGO, '') !== hoyISO()) {
      const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
      h.push(`<div class="aviso" data-aviso="token"><p>🔑 Tu token de GitHub <b>caduca ${cuando}</b>. Renuévalo para que la app siga guardando en GitHub.</p>
        <div class="acciones"><button class="prim" data-acc="ayuda">Cómo renovarlo</button><button data-acc="luego">Más tarde</button></div></div>`);
    }
  }
  const est = estrenosDeHoy();
  if (est.length === 1) {
    const i = est[0], det = detalleEstreno(i);
    h.push(`<div class="aviso estreno" data-aviso="estreno"><button type="button" class="cerrar" data-cerrar="${esc(i.id)}" aria-label="Cerrar aviso">✕</button>
      <p class="tit">${ICONO_TIPO[i.tipo]} <b>Hoy: ${esc(textoEstreno(i))}</b>${det ? `<small>${esc(det)}</small>` : ''}</p>
      <div class="acciones"><button data-acc="cal">Ver en el calendario</button></div></div>`);
  } else if (est.length > 1) {
    h.push(`<div class="aviso estreno" data-aviso="estreno"><button type="button" class="cerrar" data-cerrar="*" aria-label="Cerrar todos">✕</button>
      <p class="tit">🗓️ <b>Hoy hay ${est.length} estrenos de tu lista</b></p>
      <ul class="estrenos">${est.map(i => { const det = detalleEstreno(i); return `<li><span>${ICONO_TIPO[i.tipo]} ${esc(textoEstreno(i))}${det ? `<small>${esc(det)}</small>` : ''}</span>
        <button type="button" class="cerrar-uno" data-cerrar="${esc(i.id)}" aria-label="Cerrar este aviso">✕</button></li>`; }).join('')}</ul>
      <div class="acciones"><button data-acc="cal">Ver en el calendario</button></div></div>`);
  }
  if (leerLS(LS_AVISO_EXPORT, false) && hoy.getMonth() === 0 && hoy.getDate() <= 7 && visibles().length && !leerLS(LS_EXPORT(Y), '')) {
    h.push(`<div class="aviso info" data-aviso="export"><p>📦 <b>¡Feliz ${Y}!</b> Es buen momento para descargar una copia de tu historial en Excel y guardarla.</p>
      <div class="acciones"><button class="prim" data-acc="csv">Descargar Excel</button><button data-acc="hecho">Ya la tengo</button></div></div>`);
  }
  el.innerHTML = h.join('');
}
$('#avisos').addEventListener('click', e => {
  const cerrar = e.target.closest('[data-cerrar]')?.dataset.cerrar;
  if (cerrar) { cerrarEstrenos(cerrar === '*' ? estrenosDeHoy().map(i => i.id) : [cerrar]); return; }
  const acc = e.target.closest('[data-acc]')?.dataset.acc; if (!acc) return;
  if (acc === 'ayuda') $('#ayudaToken').showModal();
  if (acc === 'cal') abrirCalendario();
  if (acc === 'luego') { escribirLS(LS_TOKEN_LUEGO, hoyISO()); pintarAvisos(); }
  if (acc === 'csv') exportarCSV();
  if (acc === 'hecho') { escribirLS(LS_EXPORT(new Date().getFullYear()), hoyISO()); pintarAvisos(); }
});
$('#ayudaCerrar').addEventListener('click', () => $('#ayudaToken').close());
$('#ayudaPegar').addEventListener('click', () => {
  $('#ayudaToken').close(); $('#btnSync').click();
  fa.token.value = ''; fa.caduca.value = ''; fa.token.focus();
});

/* ---------------- calendario de estrenos ---------------- */
let calMes = null, calDia = null;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function abrirCalendario() {
  const h = new Date(); calMes = new Date(h.getFullYear(), h.getMonth(), 1); calDia = null;
  pintarCalendario(); $('#calendario').showModal(); $('#calendario .res-scroll').scrollTop = 0;
}
function filaCal(i, texto) {
  return `<li><button class="item" data-id="${esc(i.id)}">${marcaDe(i)}<span class="cuerpo">
    <span class="t"><em>${esc(i.titulo)}</em>${i.ganas ? '<span class="ganas">⭐</span>' : ''}</span>
    <span class="m">${metaPend(i).map(esc).join(' · ') || NOMBRE_TIPO[i.tipo]}</span></span><span class="d">${texto}</span></button></li>`;
}
function pintarCalendario() {
  const conFecha = pendientes().filter(i => i.estreno), hoy = hoyISO();
  const y = calMes.getFullYear(), m = calMes.getMonth(), prefijo = iso(calMes).slice(0, 7);
  const mesTxt = calMes.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  $('#calMes').textContent = mesTxt.charAt(0).toUpperCase() + mesTxt.slice(1);
  const porDia = new Map();
  for (const i of conFecha) if (i.estreno.startsWith(prefijo)) { const d = i.estreno; if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(i); }
  const hueco = (new Date(y, m, 1).getDay() + 6) % 7, nDias = new Date(y, m + 1, 0).getDate();
  let g = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<span class="sem">${d}</span>`).join('') + '<span class="cal-dia vacio"></span>'.repeat(hueco);
  for (let d = 1; d <= nDias; d++) {
    const f = iso(new Date(y, m, d)), l = porDia.get(f) || [];
    const cls = ['cal-dia', f === hoy ? 'hoy' : '', f < hoy ? 'pasado' : '', f === calDia ? 'sel' : ''].filter(Boolean).join(' ');
    const etiqueta = `${d}${l.length ? ` · ${l.length} ${l.length === 1 ? 'estreno' : 'estrenos'}` : ''}`;
    g += `<button type="button" class="${cls}" data-dia="${f}" aria-label="${etiqueta}"${l.length ? '' : ' tabindex="-1"'}>${d}<span class="puntos">${l.slice(0, 3).map(i => `<i class="${i.tipo}"></i>`).join('')}</span></button>`;
  }
  $('#calGrid').innerHTML = g;

  let h = '';
  if (!conFecha.length) {
    h = `<div class="cal-vacio"><b>Aún no hay estrenos apuntados</b>Al añadir algo pendiente, pon su fecha de estreno o publicación y aparecerá aquí.
      <br><button type="button" class="principal" id="calApuntar">Apuntar un estreno</button></div>`;
  } else {
    const esteMes = prefijo === hoy.slice(0, 7);
    // Lo de este mes ya sale en su lista (como «Disponible»): aquí solo lo estrenado antes y aún pendiente
    const disponibles = conFecha.filter(i => i.estreno < `${prefijo}-01`).sort((a, b) => b.estreno.localeCompare(a.estreno));
    if (esteMes && disponibles.length && !calDia) h += `<p class="cal-sec">Ya disponibles</p><ul class="lista">${disponibles.map(i => filaCal(i, fechaCorta(i.estreno))).join('')}</ul>`;
    const delMes = conFecha.filter(i => calDia ? i.estreno === calDia : i.estreno.startsWith(prefijo)).sort((a, b) => a.estreno.localeCompare(b.estreno));
    const titulo = calDia ? new Date(calDia + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
      : `Estrenos de ${calMes.toLocaleDateString('es-ES', { month: 'long' })}`;
    if (delMes.length) {
      h += `<p class="cal-sec">${esc(titulo)}</p><ul class="lista">${delMes.map(i => filaCal(i, i.estreno <= hoy ? 'Disponible' : fechaCorta(i.estreno))).join('')}</ul>`;
    } else {
      const sig = conFecha.filter(i => i.estreno > iso(new Date(y, m + 1, 0))).sort((a, b) => a.estreno.localeCompare(b.estreno))[0];
      h += `<div class="cal-vacio"><b>${calDia ? 'Nada ese día' : 'Nada este mes'}</b>${sig ? `Próximo: «${esc(sig.titulo)}», ${fechaCorta(sig.estreno)}.<br><button type="button" class="chip" data-ir="${sig.estreno.slice(0, 7)}">Ir a ese mes</button>` : ''}</div>`;
    }
  }
  $('#calLista').innerHTML = h;
}
$('#btnCalendario').addEventListener('click', abrirCalendario);
$('#calCerrar').addEventListener('click', () => $('#calendario').close());
$('#calPrev').addEventListener('click', () => { calMes = new Date(calMes.getFullYear(), calMes.getMonth() - 1, 1); calDia = null; pintarCalendario(); });
$('#calNext').addEventListener('click', () => { calMes = new Date(calMes.getFullYear(), calMes.getMonth() + 1, 1); calDia = null; pintarCalendario(); });
$('#calHoy').addEventListener('click', () => { const h = new Date(); calMes = new Date(h.getFullYear(), h.getMonth(), 1); calDia = null; pintarCalendario(); });
$('#calendario').addEventListener('click', e => {
  const dia = e.target.closest('[data-dia]');
  if (dia) { calDia = calDia === dia.dataset.dia ? null : dia.dataset.dia; pintarCalendario(); return; }
  const ir = e.target.closest('[data-ir]');
  if (ir) { const [a, mm] = ir.dataset.ir.split('-').map(Number); calMes = new Date(a, mm - 1, 1); calDia = null; pintarCalendario(); return; }
  if (e.target.closest('#calApuntar')) { $('#calendario').close(); if (editandoId) salirEdicion(); irA('anadir'); ponerModo('pendiente'); form.titulo.focus(); return; }
  if (e.target.closest('.item')) $('#calendario').close(); // el editor se abre con el clic general de .item
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

/* «↻ Recalcular»: trae lo último de GitHub, sube lo pendiente y recalcula todos los totales. */
async function recalcular() {
  const botones = $$('[data-recalc]');
  botones.forEach(b => { b.disabled = true; if (b.classList.contains('icono')) b.classList.add('girando'); else b.textContent = '↻ Recalculando…'; });
  items.forEach(normalizar); guardarLocal();
  const enLinea = cfg && navigator.onLine;
  if (enLinea) await sincronizar();
  pintarTodo();
  botones.forEach(b => { b.disabled = false; b.classList.remove('girando'); if (!b.classList.contains('icono')) b.textContent = '↻ Recalcular'; });
  avisar(!cfg ? 'Totales recalculados' : !navigator.onLine ? 'Sin conexión: recalculado con los datos del móvil'
    : ultimoError ? 'No se pudo sincronizar: recalculado con los datos del móvil' : 'Datos al día y totales recalculados');
}
$$('[data-recalc]').forEach(b => b.addEventListener('click', recalcular));

items.forEach(normalizar);
ponerTipo('pelicula'); ponerModo('hecho'); limpiarForm(); pintarTodo(); sincronizar();
