import { $, esc } from '../dom';
import { ymLabel, nextYm } from '../format';
import type { AppState } from '../state';
import type { Actions } from '../main';

const ICON_PREV = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const ICON_NEXT = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M4 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const ICON_MORE = '<svg width="16" height="16" viewBox="0 0 14 14"><circle cx="3" cy="7" r="1.4" fill="currentColor"/><circle cx="7" cy="7" r="1.4" fill="currentColor"/><circle cx="11" cy="7" r="1.4" fill="currentColor"/></svg>';
const SYNC_TEXT = { guardado: 'Guardado', guardando: 'Guardando…', 'sin-guardar': 'Sin guardar', conflicto: 'Conflicto' } as const;
/** Texto, color y tooltip del indicador: sin red manda sobre el estado de guardado. */
function syncView(s: AppState) {
  if (s.offline) {
    const pendientes = s.sync === 'guardando' || s.sync === 'sin-guardar';
    return { ds: 'sin-guardar', title: 'Sin conexión: los cambios se guardan al reconectar', text: `Sin conexión${pendientes ? ' · cambios pendientes' : ''}` };
  }
  return { ds: s.sync, title: s.syncDetail, text: SYNC_TEXT[s.sync] + (s.syncDetail ? ` · ${s.syncDetail}` : '') };
}

let docListenerInstalled = false;
function ensureDocListener() {
  if (docListenerInstalled) return;
  docListenerInstalled = true;
  document.addEventListener('click', () => {
    const menu = document.getElementById('menuList');
    const btn = document.getElementById('menuBtn');
    if (menu && btn && !menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    const histList = document.getElementById('histList');
    const histBtn = document.getElementById('histBtn');
    if (histList && !histList.hidden) { histList.hidden = true; histBtn?.setAttribute('aria-expanded', 'false'); }
  });
}

export function renderHeader(s: AppState, a: Actions) {
  const i = s.ym ? s.months.indexOf(s.ym) : -1;
  const isLast = i === s.months.length - 1;
  const initial = (s.email[0] ?? '?').toUpperCase();
  $('#header').innerHTML = `
    <div class="brand" title="Torre de control · ingresos / egresos"><span class="mono">TC</span><span class="wm">Torre de control</span></div>
    <div class="monthnav">
      <button class="ib" id="prevM" aria-label="Mes anterior" ${i <= 0 ? 'disabled' : ''}>${ICON_PREV}</button>
      <select class="monthsel" id="monthSel" aria-label="Mes">
        ${s.months.map((m) => `<option value="${m}" ${m === s.ym ? 'selected' : ''}>${esc(ymLabel(m))}</option>`).join('')}
        ${s.months.length === 0 ? '<option value="">Sin meses</option>' : ''}
      </select>
      <button class="ib" id="nextM" aria-label="${isLast && s.ym ? `Crear ${esc(ymLabel(nextYm(s.ym)))}` : 'Mes siguiente'}" title="${isLast && s.ym ? `Crear ${esc(ymLabel(nextYm(s.ym)))}` : 'Mes siguiente'}">${ICON_NEXT}</button>
      <div class="menu">
        <button class="ib" id="menuBtn" aria-haspopup="true" aria-expanded="false" aria-label="Acciones del mes">${ICON_MORE}</button>
        <div class="menu-list" id="menuList" hidden>
          <button data-m="dup">Duplicar mes…</button>
          <button data-m="markAll">Marcar todo como pagado</button>
          <button data-m="cats">Categorías…</button>
          <button data-m="bols">Bolsillos…</button>
          <button data-m="avisos">Avisos…</button>
          <button data-m="theme">${document.documentElement.dataset.theme === 'light' ? 'Tema oscuro' : 'Tema claro'}</button>
          <hr>
          <button data-m="exportJson">Exportar JSON</button>
          <button data-m="exportCsv">Exportar CSV</button>
          <hr>
          <button data-m="delete" ${s.ym ? '' : 'disabled'}>Eliminar este mes…</button>
        </div>
      </div>
    </div>
    <div class="undo" id="undo">
      <button class="ib" id="undoBtn" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">↶</button>
      <button class="ib" id="redoBtn" title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer">↷</button>
      <button class="ib hist" id="histBtn" aria-haspopup="true" aria-expanded="false" aria-label="Historial de cambios"><span id="histCount">0</span></button>
      <div class="menu-list hist-list" id="histList" hidden></div>
    </div>
    <div class="sync" id="sync" data-s="${syncView(s).ds}" title="${esc(syncView(s).title)}">${esc(syncView(s).text)}</div>
    <div class="user" title="Sesión por Cloudflare Access"><span class="av">${esc(initial)}</span><span>${esc(s.email.split('@')[0])}</span></div>`;

  $('#monthSel').onchange = (e) => a.switchMonth((e.target as HTMLSelectElement).value);
  $('#prevM').onclick = () => { if (i > 0) a.switchMonth(s.months[i - 1]); };
  $('#nextM').onclick = () => { if (!isLast) a.switchMonth(s.months[i + 1]); else a.openDuplicate(); };
  const menu = $('#menuList'), btn = $('#menuBtn');
  btn.onclick = (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  ensureDocListener();
  menu.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-m]'); if (!b) return;
    menu.hidden = true;
    ({ dup: a.openDuplicate, markAll: a.markAllPaid, cats: a.openCategorias, bols: a.openBolsillos, avisos: a.openAvisos, theme: a.toggleTheme, exportJson: () => a.exportData('json'), exportCsv: () => a.exportData('csv'), delete: a.openDeleteMonth } as Record<string, () => void>)[b.dataset.m!]?.();
  };
  $('#undoBtn').onclick = () => void a.undo();
  $('#redoBtn').onclick = () => void a.redo();
  const histBtn = $('#histBtn'), histList = $('#histList');
  histBtn.onclick = (e) => { e.stopPropagation(); const open = histList.hidden; histList.hidden = !open; histBtn.setAttribute('aria-expanded', String(open)); };
  histList.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-h]'); if (!b) return;
    histList.hidden = true; histBtn.setAttribute('aria-expanded', 'false');
    void a.undo(Number(b.dataset.h));
  };
  renderUndo(s);
}

export function renderUndo(s: AppState) {
  const btn = document.getElementById('undoBtn') as HTMLButtonElement | null;
  const count = document.getElementById('histCount'); const list = document.getElementById('histList');
  if (!btn || !count || !list) return;
  btn.disabled = s.history.length === 0; count.textContent = String(s.history.length);
  const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement | null; if (redoBtn) redoBtn.disabled = s.redoCount === 0;
  const fmt = (at: number) => new Date(at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  list.innerHTML = s.history.length === 0 ? '<div class="hist-empty">Sin cambios recientes</div>'
    : s.history.map((e) => `<button data-h="${e.id}"><span class="hist-label">${esc(e.label)}</span><small>${esc(fmt(e.at))}${e.ym !== s.ym ? ` · ${esc(ymLabel(e.ym))}` : ''}</small></button>`).join('');
}

export function renderSync(s: AppState) {
  const el = document.getElementById('sync'); if (!el) return;
  const v = syncView(s);
  el.dataset.s = v.ds; el.title = v.title; el.textContent = v.text;
}
