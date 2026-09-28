import { createApi, ApiError, ConflictError, type DuplicateOpts } from './api';
import { createSaver } from './sync';
import { initialFilters, withEstado, catName, ESTADO_LONG, visibleRows, type AppState, type Filters, type SyncStatus, newRow } from './state';
import { seleccionVacia, alternar, rango, podar, resumen, aplicarEstado, aplicarPatch, eliminar, restaurar, etiquetaMasiva, filas } from './selection';
import { currentYm, todayISO, ymLabel, fmtCOP, fmtFecha } from './format';
import { trackVisualViewport } from './dom';
import { createHistory } from './history';
import { renderHeader, renderSync, renderUndo } from './render/header';
import { renderKpis } from './render/kpis';
import { renderToolbar, renderChips, syncToolbar } from './render/toolbar';
import { renderGrid, openMontoEditor, cycleEstado } from './render/grid';
import { renderCards } from './render/cards';
import { renderSelBar } from './render/selbar';
import { openDrawer, closeDrawer, isDrawerOpen } from './render/drawer';
import { openRowSheet } from './render/sheet';
import { toast as showToast } from './render/toast';
import { openDuplicateModal, openDeleteMonthModal, openCategoriasModal, openBolsillosModal, openAvisosModal } from './render/modals';
import { openReciboModal } from './render/recibo';
import { tomarCompartida, limpiarCompartida } from './recibos-browser';
import { duplicateRow } from './state';
import type { Bolsillo, BolsillosDoc, Categoria, CategoriasDoc, Estado, Row } from '../shared/types';
import { claveGasto, type GastoEstado } from '../shared/avisos';

export interface Actions {
  switchMonth(ym: string): Promise<void>;
  setIngresos(n: number): void;
  setFilters(patch: Partial<Filters>): void;
  addRow(): void;
  updateRow(id: string, patch: Partial<Row>): void;
  replaceRow(id: string, row: Row): void;
  insertRowAfter(id: string, row: Row): void;
  removeRow(id: string): void;
  restoreRow(index: number, row: Row): void;
  toggleSelectMode(on?: boolean): void;
  toggleSelect(id: string, modo?: 'uno' | 'rango'): void;
  selectAllVisible(): void;
  clearSelection(): void;
  bulkEstado(estado: Estado): void;
  bulkPatch(patch: { categoriaId?: string | null; bolsillo?: string; fecha?: string | null }, etiqueta: string): void;
  bulkDelete(): void;
  copySelectionTotal(): void;
  abrirRecibo(archivo?: Blob): void;
  crearDesdeRecibo(ym: string, row: Row, alias: { comercio: string; concepto: string; categoriaId: string | null; bolsillo: string }): Promise<void>;
  pagarDesdeRecibo(ym: string, rowId: string, fechaPago: string, ref: string, alias: { comercio: string; concepto: string; categoriaId: string | null; bolsillo: string }): Promise<void>;
  openDuplicate(): void;
  openDeleteMonth(): void;
  openCategorias(): void;
  openBolsillos(): void;
  openAvisos(): void;
  avisoGasto(id: string): Promise<GastoEstado | null>;
  silenciarAviso(id: string, valor: boolean): Promise<void>;
  quitarAplazamiento(id: string): Promise<void>;
  toggleTheme(): void;
  markAllPaid(): void;
  undo(id?: number): Promise<void>;
  redo(): Promise<void>;
  duplicateMonth(from: string, opts: DuplicateOpts): Promise<void>;
  createEmptyMonth(ym: string): Promise<void>;
  deleteMonth(ym: string): Promise<void>;
  saveCategorias(items: Categoria[]): Promise<void>;
  saveBolsillos(items: Bolsillo[], renames: { from: string; to: string }[]): Promise<void>;
  exportData(format: 'json' | 'csv'): void;
  openDrawer(id: string): void;
  openRowActions(id: string): void;
  renderAll(): void;
  renderRows(): void;
  renderKpis(): void;
  renderToolbarAndRows(): void;
  toast(msg: string, actionLabel?: string, actionFn?: () => void, ms?: number): void;
}

