import { $, esc, isTouch } from '../dom';
import { fmtCOP, fmtFecha, parseMonto, todayISO } from '../format';
import { visibleRows, withEstado, nextEstado, duplicateRow, catName, catHue, ESTADOS, ESTADO_LABEL, ESTADO_LONG, type SortKey } from '../state';
import type { AppState } from '../state';
import type { Actions } from '../main';
import type { Row } from '../../shared/types';
import { attachLiveMoney } from '../money-input';
import { vencimiento } from '../../shared/dates';

export const ICON = {
  edit: '<svg width="15" height="15" viewBox="0 0 14 14"><path d="M2 12l.6-3L10 1.6l2.4 2.4L5 11.4 2 12z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  dup: '<svg width="15" height="15" viewBox="0 0 14 14"><rect x="4.5" y="4.5" width="8" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.5 4.5V2.7A1.2 1.2 0 008.3 1.5H2.7A1.2 1.2 0 001.5 2.7v5.6a1.2 1.2 0 001.2 1.2h1.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="10.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 1.5h4v2H5zM5 7h4M5 9.5h4" stroke="currentColor" stroke-width="1.3"/></svg>',
  del: '<svg width="15" height="15" viewBox="0 0 14 14"><path d="M2 3.5h10M5.5 3.5V2h3v1.5M3.5 3.5l.7 9h5.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  ext: '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M5 2H2v8h8V7M7 1h4v4M11 1L5.5 6.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  more: '<svg width="18" height="18" viewBox="0 0 14 14"><circle cx="3" cy="7" r="1.4" fill="currentColor"/><circle cx="7" cy="7" r="1.4" fill="currentColor"/><circle cx="11" cy="7" r="1.4" fill="currentColor"/></svg>',
};

const money = (n: number | null) => { if (n === null) return '<span class="muted">—</span>'; const s = fmtCOP(n); return `${s.startsWith('-') ? '−' : ''}<span class="cur">$</span>${esc(s.replace(/^-?\$/, ''))}`; };
export const tagHTML = (s: AppState, id: string | null) => (id === null ? '<span class="tag none">sin categoría</span>' : `<span class="tag" style="--h:${catHue(s.categorias, id)}">${esc(catName(s.categorias, id))}</span>`);
export const estadoHTML = (r: Row) => `<span class="estado" role="group" aria-label="Estado">${ESTADOS.map((e) => `<button data-e="${e}" data-id="${r.id}" aria-pressed="${r.estado === e}" title="${ESTADO_LONG[e]}">${ESTADO_LABEL[e]}</button>`).join('')}</span>`;
export const actionsHTML = (id: string) => `<span class="grp">
  <button class="ib2" data-a="edit" data-id="${id}" title="Editar">${ICON.edit}</button>
  <button class="ib2" data-a="dup" data-id="${id}" title="Duplicar fila">${ICON.dup}</button>
  <button class="ib2" data-a="copy" data-id="${id}" title="Copiar concepto, monto y ref">${ICON.copy}</button>
  <button class="ib2 del" data-a="del" data-id="${id}" title="Eliminar">${ICON.del}</button></span>
  <button class="ib2 more" data-a="more" data-id="${id}" aria-label="Acciones">${ICON.more}</button>`;
