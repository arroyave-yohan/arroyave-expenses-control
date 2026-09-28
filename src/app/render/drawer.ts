import { $, esc } from '../dom';
import { fmtCOP, parseMonto, ymLabel, todayISO } from '../format';
import { bolsilloNombres, withEstado, duplicateRow, ESTADOS, ESTADO_LONG } from '../state';
import type { AppState } from '../state';
import type { Actions } from '../main';
import type { Row } from '../../shared/types';
import { attachLiveMoney } from '../money-input';

let editing: string | null = null;

export function closeDrawer(s: AppState, a: Actions) {
  const root = $('#drawerRoot'); root.hidden = true; root.innerHTML = ''; document.body.classList.remove('drawer-open');
  if (editing) { s.focusId = editing; editing = null; a.renderRows(); }
}

export function openDrawer(s: AppState, a: Actions, id: string) {
  const r = s.doc?.rows.find((x) => x.id === id); if (!r || !s.doc) return;
  editing = id;
  const bols = bolsilloNombres(s, r.bolsillo);
  const root = $('#drawerRoot');
  root.innerHTML = `
    <div class="scrim" id="drawerScrim"></div>
    <aside class="drawer" role="dialog" aria-labelledby="drawerTitle">
      <header><div><h2 id="drawerTitle">Editar fila</h2><div class="month">${esc(ymLabel(s.doc.month))}</div></div><button class="btn ghost" id="drawerClose">Cerrar</button></header>
      <form id="drawerForm" autocomplete="off">
        <div class="field"><label for="f_concepto">Concepto</label><input id="f_concepto" required enterkeyhint="next" value="${esc(r.concepto)}"></div>
        <div class="row2">
          <div class="field"><label for="f_monto">Monto (COP)</label><input id="f_monto" class="num" inputmode="numeric" pattern="[0-9.]*" enterkeyhint="next" placeholder="0" value="${r.monto === null ? '' : esc(fmtCOP(r.monto).slice(1))}"></div>
          <div class="field"><label for="f_estado">Estado</label><select id="f_estado">${ESTADOS.map((e) => `<option value="${e}" ${r.estado === e ? 'selected' : ''}>${ESTADO_LONG[e]}</option>`).join('')}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label for="f_cat">Categoría</label><select id="f_cat"><option value="">Sin categoría</option>${s.categorias.items.map((c) => `<option value="${esc(c.id)}" ${c.id === r.categoriaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div>
          <div class="field"><label for="f_bols">Bolsillo / medio de pago</label><input id="f_bols" list="bolsList" enterkeyhint="next" value="${esc(r.bolsillo)}"><datalist id="bolsList">${bols.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
        </div>
        <div class="row2">
          <div class="field"><label for="f_lim">Fecha límite / plan de pago</label><div class="conbtn"><input id="f_lim" type="date" value="${esc(r.fecha ?? '')}"><button type="button" class="btn ghost" id="f_quitarFecha" aria-label="Quitar fecha límite" ${r.fecha ? '' : 'hidden'}>Quitar</button></div></div>
          <div class="field"><label for="f_fecha">Fecha de pago (se llena al marcar Pagado)</label><input id="f_fecha" type="date" value="${esc(r.fechaPago ?? '')}" ${r.estado === 'pagado' ? '' : 'disabled'}></div>
        </div>
        <div class="bools"><label><input type="checkbox" id="f_rec" class="cb" ${r.recurrente ? 'checked' : ''}>Recurrente</label>${r.fecha && r.estado !== 'pagado' ? `<label><input type="checkbox" id="f_sinAviso" class="cb" disabled>Sin avisos para esta fecha</label>` : ''}</div>
        ${r.fecha && r.estado !== 'pagado' ? '<div class="nota" id="f_aplazado"></div>' : ''}
        <div class="field"><label for="f_link">Link de pago</label><input id="f_link" inputmode="url" enterkeyhint="next" placeholder="https://… o una nota" value="${esc(r.link)}"></div>
        <div class="field"><label for="f_ref">Ref. de pago</label><input id="f_ref" class="num" enterkeyhint="done" placeholder="Número de contrato, cuenta…" value="${esc(r.ref)}"></div>
      </form>
      <footer>
        <button class="btn primary" id="drawerSave" form="drawerForm" type="submit">Guardar</button>
        <button class="btn" id="drawerDup">Duplicar</button>
        <button class="btn danger push" id="drawerDel">Eliminar</button>
      </footer>
    </aside>`;
  root.hidden = false; document.body.classList.add('drawer-open');
  const f = <T extends HTMLElement>(id: string) => $<T>(`#${id}`, root);
  const estadoSel = f<HTMLSelectElement>('f_estado'), fecha = f<HTMLInputElement>('f_fecha');
  estadoSel.onchange = () => { fecha.disabled = estadoSel.value !== 'pagado'; if (estadoSel.value === 'pagado' && !fecha.value) fecha.value = todayISO(); };
  f<HTMLInputElement>('f_monto').onblur = (e) => { const el = e.target as HTMLInputElement; const n = parseMonto(el.value); el.value = n === null ? '' : fmtCOP(n).slice(1); };
  attachLiveMoney(f<HTMLInputElement>('f_monto'));
  // Quitar la fecha límite: vacía el campo (se guarda como null al pulsar Guardar)
  const lim = f<HTMLInputElement>('f_lim'), quitarFecha = f<HTMLButtonElement>('f_quitarFecha');
  quitarFecha.onclick = () => { lim.value = ''; quitarFecha.hidden = true; lim.focus(); };
  lim.oninput = () => { quitarFecha.hidden = !lim.value; };
  if (r.fecha && r.estado !== 'pagado') {
    const sin = f<HTMLInputElement>('f_sinAviso'), apl = f('f_aplazado');
    void a.avisoGasto(id).then((e) => {
      if (editing !== id) return;
      sin.disabled = false; sin.checked = !!e && e.silenciadoFecha === r.fecha;
      const hasta = e?.aplazadoHasta && new Date(e.aplazadoHasta).getTime() > Date.now() ? new Date(e.aplazadoHasta) : null;
      apl.innerHTML = hasta ? `Aviso aplazado hasta ${esc(hasta.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }))} <button type="button" class="btn ghost" id="f_quitarApl">Quitar</button>` : '';
      const q = root.querySelector<HTMLButtonElement>('#f_quitarApl');
      if (q) q.onclick = async () => {
        q.disabled = true;
        try { await a.quitarAplazamiento(id); if (editing !== id) return; apl.textContent = ''; a.toast('Aplazamiento quitado'); }
        catch (err) { if (editing !== id) return; q.disabled = false; a.toast(`No se pudo: ${(err as Error).message}`); }
      };
    });
    sin.onchange = async () => {
      sin.disabled = true;
      try { await a.silenciarAviso(id, sin.checked); if (editing !== id) return; a.toast(sin.checked ? 'Sin avisos para esta fecha' : 'Avisos reactivados'); }
      catch (err) { if (editing !== id) return; sin.checked = !sin.checked; a.toast(`No se pudo: ${(err as Error).message}`); }
      finally { if (editing === id) sin.disabled = false; }
    };
  }
  const save = () => {
    if (editing !== id) return;
    const base: Row = {
      ...r,
      concepto: f<HTMLInputElement>('f_concepto').value.trim() || r.concepto,
      monto: parseMonto(f<HTMLInputElement>('f_monto').value),
      categoriaId: f<HTMLSelectElement>('f_cat').value || null,
      bolsillo: f<HTMLInputElement>('f_bols').value.trim(),
      fecha: f<HTMLInputElement>('f_lim').value || null,
      recurrente: f<HTMLInputElement>('f_rec').checked,
      link: f<HTMLInputElement>('f_link').value.trim(),
      ref: f<HTMLInputElement>('f_ref').value.trim(),
    };
    const estado = estadoSel.value as Row['estado'];
    let next = withEstado(base, estado, todayISO());
    if (estado === 'pagado' && fecha.value) next = { ...next, fechaPago: fecha.value };
    a.replaceRow(id, next);
    closeDrawer(s, a); a.toast(`Guardado: ${next.concepto}`);
  };
  f<HTMLFormElement>('drawerForm').onsubmit = (e) => { e.preventDefault(); save(); };
  f('drawerClose').onclick = () => closeDrawer(s, a);
  f('drawerScrim').onclick = () => closeDrawer(s, a);
  f('drawerDup').onclick = () => { closeDrawer(s, a); a.insertRowAfter(id, duplicateRow(r)); };
  f('drawerDel').onclick = () => { closeDrawer(s, a); a.removeRow(id); };
  // Enter en un campo de texto pasa al siguiente campo (teclado "next"); en el último guarda
  root.querySelectorAll<HTMLInputElement>('input[enterkeyhint="next"]').forEach((inp) => { inp.onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const all = Array.from(root.querySelectorAll<HTMLElement>('input:not([disabled]), select')); all[all.indexOf(inp) + 1]?.focus(); }; });
  f<HTMLInputElement>('f_ref').onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); save(); };
  const first = f<HTMLInputElement>('f_concepto'); first.focus(); first.select();
  first.scrollIntoView({ block: 'nearest' });
}

export const isDrawerOpen = () => !$('#drawerRoot').hidden;
