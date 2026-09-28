import { $, esc } from '../dom';
import { ymLabel, nextYm, currentYm } from '../format';
import type { AppState } from '../state';
import type { Actions } from '../main';
import type { Bolsillo, Categoria } from '../../shared/types';
import { uniqueSlug } from '../../shared/slug';
import type { Api } from '../api';
import { AVISOS_DEFAULT, type AvisosConfig } from '../../shared/avisos';
import { localSubscription, pushSoportado, subscribeHere } from '../push-browser';
import type { PushInfo } from '../push';

function mount(html: string) { const root = $('#modalRoot'); root.innerHTML = `<div class="modal" id="modalBox">${html}</div>`; root.hidden = false; const close = () => { root.hidden = true; root.innerHTML = ''; }; $('#modalBox').onclick = (e) => { if ((e.target as HTMLElement).id === 'modalBox') close(); }; return { root, close }; }

export function openDuplicateModal(s: AppState, a: Actions) {
  const from = s.ym; const to = from ? nextYm(from) : currentYm();
  if (!from || !s.doc) { openCreateEmpty(s, a, to); return; }
  const rec = s.doc.rows.filter((r) => r.recurrente).length;
  const exists = s.months.includes(to);
  const { root, close } = mount(`<div class="box">
    <h2>Duplicar mes</h2>
    <p>${exists ? `${esc(ymLabel(to))} ya existe. Si continúas, se reemplazará con una copia de ${esc(ymLabel(from))}.` : `Crea ${esc(ymLabel(to))} usando ${esc(ymLabel(from))} como plantilla. Las filas quedan listas para marcar a medida que pagas.`}</p>
    <div class="arrow"><span>${esc(ymLabel(from))}</span><span>→</span><span>${esc(ymLabel(to))}</span></div>
    <div class="opts">
      <label><input type="checkbox" id="o_rec" checked><span>Copiar solo las filas recurrentes<small>${rec} de ${s.doc.rows.length} filas son recurrentes</small></span></label>
      <label><input type="checkbox" id="o_est" checked><span>Resetear el estado a <b>Pendiente</b> (y borrar la fecha de pago)</span></label>
      <label><input type="checkbox" id="o_monto" checked><span>Mantener los montos<small>Si lo desmarcas, las filas quedan sin monto para llenarlas después.</small></span></label>
      <label><input type="checkbox" id="o_ing" checked><span>Mantener los ingresos del mes</span></label>
    </div>
    <div class="actions"><button class="btn" id="dupCancel">Cancelar</button><button class="btn primary" id="dupConfirm">${exists ? 'Reemplazar mes' : 'Crear mes'}</button></div>
  </div>`);
  $('#dupCancel', root).onclick = close;
  $('#dupConfirm', root).onclick = async () => {
    const opts = { target: to, soloRecurrentes: $<HTMLInputElement>('#o_rec', root).checked, resetEstado: $<HTMLInputElement>('#o_est', root).checked, mantenerMontos: $<HTMLInputElement>('#o_monto', root).checked, mantenerIngresos: $<HTMLInputElement>('#o_ing', root).checked, reemplazar: exists };
    close();
    await a.duplicateMonth(from, opts);
  };
}

export function openCreateEmpty(s: AppState, a: Actions, ym: string) {
  const { root, close } = mount(`<div class="box"><h2>Crear mes</h2><p>No hay ningún mes todavía. Se creará ${esc(ymLabel(ym))} vacío.</p>
    <div class="field"><label for="c_ym">Mes (YYYY-MM)</label><input id="c_ym" value="${esc(ym)}" pattern="\\d{4}-\\d{2}"></div>
    <div class="actions" style="margin-top:14px"><button class="btn" id="cCancel">Cancelar</button><button class="btn primary" id="cOk">Crear</button></div></div>`);
  $('#cCancel', root).onclick = close;
  $('#cOk', root).onclick = async () => { const v = $<HTMLInputElement>('#c_ym', root).value.trim(); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return; close(); await a.createEmptyMonth(v); };
}