export const api = createApi();
export const state: AppState = {
  email: '', months: [], ym: null, doc: null, recent: [], categorias: { version: 0, items: [] },
  bolsillos: { version: 0, items: [] },
  filters: initialFilters(), focusId: null, sync: 'guardado', syncDetail: '', redoCount: 0, offline: false,
  history: [], sel: seleccionVacia(),
};

const hist = createHistory(10);
const HIST_KEY = 'historial';
function persistHistory() { try { localStorage.setItem(HIST_KEY, hist.serialize()); } catch { /* sin almacenamiento */ } }
function syncHistory() { state.history = hist.list(); state.redoCount = hist.redoSize(); renderUndo(state); persistHistory(); }
function record(label: string) {
  if (!state.doc) return;
  hist.record(state.doc.month, label, { ingresos: state.doc.ingresos, rows: state.doc.rows });
  syncHistory();
}
const rowLabel = (r: Row) => (r.concepto.length > 28 ? r.concepto.slice(0, 27) + '…' : r.concepto);

const saver = createSaver({
  save: (doc) => api.putMonth(doc),
  onSaved: (saved) => { if (state.doc && state.doc.month === saved.month) { state.doc.version = saved.version; state.doc.updatedAt = saved.updatedAt; } },
  onConflict: (current) => { if (current && state.doc?.month === current.month) { state.doc = current; hist.clear(); syncHistory(); actions.renderAll(); actions.toast('Este mes cambió en otro dispositivo; se recargó'); } },
  onStatus: (s: SyncStatus, detail = '') => { state.sync = s; state.syncDetail = detail; renderSync(state); },
});

function save() { if (state.doc) saver.schedule(state.doc); }

const visiblesIds = () => (state.doc ? visibleRows(state.doc, state.filters, state.categorias).map((r) => r.id) : []);
function setSelMode(on: boolean) {
  state.sel = on ? { ...state.sel, on: true } : seleccionVacia();
  document.body.classList.toggle('selmode', on);
  syncToolbar(state);
  actions.renderRows();
}