export function linkHTML(l: string) {
  if (!l) return '<span class="muted">—</span>';
  if (/^https?:\/\//i.test(l)) { let host = l; try { host = new URL(l).hostname.replace(/^www\./, ''); } catch { /* texto */ } return `<a href="${esc(l)}" target="_blank" rel="noopener">${ICON.ext}${esc(host)}</a>`; }
  return `<span title="${esc(l)}">${esc(l)}</span>`;
}
const sum = (rows: Row[]) => rows.reduce((t, r) => t + (r.monto ?? 0), 0);

const COLS: { k?: SortKey; label: string; cls?: string; title?: string }[] = [
  { k: 'concepto', label: 'Concepto' }, { k: 'monto', label: 'Monto', cls: 'r' }, { k: 'categoriaId', label: 'Categoría' },
  { k: 'estado', label: 'Estado', cls: 'c' }, { k: 'fecha', label: 'Fecha', cls: 'c', title: 'Fecha límite o plan de pago' }, { k: 'bolsillo', label: 'Bolsillo / medio' }, { label: 'Link de pago', cls: 'col-link' },
  { label: 'Ref. de pago', cls: 'col-ref' }, { label: 'Pagado el', cls: 'c col-fpago', title: 'Se llena al marcar Pagado' }, { label: 'Rec.', cls: 'c', title: 'Recurrente' }, { label: '' },
];

export function rowActionHandlers(s: AppState, a: Actions): Record<string, (id: string) => void> {
  return {
    edit: (id: string) => a.openDrawer(id),
    dup: (id: string) => { const r = s.doc?.rows.find((x) => x.id === id); if (r) a.insertRowAfter(id, duplicateRow(r)); },
    copy: (id: string) => { const r = s.doc?.rows.find((x) => x.id === id); if (!r) return; const txt = [r.concepto, r.monto === null ? '' : fmtCOP(r.monto), r.ref].join('\t'); void navigator.clipboard?.writeText(txt); a.toast(`Copiado: ${[r.concepto, r.monto === null ? '' : fmtCOP(r.monto), r.ref].filter((x) => x && x !== '—').join(' · ')}`); },
    del: (id: string) => a.removeRow(id),
    more: (id: string) => a.openRowActions(id),
  };
}

export function renderGrid(s: AppState, a: Actions) {
  const thead = $('#thead'), tb = $('#tbody');
  thead.innerHTML = `<tr>${COLS.map((c) => `<th class="${c.k ? 'sortable ' : ''}${c.cls ?? ''}" ${c.k ? `data-k="${c.k}"` : ''} ${c.title ? `title="${c.title}"` : ''}>${c.label}${c.k ? `<span class="arr">${s.filters.sort.k === c.k ? (s.filters.sort.dir > 0 ? '▲' : '▼') : ''}</span>` : ''}</th>`).join('')}</tr>`;
  thead.onclick = (e) => {
    const th = (e.target as HTMLElement).closest<HTMLElement>('th.sortable'); if (!th) return;
    const k = th.dataset.k as SortKey; const cur = s.filters.sort;
    a.setFilters({ sort: cur.k === k ? (cur.dir === 1 ? { k, dir: -1 } : { k: null, dir: 1 }) : { k, dir: 1 } });
  };

  if (!s.doc) { tb.innerHTML = ''; $('#emptyState').hidden = false; $('#emptyState').innerHTML = '<b>No hay ningún mes</b>Usa el menú ⋯ para duplicar o crea uno nuevo.'; ($('#grid') as HTMLElement).style.display = 'none'; return; }
  const rows = visibleRows(s.doc, s.filters, s.categorias);
  let html = ''; let g: string | null | undefined;
  const today = todayISO();
  for (const r of rows) {
    const venc = vencimiento(r.fecha, r.estado, today);
    if (s.filters.group && r.categoriaId !== g) {
      g = r.categoriaId; const grp = rows.filter((x) => x.categoriaId === g);
      html += `<tr class="subtotal"><td>${esc(catName(s.categorias, g) || 'Sin categoría')} <span class="muted">· ${grp.length}</span></td><td class="monto r">${esc(fmtCOP(sum(grp)))}</td><td colspan="9"><span class="muted">pendiente ${esc(fmtCOP(sum(grp.filter((x) => x.estado !== 'pagado'))))}</span></td></tr>`;
    }
    html += `<tr data-id="${r.id}" tabindex="0" class="${r.estado} ${r.monto === null ? 'noamt' : ''} ${venc ?? ''} ${s.sel.ids.has(r.id) ? 'selected' : ''}">
      <td class="concept" data-open="1">${s.sel.on ? '<i class="selmark" aria-hidden="true"></i>' : ''}${esc(r.concepto)}${r.recurrente ? '' : '<span class="pin" title="No recurrente">único</span>'}</td>
      <td class="monto r" data-monto="1">${money(r.monto)}</td>
      <td>${tagHTML(s, r.categoriaId)}</td>
      <td class="c">${estadoHTML(r)}</td>
      <td class="fecha c" data-fecha="1" title="${venc === 'vencida' ? 'Vencida' : venc === 'proxima' ? 'Vence pronto' : 'Fecha límite'}">${esc(fmtFecha(r.fecha))}${venc ? '<i class="vdot"></i>' : ''}</td>
      <td class="bols">${r.bolsillo ? esc(r.bolsillo) : '<span class="muted">—</span>'}</td>
      <td class="link col-link">${linkHTML(r.link)}</td>
      <td class="ref col-ref">${r.ref ? `<span>${esc(r.ref)}</span><button class="ib2 copyref" data-copy="${esc(r.ref)}" title="Copiar ref. de pago" aria-label="Copiar ref. de pago ${esc(r.ref)}">${ICON.copy}</button>` : '<span class="muted">—</span>'}</td>
      <td class="fecha c col-fpago">${esc(fmtFecha(r.fechaPago))}</td>
      <td class="c"><input type="checkbox" class="cb" data-f="recurrente" data-id="${r.id}" ${r.recurrente ? 'checked' : ''} aria-label="Recurrente"></td>
      <td class="acts r">${actionsHTML(r.id)}</td></tr>`;
  }
  tb.innerHTML = html;
  const empty = $('#emptyState'); empty.hidden = rows.length > 0; empty.innerHTML = '<b>Sin filas con estos filtros</b>Prueba otra búsqueda o limpia las categorías.';
  ($('#grid') as HTMLElement).style.display = rows.length ? '' : 'none';
  const all = s.doc.rows.length;
  $('#tfootRow').innerHTML = `<td>${rows.length === all ? `${all} filas` : `${rows.length} de ${all} filas`}</td><td class="monto r num">${esc(fmtCOP(sum(rows)))}</td><td colspan="2" class="muted" style="font-weight:400">visibles</td><td colspan="7"><span class="pendfoot">pendiente ${esc(fmtCOP(sum(rows.filter((r) => r.estado !== 'pagado'))))}</span></td>`;
  const a0 = document.activeElement;
  if (s.focusId && (a0 === null || a0 === document.body || tb.contains(a0))) tb.querySelector<HTMLElement>(`tr[data-id="${s.focusId}"]`)?.focus({ preventScroll: true });

  const handlers = rowActionHandlers(s, a);
  tb.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (clickSuprimido()) return;
    const cp = t.closest<HTMLElement>('button[data-copy]');
    if (cp) { const v = cp.dataset.copy!; void navigator.clipboard?.writeText(v).catch(() => undefined); a.toast(`Ref. copiada: ${v}`); return; }
    const trSel = t.closest<HTMLElement>('tr[data-id]');
    if (trSel && (s.sel.on || e.ctrlKey || e.metaKey || e.shiftKey) && !(!s.sel.on && t.closest('a, input, select, textarea'))) { e.preventDefault(); a.toggleSelect(trSel.dataset.id!, e.shiftKey ? 'rango' : 'uno'); return; }
    const act = t.closest<HTMLElement>('[data-a]'); if (act) { handlers[act.dataset.a!]?.(act.dataset.id!); return; }
    const est = t.closest<HTMLElement>('.estado button'); if (est) { setEstado(s, a, est.dataset.id!, est.dataset.e as Row['estado']); return; }
    const monto = t.closest<HTMLElement>('td[data-monto]'); if (monto && !monto.querySelector('input')) { openMontoEditor(s, a, monto.parentElement as HTMLTableRowElement); return; }
    const fecha = t.closest<HTMLElement>('td[data-fecha]'); if (fecha && !fecha.querySelector('input')) { openFechaEditor(s, a, fecha.parentElement as HTMLTableRowElement); return; }
    const concept = t.closest<HTMLElement>('td[data-open]'); if (concept) a.openDrawer((concept.parentElement as HTMLElement).dataset.id!);
  };
  tb.onchange = (e) => { const cb = (e.target as HTMLInputElement); if (cb.dataset.f === 'recurrente') a.updateRow(cb.dataset.id!, { recurrente: cb.checked }); };
  if (!tb.dataset.boundFocus) {
    tb.dataset.boundFocus = '1';
    tb.addEventListener('focusin', (e) => { const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]'); if (tr) s.focusId = tr.dataset.id!; });
  }
  if (isTouch()) attachSwipe(tb, s, a);
  if (isTouch()) attachLongPress(tb, s, a);
}

export function setEstado(s: AppState, a: Actions, id: string, estado: Row['estado']) {
  const r = s.doc?.rows.find((x) => x.id === id); if (!r) return;
  s.focusId = id; a.replaceRow(id, withEstado(r, estado, todayISO()));
}

export function cycleEstado(s: AppState, a: Actions, id: string) {
  const r = s.doc?.rows.find((x) => x.id === id); if (r) setEstado(s, a, id, nextEstado(r.estado));
}

export function openMontoEditor(s: AppState, a: Actions, tr: HTMLTableRowElement) {
  const id = tr.dataset.id!; const r = s.doc?.rows.find((x) => x.id === id); if (!r) return;
  const td = tr.querySelector<HTMLElement>('td[data-monto]')!;
  td.innerHTML = `<input inputmode="numeric" pattern="[0-9.]*" enterkeyhint="done" value="${r.monto === null ? '' : esc(fmtCOP(r.monto).slice(1))}" aria-label="Monto">`;
  const input = td.querySelector('input')!; attachLiveMoney(input); input.focus(); input.select();
  let done = false;
  const commit = (next: 'stay' | 'next' | 'cancel') => {
    if (done) return; done = true;
    if (next !== 'cancel') {
      const v = parseMonto(input.value);
      if (input.value.trim() !== '' && v === null) { a.renderRows(); finish('cancel'); return; }
      if (v !== r.monto) { s.focusId = id; a.updateRow(id, { monto: v }); return finish(next); }
    }
    a.renderRows(); finish(next);
  };
  const finish = (next: 'stay' | 'next' | 'cancel') => {
    if (next !== 'next') return;
    const trs = Array.from($('#tbody').querySelectorAll<HTMLTableRowElement>('tr[data-id]'));
    const i = trs.findIndex((x) => x.dataset.id === id); const nextTr = trs[i + 1];
    if (nextTr) openMontoEditor(s, a, nextTr);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit('stay'); }
    else if (e.key === 'Tab') { e.preventDefault(); commit('next'); }
    else if (e.key === 'Escape') { e.preventDefault(); commit('cancel'); }
  };
  input.onblur = () => commit('stay');
}

