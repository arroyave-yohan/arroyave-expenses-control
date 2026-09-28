import { $, esc } from '../dom';
import { fmtCOP, fmtFecha, parseMonto, todayISO, currentYm, ymLabel } from '../format';
import { bolsilloNombres } from '../state';
import { sugerir, propuestaNueva, mesDestino } from '../recibos';
import { reducirImagen, elegirArchivo } from '../recibos-browser';
import { normalizarComercio, mesDe, type Lectura, type RecibosDoc } from '../../shared/recibos';
import { attachLiveMoney } from '../money-input';
import type { AppState } from '../state';
import type { Actions } from '../main';
import type { Api } from '../api';

function mount(html: string) { const root = $('#modalRoot'); root.innerHTML = `<div class="modal" id="modalBox">${html}</div>`; root.hidden = false; const close = () => { root.hidden = true; root.innerHTML = ''; }; $('#modalBox').onclick = (e) => { if ((e.target as HTMLElement).id === 'modalBox') close(); }; return { root, close }; }

export function openReciboModal(s: AppState, a: Actions, api: Api, archivo?: Blob) {
  const { root, close } = mount(`<div class="box recibo" id="reciboBox"><h2>Recibo</h2><div id="rbCuerpo"></div></div>`);
  const cuerpo = $('#rbCuerpo', root);
  const elegir = () => { cuerpo.innerHTML = `<p class="nota">Comparte la captura de la notificación del banco o elígela aquí. Solo se lee; la imagen no se guarda.</p>
    <div class="actions rbinicio"><button class="btn primary" id="rbTomar">Tomar foto</button><button class="btn" id="rbElegir">Elegir imagen</button><span class="push"></span><button class="btn" id="rbCancel">Cancelar</button></div>`;
    $('#rbTomar', root).onclick = async () => { const f = await elegirArchivo(true); if (f) void analizar(f); };
    $('#rbElegir', root).onclick = async () => { const f = await elegirArchivo(false); if (f) void analizar(f); };
    $('#rbCancel', root).onclick = close; };
  const analizar = async (f: Blob) => {
    cuerpo.innerHTML = `<div class="nota" id="rbEstado">Analizando…</div>`;
    try {
      const [{ lectura, movimientos }, aliases] = await Promise.all([api.analizarRecibo(await reducirImagen(f)), api.recibosAlias().catch(() => ({ aliases: {} } as RecibosDoc))]);
      if (!cuerpo.isConnected) return; // la hoja se cerró mientras se analizaba
      resultado(lectura, movimientos, aliases);
    } catch (e) {
      if (!cuerpo.isConnected) return;
      cuerpo.innerHTML = `<div class="nota" id="rbEstado">${esc((e as Error).message || 'No se pudo leer el recibo')}</div>
        <div class="actions"><button class="btn" id="rbReintentar">Reintentar</button><button class="btn" id="rbManual">Llenar a mano</button><span class="push"></span><button class="btn" id="rbCancel">Cancelar</button></div>`;
      $('#rbReintentar', root).onclick = () => void analizar(f);
      $('#rbManual', root).onclick = () => resultado({ comercio: '', fecha: null, hora: null, monto: null, tipo: 'otro', canal: null, referencia: null, banco: null }, 1, { aliases: {} });
      $('#rbCancel', root).onclick = close;
    }
  };
  const resultado = (l: Lectura, movimientos: number, doc: RecibosDoc) => {
    const alias = doc.aliases[normalizarComercio(l.comercio)];
    const hoy = todayISO(); const ym = mesDestino(l, s.months, currentYm());
    const prop = propuestaNueva(l, alias, hoy);
    const filasMes = ym === s.ym ? (s.doc?.rows ?? []) : (s.recent.find((d) => d.month === ym)?.rows ?? []);
    const sug = sugerir(l, filasMes, doc.aliases, hoy);
    const pendientes = filasMes.filter((r) => r.estado !== 'pagado');
    const linea = (r: typeof filasMes[number]) => `<button class="btn rbsug" data-id="${esc(r.id)}">${esc(r.concepto)} · ${esc(fmtCOP(r.monto))} · ${esc(r.estado)}</button>`;
    cuerpo.innerHTML = `
      <div class="rblectura" id="rbLectura"><b>${esc(l.comercio || 'Sin nombre')}</b><span class="num">${esc(fmtCOP(l.monto))}</span><small>${esc(fmtFecha(l.fecha))}${l.hora ? ` ${esc(l.hora)}` : ''}${l.canal ? ` · ${esc(l.canal)}` : ''}${l.banco ? ` · ${esc(l.banco)}` : ''}</small></div>
      ${movimientos > 1 ? `<div class="nota" id="rbAviso">La imagen tiene ${movimientos} movimientos; se usa el primero</div>` : ''}
      ${ym ? '' : '<div class="nota">No hay meses todavía: crea uno primero.</div>'}
      ${ym && mesDe(l.fecha) && mesDe(l.fecha) !== ym ? `<div class="nota">El mes del recibo (${esc(ymLabel(mesDe(l.fecha)!))}) no existe; se usa ${esc(ymLabel(ym))}.</div>` : ''}
      <div class="rbdos">
        <section class="rbbloque" id="rbNuevo"><h3>Nuevo gasto</h3>
          <label class="field"><span>Concepto</span><input id="rbConcepto" value="${esc(prop.concepto)}"></label>
          <label class="field"><span>Monto (COP)</span><input id="rbMonto" class="num" inputmode="numeric" pattern="[0-9.]*" value="${prop.monto === null ? '' : esc(fmtCOP(prop.monto).slice(1))}"></label>
          <label class="field"><span>Categoría</span><select id="rbCat"><option value="">Sin categoría</option>${s.categorias.items.map((c) => `<option value="${esc(c.id)}" ${c.id === prop.categoriaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
          <label class="field"><span>Bolsillo</span><input id="rbBols" list="rbBolsList" value="${esc(prop.bolsillo)}"><datalist id="rbBolsList">${bolsilloNombres(s, prop.bolsillo).map((b) => `<option value="${esc(b)}">`).join('')}</datalist></label>
          <label class="field"><span>Fecha de pago</span><input id="rbFechaPago" type="date" value="${esc(prop.fechaPago ?? hoy)}"></label>
          <label class="field"><span>Mes</span><select id="rbMes">${s.months.map((m) => `<option value="${m}" ${m === ym ? 'selected' : ''}>${esc(ymLabel(m))}</option>`).join('')}</select></label>
          <button class="btn primary" id="rbCrear" ${ym ? '' : 'disabled'}>Crear pagado</button>
        </section>
        <section class="rbbloque" id="rbExistente"><h3>Añadir a un gasto existente</h3>
          <div class="rblista" id="rbSugerencias">${sug.length ? sug.map((x) => linea(x.row)).join('') : '<div class="nota">Sin coincidencias claras en ' + esc(ym ? ymLabel(ym) : '') + '.</div>'}</div>
          ${pendientes.length > sug.length ? '<button class="btn ghost" id="rbTodos">Ver todos los pendientes</button>' : ''}
        </section>
      </div>
      <div class="actions"><button class="btn" id="rbCancel">Cancelar</button></div>`;
    attachLiveMoney($<HTMLInputElement>('#rbMonto', root));
    const aliasDe = (concepto: string, categoriaId: string | null, bolsillo: string) => ({ comercio: l.comercio || concepto, concepto, categoriaId, bolsillo });
    $('#rbCancel', root).onclick = close;
    const todos = root.querySelector<HTMLButtonElement>('#rbTodos');
    if (todos) todos.onclick = () => { $('#rbSugerencias', root).innerHTML = pendientes.map(linea).join(''); todos.remove(); };
    $('#rbSugerencias', root).onclick = async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]'); if (!b || !ym) return;
      const fecha = $<HTMLInputElement>('#rbFechaPago', root).value || hoy;
      close(); await a.pagarDesdeRecibo(ym, b.dataset.id!, fecha, l.referencia ?? '', aliasDe('', null, prop.bolsillo));
    };
    $('#rbCrear', root).onclick = async () => {
      const concepto = $<HTMLInputElement>('#rbConcepto', root).value.trim(); if (!concepto) { a.toast('Ponle un concepto'); return; }
      const monto = parseMonto($<HTMLInputElement>('#rbMonto', root).value);
      const categoriaId = $<HTMLSelectElement>('#rbCat', root).value || null; const bolsillo = $<HTMLInputElement>('#rbBols', root).value.trim();
      const fechaPago = $<HTMLInputElement>('#rbFechaPago', root).value || hoy; const mes = $<HTMLSelectElement>('#rbMes', root).value;
      close(); await a.crearDesdeRecibo(mes, { ...prop, concepto, monto, categoriaId, bolsillo, fechaPago }, aliasDe(concepto, categoriaId, bolsillo));
    };
  };
  if (archivo) void analizar(archivo); else elegir();
}