export const actions: Actions = {
  async switchMonth(ym) {
    await saver.flush();
    document.getElementById('toast')!.hidden = true;
    if (!ym) return;
    if (state.sel.on) { state.sel = seleccionVacia(); document.body.classList.remove('selmode'); }
    state.ym = ym; state.filters = initialFilters(); state.focusId = null;
    try { state.doc = await api.month(ym); saver.setKnownVersion(state.doc.version, state.doc.month); } catch (e) {
      state.doc = null;
      if (e instanceof ApiError && e.code === 'schema') {
        actions.toast(`El documento de ${ymLabel(ym)} está dañado.`, 'Descargar JSON crudo', () => window.open(`/api/months/${ym}/raw`, '_blank'), 15000);
      } else actions.toast(`No se pudo cargar ${ymLabel(ym)}: ${(e as Error).message}`);
    }
    if (state.doc && !state.recent.some((d) => d.month === ym)) state.recent = [state.doc, ...state.recent].slice(0, 4);
    if (state.doc) history.replaceState(null, '', `#${ym}`);
    actions.renderAll();
  },
  setIngresos(n) { if (!state.doc) return; record(`Ingresos: ${fmtCOP(state.doc.ingresos)} → ${fmtCOP(n)}`); state.doc.ingresos = n; save(); actions.renderKpis(); },
  setFilters(patch) { Object.assign(state.filters, patch); syncToolbar(state); actions.renderRows(); },
  addRow() {
    if (!state.doc) return;
    record('Nueva fila');
    const r = newRow(); state.doc.rows.unshift(r); state.filters = { ...initialFilters(), group: state.filters.group };
    save(); actions.renderToolbarAndRows(); actions.openDrawer(r.id);
  },
  updateRow(id, patch) {
    const r = state.doc?.rows.find((x) => x.id === id); if (!r) return;
    if ('fecha' in patch) record(`Fecha: ${rowLabel(r)} → ${fmtFecha(patch.fecha ?? null)}`);
    else if ('monto' in patch) record(`Monto: ${rowLabel(r)} ${fmtCOP(r.monto)} → ${fmtCOP(patch.monto ?? null)}`);
    else if ('recurrente' in patch) record(`Recurrente: ${rowLabel(r)} → ${patch.recurrente ? 'sí' : 'no'}`);
    else record(`Editar: ${rowLabel(r)}`);
    Object.assign(r, patch); save(); actions.renderKpis(); actions.renderRows();
  },
  replaceRow(id, row) {
    const i = state.doc?.rows.findIndex((x) => x.id === id) ?? -1; if (i < 0 || !state.doc) return;
    const prev = state.doc.rows[i];
    if (JSON.stringify(prev) === JSON.stringify(row)) return;
    record(prev.estado !== row.estado ? `Estado: ${rowLabel(prev)} → ${ESTADO_LONG[row.estado]}` : `Editar: ${rowLabel(prev)}`);
    state.doc.rows[i] = row; save(); actions.renderKpis(); actions.renderRows();
  },
  insertRowAfter(id, row) {
    const i = state.doc?.rows.findIndex((x) => x.id === id) ?? -1; if (!state.doc) return;
    record(`Duplicar fila: ${rowLabel(row)}`);
    state.doc.rows.splice(i + 1, 0, row); state.focusId = row.id; save(); actions.renderKpis(); actions.renderRows();
  },
  removeRow(id) {
    const i = state.doc?.rows.findIndex((x) => x.id === id) ?? -1; if (i < 0 || !state.doc) return;
    const ym = state.doc.month;
    const before = state.doc.rows[i];
    record(`Eliminar: ${rowLabel(before)}`);
    const [r] = state.doc.rows.splice(i, 1); state.focusId = null; save(); actions.renderKpis(); actions.renderRows();
    actions.toast(`Eliminada: ${r.concepto}`, 'Deshacer', () => { if (state.doc?.month !== ym) return; actions.restoreRow(i, r); });
  },
  restoreRow(index, row) {
    if (!state.doc) return;
    record(`Restaurar: ${rowLabel(row)}`);
    state.doc.rows.splice(index, 0, row); save(); actions.renderKpis(); actions.renderRows();
  },
  toggleSelectMode(on) { setSelMode(on ?? !state.sel.on); },
  toggleSelect(id, modo = 'uno') {
    if (!state.doc) return;
    if (!state.sel.on) { state.sel = { on: true, ids: new Set(), anchor: null }; document.body.classList.add('selmode'); syncToolbar(state); }
    const ids = modo === 'rango' ? rango(visiblesIds(), state.sel.anchor, id, state.sel.ids) : alternar(state.sel.ids, id);
    state.sel = { on: true, ids, anchor: id }; state.focusId = id;
    actions.renderRows();
  },
  selectAllVisible() { if (!state.doc) return; state.sel = { on: true, ids: new Set(visiblesIds()), anchor: state.sel.anchor }; document.body.classList.add('selmode'); syncToolbar(state); actions.renderRows(); },
  clearSelection() { setSelMode(false); },
  bulkEstado(estado) {
    if (!state.doc || state.sel.ids.size === 0) return;
    const n = state.sel.ids.size;
    const antes = state.doc.rows;
    const next = aplicarEstado(antes, state.sel.ids, estado, todayISO());
    const cambio = next.some((r, i) => state.sel.ids.has(r.id) && (r.estado !== antes[i].estado || r.fechaPago !== antes[i].fechaPago));
    if (cambio) { record(etiquetaMasiva('Estado', n, ESTADO_LONG[estado])); state.doc.rows = next; save(); actions.renderKpis(); }
    actions.renderRows(); showToast(`${filas(n)} → ${ESTADO_LONG[estado]}`);
  },
  bulkPatch(patch, etiqueta) {
    if (!state.doc || state.sel.ids.size === 0) return;
    record(etiqueta);
    state.doc.rows = aplicarPatch(state.doc.rows, state.sel.ids, patch);
    save(); actions.renderKpis(); actions.renderRows(); showToast(etiqueta);
  },
  bulkDelete() {
    if (!state.doc || state.sel.ids.size === 0) return;
    const ym = state.doc.month; const n = state.sel.ids.size;
    record(`Eliminar ${filas(n)}`);
    const { rows, quitadas } = eliminar(state.doc.rows, state.sel.ids);
    state.doc.rows = rows; state.focusId = null;
    setSelMode(false); save(); actions.renderKpis(); actions.renderRows();
    showToast(n === 1 ? 'Eliminada 1 fila' : `Eliminadas ${n} filas`, 'Deshacer', () => {
      if (!state.doc || state.doc.month !== ym) return;
      record(`Restaurar ${filas(n)}`);
      state.doc.rows = restaurar(state.doc.rows, quitadas); save(); actions.renderKpis(); actions.renderRows();
    });
  },
  abrirRecibo(archivo) { openReciboModal(state, actions, api, archivo); },
  async crearDesdeRecibo(ym, row, alias) {
    if (state.ym !== ym) await actions.switchMonth(ym);
    if (!state.doc || state.doc.month !== ym) { showToast('No se pudo abrir el mes destino'); return; }
    record(`Recibo: Nuevo · ${row.concepto}`);
    state.doc.rows.unshift(row); state.focusId = row.id;
    state.filters = { ...initialFilters(), group: state.filters.group }; // que la fila nueva sea visible, como en addRow
    save(); actions.renderKpis(); actions.renderToolbarAndRows();
    showToast(`Creado: ${row.concepto}`);
    if (alias.comercio.trim()) void api.putReciboAlias(alias).catch(() => undefined);
  },
  async pagarDesdeRecibo(ym, rowId, fechaPago, ref, alias) {
    if (state.ym !== ym) await actions.switchMonth(ym);
    const r = state.doc?.rows.find((x) => x.id === rowId);
    if (!state.doc || !r) { showToast('El gasto ya no está en este mes'); return; }
    record(`Recibo: Pagado · ${r.concepto}`);
    const pagado: Row = { ...withEstado(r, 'pagado', fechaPago), ref: ref || r.ref, bolsillo: r.bolsillo || alias.bolsillo };
    state.doc.rows = state.doc.rows.map((x) => (x.id === rowId ? pagado : x)); state.focusId = rowId; save(); actions.renderKpis(); actions.renderRows();
    showToast(`Pagado: ${r.concepto}`);
    if (alias.comercio.trim()) void api.putReciboAlias({ ...alias, concepto: r.concepto, categoriaId: r.categoriaId, bolsillo: pagado.bolsillo }).catch(() => undefined);
  },
  copySelectionTotal() {
    if (!state.doc) return;
    const r = resumen(state.doc.rows, state.sel.ids);
    void navigator.clipboard?.writeText(fmtCOP(r.total)).catch(() => undefined);
    showToast(`Total copiado: ${fmtCOP(r.total)}`);
  },
  openDuplicate() { openDuplicateModal(state, actions); },
  openDeleteMonth() { openDeleteMonthModal(state, actions); },
  openCategorias() { openCategoriasModal(state, actions); },
  openBolsillos() { openBolsillosModal(state, actions); },
  openAvisos() { openAvisosModal(state, actions, api); },
  async avisoGasto(id) {
    if (!state.ym) return null;
    try { return (await api.avisosEstado()).gastos[claveGasto(state.ym, id)] ?? null; } catch { return null; }
  },
  async silenciarAviso(id, valor) { if (!state.ym) return; await saver.flush(); await api.accionAviso({ accion: 'silenciar', ym: state.ym, rowId: id, valor }); },
  async quitarAplazamiento(id) { if (!state.ym) return; await saver.flush(); await api.accionAviso({ accion: 'aplazar', ym: state.ym, rowId: id, horas: 0 }); },
  toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('tema', next); } catch { /* sin almacenamiento */ }
    renderHeader(state, actions);
  },
  async duplicateMonth(from, opts) {
    await saver.flush();
    try {
      const doc = await api.duplicate(from, opts);
      if (!state.months.includes(doc.month)) state.months = [...state.months, doc.month].sort();
      state.recent = state.recent.filter((d) => d.month !== doc.month);
      await actions.switchMonth(doc.month);
      if (state.doc?.month === doc.month) showToast(`${ymLabel(doc.month)} creado con ${doc.rows.length} filas a partir de ${ymLabel(from)}`);
    } catch (e) { showToast(`No se pudo duplicar: ${(e as Error).message}`); }
  },
  async createEmptyMonth(ym) {
    await saver.flush();
    try {
      const doc = await api.putMonth({ version: 0, month: ym, ingresos: 0, updatedAt: '', rows: [] });
      state.months = [...new Set([...state.months, doc.month])].sort();
      await actions.switchMonth(doc.month);
    } catch (e) { showToast(`No se pudo crear: ${(e as Error).message}`); }
  },
  async deleteMonth(ym) {
    await saver.flush();
    try {
      await api.deleteMonth(ym);
      state.months = state.months.filter((m) => m !== ym); state.recent = state.recent.filter((d) => d.month !== ym);
      state.ym = null; state.doc = null;
      const next = state.months.at(-1); if (next) await actions.switchMonth(next); else actions.renderAll();
      showToast(`${ymLabel(ym)} eliminado`);
    } catch (e) { showToast(`No se pudo eliminar: ${(e as Error).message}`); }
  },
  async saveCategorias(items) {
    try {
      state.categorias = await api.putCategorias({ version: state.categorias.version, items });
      actions.renderAll(); showToast('Categorías guardadas');
    } catch (e) {
      if (e instanceof ConflictError && e.code === 'in_use') {
        const body = e.body as { categoriaId: string; months: string[] };
        showToast(`No se puede borrar "${catName(state.categorias, body.categoriaId)}": la usan ${body.months.map(ymLabel).join(', ')}`, undefined, undefined, 8000);
      } else if (e instanceof ConflictError) {
        state.categorias = (e.current as CategoriasDoc) ?? state.categorias; actions.renderAll();
        showToast('Las categorías cambiaron en otro dispositivo; se recargaron. Vuelve a intentar.');
      } else showToast(`No se pudo guardar: ${(e as Error).message}`);
    }
  },
  async saveBolsillos(items, renames) {
    await saver.flush();
    try {
      let version = state.bolsillos.version;
      for (const r of renames) { const res = await api.renameBolsillo(r.from, r.to, version); version = res.bolsillos.version; }
      // tras renombrar, la lista del servidor ya trae los nombres nuevos; se envía la lista final con la versión más reciente
      state.bolsillos = await api.putBolsillos({ version, items });
      state.recent = [];
      if (state.ym) await actions.switchMonth(state.ym); else actions.renderAll();
      hist.clear(); syncHistory(); // las instantáneas guardan nombres previos al renombrar
      showToast('Bolsillos guardados');
    } catch (e) {
      try { state.bolsillos = await api.bolsillos(); } catch { /* keep */ }
      if (e instanceof ConflictError && e.code === 'in_use') {
        const body = e.body as { bolsillo: string; months: string[] };
        const msg = `No se puede borrar "${body.bolsillo}": lo usan ${body.months.map(ymLabel).join(', ')}`;
        showToast(renames.length > 0 ? `${msg}. Los renombrados sí se aplicaron.` : msg, undefined, undefined, 8000);
      } else if (e instanceof ConflictError) {
        state.bolsillos = (e.current as BolsillosDoc) ?? state.bolsillos; actions.renderAll();
        showToast('Los bolsillos cambiaron en otro dispositivo; se recargaron. Vuelve a intentar.');
      } else showToast(`No se pudo guardar: ${(e as Error).message}`);
      if (state.ym) await actions.switchMonth(state.ym); // los renombrados ya aplicados deben verse
    }
  },
  markAllPaid() {
    if (!state.doc) return;
    const ym = state.doc.month;
    const prev = state.doc.rows.map((r) => ({ ...r }));
    record('Marcar todo como pagado');
    const today = todayISO();
    state.doc.rows = state.doc.rows.map((r) => (r.estado === 'pagado' ? r : withEstado(r, 'pagado', today)));
    save(); actions.renderKpis(); actions.renderRows();
    showToast('Todas las filas marcadas como pagadas', 'Deshacer', () => { if (state.doc?.month !== ym) return; record('Restaurar: marcar todo'); state.doc.rows = prev.map((r) => ({ ...r })); save(); actions.renderKpis(); actions.renderRows(); });
  },
  async undo(id) {
    const target = id === undefined ? state.history[0] : state.history.find((e) => e.id === id);
    if (!target) return;
    if (state.ym !== target.ym) await actions.switchMonth(target.ym);
    if (!state.doc || state.doc.month !== target.ym) { showToast('No se pudo deshacer: el mes ya no está disponible'); return; }
    const t = hist.take(target.id, { ingresos: state.doc.ingresos, rows: state.doc.rows });
    if (!t) { syncHistory(); return; }
    state.doc.ingresos = t.entry.before.ingresos;
    state.doc.rows = t.entry.before.rows.map((r) => ({ ...r }));
    save(); actions.renderKpis(); actions.renderRows(); syncHistory();
    showToast(`Deshecho: ${t.entry.label}`);
  },
  async redo() {
    const next = hist.redoList()[0];
    if (!next) return;
    if (state.ym !== next.ym) await actions.switchMonth(next.ym);
    if (!state.doc || state.doc.month !== next.ym) { showToast('No se pudo rehacer: el mes ya no está disponible'); return; }
    const r = hist.takeRedo();
    if (!r) { syncHistory(); return; }
    state.doc.ingresos = r.after.ingresos;
    state.doc.rows = r.after.rows.map((x) => ({ ...x }));
    save(); actions.renderKpis(); actions.renderRows(); syncHistory();
    showToast(`Rehecho: ${r.label}`);
  },
  exportData(format) { window.open(api.exportUrl(format), '_blank'); },
  openDrawer(id) { openDrawer(state, actions, id); },
  openRowActions(id) { openRowSheet(state, actions, id); },
  renderAll() { renderHeader(state, actions); actions.renderKpis(); actions.renderToolbarAndRows(); },
  renderKpis() { renderKpis(state, actions); },
  renderRows() {
    if (state.sel.on && state.doc) { const p = podar(state.sel.ids, visiblesIds()); if (p.size !== state.sel.ids.size) state.sel = { ...state.sel, ids: p }; }
    renderChips(state, actions); renderGrid(state, actions); renderCards(state, actions); renderSelBar(state, actions);
  },
  renderToolbarAndRows() { renderToolbar(state, actions); actions.renderRows(); },
  toast: showToast,
};

