import { $, esc, isTouch } from '../dom';
import { fmtCOP, fmtFecha, todayISO } from '../format';
import { vencimiento } from '../../shared/dates';
import { visibleRows, catName } from '../state';
import type { AppState } from '../state';
import type { Actions } from '../main';
import { tagHTML, estadoHTML, actionsHTML, linkHTML, rowActionHandlers, setEstado, attachLongPress, clickSuprimido } from './grid';
import type { Row } from '../../shared/types';

const sum = (rows: Row[]) => rows.reduce((t, r) => t + (r.monto ?? 0), 0);

export function renderCards(s: AppState, a: Actions) {
  const box = $('#cards');
  if (!s.doc) { box.innerHTML = '<div class="empty"><b>No hay ningún mes</b>Usa el menú ⋯ para duplicar o crea uno nuevo.</div>'; return; }
  const rows = visibleRows(s.doc, s.filters, s.categorias);
  let html = ''; let g: string | null | undefined;
  const today = todayISO();
  for (const r of rows) {
    const venc = vencimiento(r.fecha, r.estado, today);
    if (s.filters.group && r.categoriaId !== g) { g = r.categoriaId; html += `<div class="csub">${esc(catName(s.categorias, g) || 'Sin categoría')}<span>${esc(fmtCOP(sum(rows.filter((x) => x.categoriaId === g))))}</span></div>`; }
    html += `<div class="card ${r.estado} ${venc ?? ''} ${s.sel.ids.has(r.id) ? 'selected' : ''}" data-id="${r.id}">
      <div class="cn" data-open="1">${s.sel.on ? '<i class="selmark" aria-hidden="true"></i>' : ''}${esc(r.concepto)}</div>
      <div class="cm num">${esc(fmtCOP(r.monto))}</div>
      <div class="cmeta">${tagHTML(s, r.categoriaId)}${r.fecha ? `<span class="cfecha ${venc ?? ''}">${esc(fmtFecha(r.fecha))}${venc ? '<i class="vdot"></i>' : ''}</span>` : ''}${r.bolsillo ? `<span>${esc(r.bolsillo)}</span>` : ''}${/^https?:/.test(r.link) ? linkHTML(r.link) : ''}</div>
      <div class="cest">${estadoHTML(r)}</div>
      <div class="cacts">${actionsHTML(r.id)}</div></div>`;
  }
  html += `<div class="cfoot"><span>${rows.length} filas</span><span class="num">${esc(fmtCOP(sum(rows)))}</span></div>`;
  box.innerHTML = rows.length ? html : '<div class="empty"><b>Sin filas con estos filtros</b>Prueba otra búsqueda.</div>';
  const handlers = rowActionHandlers(s, a);
  box.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (clickSuprimido()) return;
    const trSel = t.closest<HTMLElement>('.card');
    if (trSel && (s.sel.on || e.ctrlKey || e.metaKey || e.shiftKey) && !(!s.sel.on && t.closest('a, input, select, textarea'))) { e.preventDefault(); a.toggleSelect(trSel.dataset.id!, e.shiftKey ? 'rango' : 'uno'); return; }
    const act = t.closest<HTMLElement>('[data-a]'); if (act) { handlers[act.dataset.a!]?.(act.dataset.id!); return; }
    const est = t.closest<HTMLElement>('.estado button'); if (est) { setEstado(s, a, est.dataset.id!, est.dataset.e as Row['estado']); return; }
    const open = t.closest<HTMLElement>('[data-open]'); if (open) a.openDrawer((open.closest('.card') as HTMLElement).dataset.id!);
  };
  if (isTouch()) attachLongPress(box, s, a);
}