export function openDeleteMonthModal(s: AppState, a: Actions) {
  if (!s.ym) return; const ym = s.ym; const label = ymLabel(ym);
  const { root, close } = mount(`<div class="box"><h2>Eliminar ${esc(label)}</h2>
    <p>Se borran sus ${s.doc?.rows.length ?? 0} filas. No se puede deshacer. Escribe <b>${esc(label)}</b> para confirmar.</p>
    <div class="field"><input id="delConfirmInput" placeholder="${esc(label)}" autocomplete="off"></div>
    <div class="actions" style="margin-top:14px"><button class="btn" id="delCancel">Cancelar</button><button class="btn danger" id="delOk" disabled>Eliminar mes</button></div></div>`);
  const input = $<HTMLInputElement>('#delConfirmInput', root), ok = $<HTMLButtonElement>('#delOk', root);
  input.oninput = () => { ok.disabled = input.value.trim().toLowerCase() !== label.toLowerCase(); };
  $('#delCancel', root).onclick = close;
  ok.onclick = async () => { close(); await a.deleteMonth(ym); };
  input.focus();
}

export function openCategoriasModal(s: AppState, a: Actions) {
  let items: Categoria[] = s.categorias.items.map((c) => ({ ...c })).sort((x, y) => x.orden - y.orden);
  const { root, close } = mount(`<div class="box"><h2>Categorías</h2><p>Renombra, cambia el color o el orden. No se puede borrar una categoría que algún mes use.</p>
    <div class="catlist" id="catlist"></div>
    <div class="actions"><button class="btn" id="catAdd">+ Nueva categoría</button><span class="push"></span><button class="btn" id="catCancel">Cancelar</button><button class="btn primary" id="catSave">Guardar</button></div></div>`);
  const list = $('#catlist', root);
  const paint = () => {
    list.innerHTML = items.map((c, i) => `<div class="catrow" data-i="${i}">
      <span class="dot" style="--h:${c.hue}"></span>
      <input value="${esc(c.nombre)}" data-f="nombre" aria-label="Nombre" enterkeyhint="done">
      <input type="range" min="0" max="359" value="${c.hue}" data-f="hue" aria-label="Color">
      <button class="ib2" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
      <button class="ib2 del" data-a="del" aria-label="Eliminar">✕</button></div>`).join('');
  };
  paint();
  list.oninput = (e) => { const el = e.target as HTMLInputElement; const i = Number((el.closest('.catrow') as HTMLElement).dataset.i); if (el.dataset.f === 'nombre') items[i].nombre = el.value; if (el.dataset.f === 'hue') { items[i].hue = Number(el.value); (el.closest('.catrow')!.querySelector('.dot') as HTMLElement).style.setProperty('--h', el.value); } };
  list.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]'); if (!b) return;
    const i = Number((b.closest('.catrow') as HTMLElement).dataset.i);
    if (b.dataset.a === 'up' && i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; }
    if (b.dataset.a === 'del') items.splice(i, 1);
    items = items.map((c, idx) => ({ ...c, orden: idx })); paint();
  };
  $('#catAdd', root).onclick = () => { const nombre = 'Nueva'; const id = uniqueSlug(nombre, items.map((c) => c.id)); items.push({ id, nombre, hue: Math.floor(Math.random() * 360), orden: items.length }); paint(); (list.lastElementChild!.querySelector('input') as HTMLInputElement).select(); };
  $('#catCancel', root).onclick = close;
  $('#catSave', root).onclick = async () => {
    const emptyIdx = items.findIndex((c) => !c.nombre.trim());
    if (emptyIdx >= 0) {
      a.toast('Ponle nombre a la categoría o elimínala');
      (list.children[emptyIdx]?.querySelector('input[data-f="nombre"]') as HTMLInputElement | null)?.focus();
      return;
    }
    const clean = items.filter((c) => c.nombre.trim()).map((c, idx) => ({ ...c, nombre: c.nombre.trim(), orden: idx }));
    close();
    await a.saveCategorias(clean);
  };
}