/** Editor de fecha límite en la celda: selector nativo; Enter/cambio guarda, Esc cancela, vacío = sin fecha. */
export function openFechaEditor(s: AppState, a: Actions, tr: HTMLTableRowElement) {
  const id = tr.dataset.id!; const r = s.doc?.rows.find((x) => x.id === id); if (!r) return;
  const td = tr.querySelector<HTMLElement>('td[data-fecha]')!;
  td.innerHTML = `<input type="date" value="${esc(r.fecha ?? '')}" aria-label="Fecha límite">`;
  const input = td.querySelector('input')!; input.focus();
  try { (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* sin selector nativo */ }
  let done = false;
  const commit = (cancel = false) => {
    if (done) return; done = true;
    const v = cancel ? r.fecha : (input.value || null);
    if (v !== r.fecha) { s.focusId = id; a.updateRow(id, { fecha: v }); return; }
    a.renderRows();
  };
  input.onchange = () => { if (input.value && Number(input.value.slice(0, 4)) < 2000) return; commit(); };
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); commit(true); } };
  input.onblur = () => commit();
}

/** Deslizar a la derecha: siguiente estado. A la izquierda: hoja de acciones. Solo pantallas táctiles. */
function attachSwipe(tb: HTMLElement, s: AppState, a: Actions) {
  let startX = 0, startY = 0, tr: HTMLTableRowElement | null = null, dx = 0, active = false;
  tb.onpointerdown = (e) => {
    if (e.pointerType === 'mouse') return;
    if (s.sel.on) return;
    const target = e.target as HTMLElement; if (target.closest('button, input, a')) return;
    tr = target.closest<HTMLTableRowElement>('tr[data-id]'); if (!tr) return;
    startX = e.clientX; startY = e.clientY; dx = 0; active = false;
  };
  tb.onpointermove = (e) => {
    if (!tr) return;
    if (s.sel.on) { tr.style.transform = ''; tr.classList.remove('swiping'); tr = null; active = false; return; }
    dx = e.clientX - startX; const dy = e.clientY - startY;
    if (!active && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) { active = true; tr.classList.add('swiping'); tb.setPointerCapture?.(e.pointerId); }
    if (active) { e.preventDefault(); tr.style.transform = `translateX(${Math.max(-96, Math.min(96, dx))}px)`; }
  };
  const end = () => {
    if (!tr) return;
    const row = tr; row.style.transform = ''; row.classList.remove('swiping');
    const id = row.dataset.id!; tr = null;
    if (!active || s.sel.on) return;
    if (dx > 64) cycleEstado(s, a, id);
    else if (dx < -64) a.openRowActions(id);
  };
  tb.onpointerup = end; tb.onpointercancel = end;
}