window.addEventListener('beforeunload', (e) => { if (saver.hasPending()) { e.preventDefault(); e.returnValue = ''; } });

function setOffline(off: boolean) {
  state.offline = off;
  renderSync(state);
}
window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', () => setOffline(false));

function warmCache() {
  if (!navigator.onLine) return Promise.resolve();
  const urls = ['/api/me', '/api/months', '/api/categorias', '/api/bolsillos', ...(state.ym ? [`/api/months/${state.ym}`] : [])];
  // Se lee el cuerpo para que la petición termine (si no, el SW deja el stream abierto y la red nunca queda ociosa).
  return Promise.all(urls.map((u) => fetch(u, { credentials: 'same-origin' }).then((r) => r.arrayBuffer()).catch(() => undefined))).then(() => undefined);
}

window.addEventListener('hashchange', () => {
  const ym = location.hash.slice(1);
  if (ym && ym !== state.ym && state.months.includes(ym)) void actions.switchMonth(ym);
});

/** Al volver a la app (p. ej. tras tocar "Pagado" en una notificación), recarga el mes si cambió en el servidor. */
async function refrescarSiCambio() {
  if (!state.ym || !state.doc || saver.hasPending() || !navigator.onLine || isDrawerOpen()) return;
  const antes = state.doc;
  try {
    const fresh = await api.month(state.ym);
    // Si mientras se pedía el mes el usuario editó (nuevo doc/guardado pendiente) o cambió de mes, no pisar nada.
    if (saver.hasPending() || state.doc !== antes || state.ym !== fresh.month) return;
    if (fresh.version > state.doc.version) {
      state.doc = fresh; saver.setKnownVersion(fresh.version, fresh.month);
      hist.clear(); syncHistory(); actions.renderAll();
      showToast('Este mes cambió; se recargó');
    }
  } catch { /* sin red o sesión vencida: el siguiente guardado lo resuelve */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refrescarSiCambio(); });