export function openBolsillosModal(s: AppState, a: Actions) {
  const original = new Map(s.bolsillos.items.map((b) => [b.id, b.nombre]));
  let items: Bolsillo[] = s.bolsillos.items.map((b) => ({ ...b })).sort((x, y) => x.orden - y.orden);
  const { root, close } = mount(`<div class="box"><h2>Bolsillos / medios de pago</h2><p>Renombrar cambia el bolsillo en todas las filas de todos los meses. No se puede borrar uno que algún mes use.</p>
    <div class="catlist" id="bolslist"></div>
    <div class="actions"><button class="btn" id="bolsAdd">+ Nuevo bolsillo</button><span class="push"></span><button class="btn" id="bolsCancel">Cancelar</button><button class="btn primary" id="bolsSave">Guardar</button></div></div>`);
  const list = $('#bolslist', root);
  const paint = () => {
    list.innerHTML = items.map((b, i) => `<div class="catrow bolsrow" data-i="${i}">
      <span class="dot" style="--h:200"></span>
      <input value="${esc(b.nombre)}" data-f="nombre" aria-label="Nombre" enterkeyhint="done">
      <span></span>
      <button class="ib2" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
      <button class="ib2 del" data-a="del" aria-label="Eliminar">✕</button></div>`).join('');
  };
  paint();
  list.oninput = (e) => { const el = e.target as HTMLInputElement; const i = Number((el.closest('.catrow') as HTMLElement).dataset.i); if (el.dataset.f === 'nombre') items[i].nombre = el.value; };
  list.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]'); if (!b) return;
    const i = Number((b.closest('.catrow') as HTMLElement).dataset.i);
    if (b.dataset.a === 'up' && i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; }
    if (b.dataset.a === 'del') items.splice(i, 1);
    items = items.map((x, idx) => ({ ...x, orden: idx })); paint();
  };
  $('#bolsAdd', root).onclick = () => { items.push({ id: uniqueSlug('Nuevo', items.map((b) => b.id)), nombre: 'Nuevo', orden: items.length }); paint(); (list.lastElementChild!.querySelector('input') as HTMLInputElement).select(); };
  $('#bolsCancel', root).onclick = close;
  $('#bolsSave', root).onclick = async () => {
    const emptyIdx = items.findIndex((b) => !b.nombre.trim());
    if (emptyIdx >= 0) { a.toast('Ponle nombre al bolsillo o elimínalo'); (list.children[emptyIdx]?.querySelector('input[data-f="nombre"]') as HTMLInputElement | null)?.focus(); return; }
    const clean = items.map((b, idx) => ({ ...b, nombre: b.nombre.trim(), orden: idx }));
    const lower = clean.map((b) => b.nombre.toLowerCase());
    if (new Set(lower).size !== lower.length) { a.toast('Hay dos bolsillos con el mismo nombre'); return; }
    const renames = clean.filter((b) => original.has(b.id) && original.get(b.id) !== b.nombre).map((b) => ({ from: original.get(b.id)!, to: b.nombre }));
    close();
    await a.saveBolsillos(clean, renames);
  };
}