let suprimirHasta = 0;
/** Tras una pulsación larga, el click que sigue al pointerup no debe volver a alternar la fila. Acotado en el tiempo para no tragar un clic posterior no relacionado. */
export function clickSuprimido(): boolean { const v = Date.now() < suprimirHasta; suprimirHasta = 0; return v; }

/** Pulsación larga (500 ms, < 8 px) sobre una fila o tarjeta: entra al modo de selección y la marca. */
export function attachLongPress(root: HTMLElement, s: AppState, a: Actions) {
  if (root.dataset.boundLongPress) return; root.dataset.boundLongPress = '1';
  let timer: number | null = null, sx = 0, sy = 0;
  const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement; if (target.closest('button, input, a, select')) return;
    const item = target.closest<HTMLElement>('[data-id]'); if (!item) return;
    sx = e.clientX; sy = e.clientY; cancel();
    timer = window.setTimeout(() => { timer = null; suprimirHasta = Date.now() + 700; navigator.vibrate?.(10); a.toggleSelect(item.dataset.id!); }, 500);
  });
  root.addEventListener('pointermove', (e) => { if (timer !== null && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel(); });
  root.addEventListener('pointerup', cancel); root.addEventListener('pointercancel', cancel);
  // Evita el menú nativo (Copiar/Compartir) del navegador tras la pulsación larga sobre una fila o tarjeta.
  root.addEventListener('contextmenu', (e) => { const t = e.target as HTMLElement; if (t.closest('[data-id]') && !t.closest('a, input, select, textarea')) e.preventDefault(); });
}