window.addEventListener('pageshow', () => void refrescarSiCambio());

async function boot() {
  try { if (hist.hydrate(localStorage.getItem(HIST_KEY))) { state.history = hist.list(); state.redoCount = hist.redoSize(); } } catch { /* sin almacenamiento */ }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin SW */ });
    // En la primera visita el SW aún no controla la página cuando se leen los datos: al tomar el control, se vuelven a pedir para que queden en caché.
    navigator.serviceWorker.addEventListener('controllerchange', () => { void warmCache(); }, { once: true });
  }
  setOffline(!navigator.onLine);
  try { const t = localStorage.getItem('tema'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch { /* sin almacenamiento */ }
  trackVisualViewport();
  try {
    const [me, months, categorias, bolsillos] = await Promise.all([api.me(), api.months(), api.categorias(), api.bolsillos()]);
    state.email = me.email; state.months = months; state.categorias = categorias; state.bolsillos = bolsillos;
    const compartir = location.hash === '#compartir';
    const wanted = (compartir ? '' : location.hash.slice(1)) || currentYm();
    const ym = months.includes(wanted) ? wanted : months.at(-1) ?? null;
    if (ym) await actions.switchMonth(ym);
    else { actions.renderAll(); openDuplicateModal(state, actions); }
    // Llegada por "Compartir" (Web Share Target): el SW dejó la imagen en caché y redirigió a #compartir.
    if (compartir) {
      if (state.ym) history.replaceState(null, '', `#${state.ym}`);
      const blob = await tomarCompartida().catch(() => null);
      if (blob) actions.abrirRecibo(blob); else showToast('No llegó ninguna imagen compartida');
    } else void limpiarCompartida(); // una imagen pendiente sin consumir ya no sirve
  } catch (e) {
    document.body.innerHTML = `<p style="padding:24px">No se pudo iniciar: ${(e as Error).message}</p>`;
  }
}
void boot();

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
  if (e.key === 'Escape') {
    if (state.sel.on && !isDrawerOpen() && document.getElementById('modalRoot')!.hidden) { actions.clearSelection(); return; }
    if (isDrawerOpen()) closeDrawer(state, actions);
    else if (!document.getElementById('modalRoot')!.hidden) { const m = document.getElementById('modalRoot')!; m.hidden = true; m.innerHTML = ''; }
    else if (inField) target.blur();
    return;
  }
  if (isDrawerOpen() || !document.getElementById('modalRoot')!.hidden) return;
  if (e.key === '/' && !inField) { e.preventDefault(); const q = document.getElementById('q') as HTMLInputElement; q.focus(); q.select(); return; }
  if ((e.ctrlKey || e.metaKey) && !inField && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) { e.preventDefault(); void actions.redo(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); void actions.undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tr = target.closest?.('tr[data-id]') as HTMLTableRowElement | null;
  if (!tr || (inField && (target as HTMLInputElement).type !== 'checkbox')) return;
  const id = tr.dataset.id!;
  if (state.sel.on && (e.key === ' ' || e.key === 'Enter') && target === tr) { e.preventDefault(); actions.toggleSelect(id); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); let n: Element | null = tr;
    do { n = e.key === 'ArrowDown' ? n.nextElementSibling : n.previousElementSibling; } while (n && !(n as HTMLElement).dataset.id);
    if (n) { (n as HTMLElement).focus(); state.focusId = (n as HTMLElement).dataset.id!; }
  } else if (e.key === 'Enter' && target === tr && !state.sel.on) { e.preventDefault(); openMontoEditor(state, actions, tr); }
  else if (e.key === 'e' && target === tr && !state.sel.on) { actions.openDrawer(id); }
  else if (e.key === ' ' && target === tr && !state.sel.on) { e.preventDefault(); cycleEstado(state, actions, id); }
  else if (e.key === 'd' && target === tr && !state.sel.on) { const r = state.doc?.rows.find((x) => x.id === id); if (r) actions.insertRowAfter(id, duplicateRow(r)); }
});