const HORAS = Array.from({ length: 24 }, (_, h) => [h, `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`] as const);
const fmtAt = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`; };

export function openAvisosModal(s: AppState, a: Actions, api: Api) {
  const { root, close } = mount(`<div class="box avisos" id="avisosBox"><h2>Avisos diarios</h2>
    <p class="nota">Los vencidos y los de hoy llegan uno por uno con botones Pagado y Aplazar; los próximos, en un resumen.</p>
    <h3>Este dispositivo</h3>
    <label class="fila"><input type="checkbox" id="avAqui" disabled> Recibir avisos en este dispositivo</label>
    <div class="nota" id="avAquiNota">Cargando…</div>
    <h3>Dispositivos suscritos</h3>
    <div class="catlist" id="avDevs"></div>
    <h3>Contenido</h3>
    <label class="fila">Hora del aviso <select id="avHora">${HORAS.map(([h, t]) => `<option value="${h}">${t}</option>`).join('')}</select></label>
    <label class="fila">Próximos dentro de <input id="avVentana" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" size="3" enterkeyhint="done"> días</label>
    <label class="fila">Aplazar <input id="avAplazar" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" size="3" enterkeyhint="done"> horas</label>
    <label class="fila">Máximo de avisos individuales <input id="avMax" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" size="3" enterkeyhint="done"></label>
    <label class="fila"><input type="checkbox" id="avVencidas"> Vencidas</label>
    <label class="fila"><input type="checkbox" id="avHoy"> Vencen hoy</label>
    <label class="fila"><input type="checkbox" id="avProximas"> Próximas</label>
    <label class="fila"><input type="checkbox" id="avSiempre"> Avisar aunque no haya nada</label>
    <div class="nota" id="avUltimo"></div>
    <div class="actions"><button class="btn" id="avPrueba" disabled>Enviar prueba</button><button class="btn" id="avAhora" disabled>Enviar ahora</button><span class="push"></span><button class="btn" id="avCancel">Cancelar</button><button class="btn primary" id="avSave" disabled>Guardar</button></div></div>`);
  const aqui = $<HTMLInputElement>('#avAqui', root), nota = $('#avAquiNota', root), devs = $('#avDevs', root), ultimo = $('#avUltimo', root);
  const hora = $<HTMLSelectElement>('#avHora', root), ventana = $<HTMLInputElement>('#avVentana', root);
  const aplazar = $<HTMLInputElement>('#avAplazar', root), maxInd = $<HTMLInputElement>('#avMax', root);
  const prueba = $<HTMLButtonElement>('#avPrueba', root), ahora = $<HTMLButtonElement>('#avAhora', root), guardar = $<HTMLButtonElement>('#avSave', root);
  const chk = (id: string) => $<HTMLInputElement>(id, root);
  let config: AvisosConfig = AVISOS_DEFAULT;
  let info: PushInfo | null = null;
  let localEndpoint: string | null = null;
  let pushError: { code?: string; message: string } | null = null;

  const paintConfig = () => {
    hora.value = String(config.hora); ventana.value = String(config.ventanaDias);
    aplazar.value = String(config.aplazarHoras); maxInd.value = String(config.maxIndividuales);
    chk('#avVencidas').checked = config.incluir.vencidas; chk('#avHoy').checked = config.incluir.hoy; chk('#avProximas').checked = config.incluir.proximas;
    chk('#avSiempre').checked = !config.soloSiHayAlgo;
  };
  const paintDevices = () => {
    if (!info) { devs.innerHTML = ''; return; }
    devs.innerHTML = info.items.length === 0 ? '<div class="nota">Ningún dispositivo suscrito todavía.</div>'
      : info.items.map((d) => `<div class="dev" data-id="${esc(d.id)}"><span>${esc(d.nombre)}${d.endpoint === localEndpoint ? ' <small>(este)</small>' : ''}</span><small>${esc(fmtAt(d.createdAt))}</small><span class="push"></span><button class="ib2 del" data-a="del" aria-label="Quitar ${esc(d.nombre)}">✕</button></div>`).join('');
    const r = info.estado.ultimoResultado;
    ultimo.textContent = r ? `Último aviso: ${fmtAt(r.at)} · ${r.titulo ?? 'sin título'} · ${r.enviadas} enviado${r.enviadas === 1 ? '' : 's'}${r.fallidas ? ` · ${r.fallidas} fallido${r.fallidas === 1 ? '' : 's'}` : ''}` : 'Todavía no se ha enviado ningún aviso.';
  };
  const paintAqui = () => {
    if (!pushSoportado()) { aqui.disabled = true; nota.textContent = 'Este navegador no admite avisos.'; return; }
    if (Notification.permission === 'denied') { aqui.disabled = true; nota.textContent = 'Permiso bloqueado en el navegador: actívalo en los ajustes del sitio.'; return; }
    if (!info) { aqui.disabled = true; nota.textContent = pushError?.code === 'misconfigured' ? 'Las claves de notificaciones no están configuradas.' : `No se pudo cargar: ${pushError?.message ?? 'error desconocido'}`; return; }
    aqui.disabled = false;
    aqui.checked = !!localEndpoint && info.items.some((d) => d.endpoint === localEndpoint);
    nota.textContent = aqui.checked ? 'Este dispositivo recibirá el aviso diario.' : 'Al activarlo, el navegador pedirá permiso para notificaciones.';
  };
  const reload = async () => {
    const [cfg, inf, local] = await Promise.all([
      api.avisos(),
      api.push().catch((e) => { pushError = e as { code?: string; message: string }; return null; }),
      localSubscription().catch(() => null),
    ]);
    config = cfg; info = inf; localEndpoint = local?.endpoint ?? null;
    if (info) pushError = null;
    paintConfig(); paintDevices(); paintAqui();
  };
  void reload()
    .then(() => { prueba.disabled = false; ahora.disabled = false; guardar.disabled = false; })
    .catch((e) => { nota.textContent = `No se pudo cargar: ${(e as Error).message}`; prueba.disabled = false; ahora.disabled = false; });

  aqui.onchange = async () => {
    const on = aqui.checked; aqui.disabled = true;
    try {
      if (on) { if (!info) throw new Error('sin claves'); await api.subscribePush(await subscribeHere(info.publicKey)); a.toast('Avisos activados en este dispositivo'); }
      else {
        const mine = info?.items.find((d) => d.endpoint === localEndpoint);
        if (mine) await api.unsubscribePush(mine.id);
        await (await localSubscription())?.unsubscribe();
        a.toast('Avisos desactivados en este dispositivo');
      }
    } catch (e) { a.toast(`No se pudo cambiar: ${(e as Error).message}`); }
    await reload();
  };
  devs.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a="del"]'); if (!b) return;
    const id = (b.closest('.dev') as HTMLElement).dataset.id!;
    try { await api.unsubscribePush(id); if (info?.items.find((d) => d.id === id)?.endpoint === localEndpoint) await (await localSubscription())?.unsubscribe(); } catch (err) { a.toast(`No se pudo quitar: ${(err as Error).message}`); }
    await reload();
  };
  prueba.onclick = async () => {
    try { const r = await api.pruebaPush(); a.toast(`Prueba enviada a ${r.enviadas} dispositivo${r.enviadas === 1 ? '' : 's'}${r.eliminadas ? ` · ${r.eliminadas} eliminado` : ''}${r.fallidas ? ` · ${r.fallidas} fallido` : ''}`); }
    catch (e) { a.toast((e as Error).message); }
  };
  ahora.onclick = async () => {
    try {
      const r = await api.enviarAviso();
      a.toast(r.skipped === 'nada' ? 'Nada que avisar hoy' : r.skipped === 'sin-suscripciones' ? 'No hay dispositivos suscritos' : r.skipped ? `No se envió: ${r.skipped}` : `Aviso enviado a ${r.enviadas} dispositivo${r.enviadas === 1 ? '' : 's'}${r.eliminadas ? ` · ${r.eliminadas} eliminado` : ''}${r.fallidas ? ` · ${r.fallidas} fallido` : ''}`);
      await reload();
    } catch (e) { a.toast((e as Error).message); }
  };
  $('#avCancel', root).onclick = close;
  guardar.onclick = async () => {
    const entero = (el: HTMLInputElement, min: number, max: number, msg: string): number | null => {
      const n = Number(el.value);
      if (el.value.trim() === '' || !Number.isInteger(n) || n < min || n > max) { a.toast(msg); el.focus(); return null; }
      return n;
    };
    const dias = entero(ventana, 0, 14, 'La ventana debe ser un número de 0 a 14 días'); if (dias === null) return;
    const horas = entero(aplazar, 1, 24, 'Aplazar debe ser un número de 1 a 24 horas'); if (horas === null) return;
    const max = entero(maxInd, 0, 20, 'El máximo de avisos individuales debe ser un número de 0 a 20'); if (max === null) return;
    const doc: AvisosConfig = { version: config.version, hora: Number(hora.value), ventanaDias: dias, incluir: { vencidas: chk('#avVencidas').checked, hoy: chk('#avHoy').checked, proximas: chk('#avProximas').checked }, soloSiHayAlgo: !chk('#avSiempre').checked, aplazarHoras: horas, maxIndividuales: max };
    try { config = await api.putAvisos(doc); a.toast('Avisos guardados'); close(); }
    catch (e) {
      if ((e as { status?: number }).status === 409) { a.toast('La configuración cambió en otro dispositivo; se recargó'); await reload(); }
      else a.toast(`No se pudo guardar: ${(e as Error).message}`);
    }
  };
}
