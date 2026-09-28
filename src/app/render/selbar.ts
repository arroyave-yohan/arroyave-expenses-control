import { $, esc } from '../dom';
import { fmtCOP, fmtFecha } from '../format';
import { bolsilloNombres, ESTADOS, ESTADO_LABEL, ESTADO_LONG } from '../state';
import { resumen, etiquetaMasiva } from '../selection';
import type { AppState } from '../state';
import type { Actions } from '../main';
import type { Estado } from '../../shared/types';

/** Barra fija inferior del modo de selección: resumen + acciones masivas. */
export function renderSelBar(s: AppState, a: Actions) {
  const bar = $('#selbar');
  if (!s.sel.on || !s.doc) { bar.hidden = true; bar.innerHTML = ''; return; }
  const r = resumen(s.doc.rows, s.sel.ids); const n = r.count; const dis = n === 0 ? 'disabled' : '';
  bar.hidden = false;
  bar.innerHTML = `
    <div class="selinfo"><button class="seltotal" id="selTotal" title="Copiar total" ${dis}><b>${n}</b> seleccionado${n === 1 ? '' : 's'} · <span class="num">${esc(fmtCOP(r.total))}</span>${r.sinMonto ? ` <small>· ${r.sinMonto} sin monto</small>` : ''}</button></div>
    <div class="selacts">
      <span class="estado" id="selEstado" role="group" aria-label="Estado para la selección">${ESTADOS.map((e) => `<button data-e="${e}" ${dis} title="${ESTADO_LONG[e]}">${ESTADO_LABEL[e]}</button>`).join('')}</span>
      <select class="sel" id="selCat" aria-label="Categoría para la selección" ${dis}><option value="">Categoría…</option>${s.categorias.items.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}<option value="__none">Sin categoría</option></select>
      <select class="sel" id="selBols" aria-label="Bolsillo para la selección" ${dis}><option value="">Bolsillo…</option>${bolsilloNombres(s).map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}<option value="__none">Sin bolsillo</option></select>
      <input type="date" id="selFecha" aria-label="Fecha límite para la selección" ${dis}>
      <button class="btn" id="selSinFecha" ${dis}>Quitar fecha</button>
      <button class="btn danger" id="selDel" ${dis}>Eliminar</button>
      <span class="push"></span>
      <button class="btn" id="selAll">Todos los visibles</button>
      <button class="btn" id="selCancel">Cancelar</button>
    </div>`;
  $('#selTotal', bar).onclick = () => a.copySelectionTotal();
  $('#selEstado', bar).onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-e]'); if (b && !b.disabled) a.bulkEstado(b.dataset.e as Estado); };
  const cat = $<HTMLSelectElement>('#selCat', bar);
  cat.onchange = () => { const v = cat.value; if (!v) return; const id = v === '__none' ? null : v; const nombre = id === null ? 'Sin categoría' : (s.categorias.items.find((c) => c.id === id)?.nombre ?? id); a.bulkPatch({ categoriaId: id }, etiquetaMasiva('Categoría', n, nombre)); };
  const bols = $<HTMLSelectElement>('#selBols', bar);
  bols.onchange = () => { const v = bols.value; if (!v) return; const nombre = v === '__none' ? '' : v; a.bulkPatch({ bolsillo: nombre }, etiquetaMasiva('Bolsillo', n, nombre || '—')); };
  const fecha = $<HTMLInputElement>('#selFecha', bar);
  fecha.onchange = () => { if (fecha.value && Number(fecha.value.slice(0, 4)) >= 2000) a.bulkPatch({ fecha: fecha.value }, etiquetaMasiva('Fecha', n, fmtFecha(fecha.value))); };
  $('#selSinFecha', bar).onclick = () => a.bulkPatch({ fecha: null }, etiquetaMasiva('Fecha', n, '—'));
  $('#selDel', bar).onclick = () => a.bulkDelete();
  $('#selAll', bar).onclick = () => a.selectAllVisible();
  $('#selCancel', bar).onclick = () => a.clearSelection();
}
