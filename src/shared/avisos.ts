import type { MonthDoc, Row } from './types';
import { daysBetween, etiquetaMes, partesLocales } from './dates';

export interface AvisosConfig {
  version: number;
  hora: number;            // 0..23, hora local de Colombia
  ventanaDias: number;     // 0..14
  incluir: { vencidas: boolean; hoy: boolean; proximas: boolean };
  soloSiHayAlgo: boolean;
  aplazarHoras: number;    // 1..24
  maxIndividuales: number; // 0..20; 0 = solo resumen
}
export const AVISOS_DEFAULT: AvisosConfig = { version: 0, hora: 8, ventanaDias: 3, incluir: { vencidas: true, hoy: true, proximas: true }, soloSiHayAlgo: true, aplazarHoras: 3, maxIndividuales: 5 };

export interface PushSub {
  id: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  nombre: string;
  createdAt: string;
}
export interface PushDoc { items: PushSub[] }

export interface AvisosResultado { at: string; titulo: string | null; enviadas: number; eliminadas: number; fallidas: number; mesesOmitidos: string[]; individuales: number; resumen: boolean }
/** Estado de aviso de un gasto: último envío (ISO), aplazado hasta (ISO) y fecha para la que está silenciado (YYYY-MM-DD). */
export interface GastoEstado { enviado: string | null; aplazadoHasta: string | null; silenciadoFecha: string | null }
export const GASTO_ESTADO_VACIO: GastoEstado = { enviado: null, aplazadoHasta: null, silenciadoFecha: null };
export interface ResumenEstado { enviado: string | null; aplazadoHasta: string | null }
export interface AvisosEstado { ultimoEnvio: string | null; ultimoResultado: AvisosResultado | null; gastos: Record<string, GastoEstado>; resumen: ResumenEstado }
export const AVISOS_ESTADO_VACIO: AvisosEstado = { ultimoEnvio: null, ultimoResultado: null, gastos: {}, resumen: { enviado: null, aplazadoHasta: null } };
export const claveGasto = (ym: string, rowId: string) => `${ym}/${rowId}`;

export type TipoAviso = 'vencida' | 'hoy' | 'proxima';
export interface AvisoItem { ym: string; rowId: string; concepto: string; monto: number | null; fecha: string; dias: number; tipo: TipoAviso }
export type AccionGasto = 'pagar' | 'aplazar';
export type AccionResumen = 'mastarde' | 'ver';
export interface AvisoGasto {
  tipo: 'gasto'; key: string; ym: string; rowId: string; concepto: string;
  title: string; body: string; url: string; tag: string;
  actions: { action: AccionGasto; title: string }[];
  data: { ym: string; rowId: string; concepto: string; horas: number };
}
export interface Aviso {
  tipo: 'resumen'; title: string; body: string; url: string; tag: 'aviso-diario';
  counts: Record<TipoAviso, number>; items: AvisoItem[];
  actions: { action: AccionResumen; title: string }[];
  data: { horas: number };
}
export interface Plan { gastos: AvisoGasto[]; resumen: Aviso | null; estado: AvisosEstado; modo: 'individual' | 'desborde' }

/** Cuerpo de POST /api/avisos/accion y su respuesta (compartidos por el Worker, el SW y la app). */
export type AccionAviso =
  | { accion: 'pagar'; ym: string; rowId: string }
  | { accion: 'aplazar'; ym: string; rowId: string; horas?: number }
  | { accion: 'silenciar'; ym: string; rowId: string; valor: boolean }
  | { accion: 'mastarde'; horas?: number };
export interface AccionRespuesta { ok: true; row?: Row; hasta?: string | null; silenciado?: boolean }

export const MAX_LINEAS = 6;
const ORDEN: Record<TipoAviso, number> = { vencida: 0, hoy: 1, proxima: 2 };
const monto = (n: number | null) => (n === null ? 'sin monto' : '$ ' + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

export function etiquetaDias(dias: number): string {
  if (dias < -1) return `venció hace ${-dias} d`;
  if (dias === -1) return 'venció ayer';
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  return `vence en ${dias} d`;
}

/** Filas con fecha y no pagadas, clasificadas para `today` y ordenadas: vencidas → hoy → próximas, por fecha y concepto. */
function candidatas(docs: MonthDoc[], config: AvisosConfig, today: string): AvisoItem[] {
  const incluido: Record<TipoAviso, boolean> = { vencida: config.incluir.vencidas, hoy: config.incluir.hoy, proxima: config.incluir.proximas };
  const items: AvisoItem[] = [];
  for (const doc of docs) {
    for (const r of doc.rows) {
      if (!r.fecha || r.estado === 'pagado') continue;
      const dias = daysBetween(today, r.fecha);
      const tipo: TipoAviso | null = dias < 0 ? 'vencida' : dias === 0 ? 'hoy' : dias <= config.ventanaDias ? 'proxima' : null;
      if (!tipo || !incluido[tipo]) continue;
      items.push({ ym: doc.month, rowId: r.id, concepto: r.concepto, monto: r.monto, fecha: r.fecha, dias, tipo });
    }
  }
  return items.sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo] || a.fecha.localeCompare(b.fecha) || a.concepto.localeCompare(b.concepto, 'es'));
}

/** Claves (ym/rowId) de filas con fecha y no pagadas en los meses cargados: más amplio que `candidatas` (ignora ventana e `incluir`), para no perder silencios/aplazamientos de filas que salieron de la ventana. */
function clavesVigentes(docs: MonthDoc[]): Set<string> {
  const s = new Set<string>();
  for (const doc of docs) for (const r of doc.rows) if (r.fecha && r.estado !== 'pagado') s.add(claveGasto(doc.month, r.id));
  return s;
}

/** Poda un registro de estados de gasto a las claves vigentes (ver `clavesVigentes`); borra pagadas e inexistentes. */
export function podarGastos(gastos: Record<string, GastoEstado>, docs: MonthDoc[]): Record<string, GastoEstado> {
  const vigentes = clavesVigentes(docs);
  const out: Record<string, GastoEstado> = {};
  for (const key of vigentes) { const e = gastos[key]; if (e) out[key] = e; }
  return out;
}

const ACCIONES_RESUMEN: Aviso['actions'] = [{ action: 'mastarde', title: 'Más tarde' }, { action: 'ver', title: 'Ver' }];

/** Resumen (una sola notificación) con los ítems dados; vacío → "sin vencimientos". */
function armarResumen(items: AvisoItem[], config: AvisosConfig): Aviso {
  const counts: Record<TipoAviso, number> = { vencida: 0, hoy: 0, proxima: 0 };
  for (const i of items) counts[i.tipo]++;
  const base = { tipo: 'resumen' as const, tag: 'aviso-diario' as const, counts, items, actions: ACCIONES_RESUMEN, data: { horas: config.aplazarHoras } };
  if (items.length === 0) return { ...base, title: 'Gastos: sin vencimientos', body: `Nada con fecha en los próximos ${config.ventanaDias} días`, url: '/' };
  const partes: string[] = [];
  if (counts.vencida) partes.push(plural(counts.vencida, 'vencida', 'vencidas'));
  if (counts.hoy) partes.push(`${counts.hoy} hoy`);
  if (counts.proxima) partes.push(plural(counts.proxima, 'próxima', 'próximas'));
  const lineas = items.slice(0, MAX_LINEAS).map((i) => `${i.concepto} · ${monto(i.monto)} · ${etiquetaDias(i.dias)}`);
  if (items.length > MAX_LINEAS) lineas.push(`… y ${items.length - MAX_LINEAS} más`);
  return { ...base, title: `Gastos: ${partes.join(' · ')}`, body: lineas.join('\n'), url: `/#${items[0].ym}` };
}

function avisoGasto(it: AvisoItem, horas: number): AvisoGasto {
  return {
    tipo: 'gasto', key: claveGasto(it.ym, it.rowId), ym: it.ym, rowId: it.rowId, concepto: it.concepto,
    title: `${it.concepto} · ${monto(it.monto)}`, body: `${etiquetaDias(it.dias)} · ${etiquetaMes(it.ym)}`, url: `/#${it.ym}`, tag: `gasto-${it.rowId}`,
    actions: [{ action: 'pagar', title: 'Pagado' }, { action: 'aplazar', title: `Aplazar ${horas} h` }],
    data: { ym: it.ym, rowId: it.rowId, concepto: it.concepto, horas },
  };
}

/** Resumen único con todas las candidatas (se conserva para pruebas y como referencia). Null = nada que avisar. */
export function construirAviso(docs: MonthDoc[], config: AvisosConfig, today: string): Aviso | null {
  const items = candidatas(docs, config, today);
  if (items.length === 0 && config.soloSiHayAlgo) return null;
  return armarResumen(items, config);
}

/**
 * Decide qué notificaciones están debidas ahora. Urgentes (vencida/hoy) van una por gasto si no superan
 * `maxIndividuales`; si no, todo va al resumen. Cada notificación es debida si no se envió hoy o si venció su aplazamiento.
 * `todo` (Enviar ahora) ignora envíos y aplazamientos pero respeta silencios. El estado devuelto viene podado a las filas
 * vigentes (con fecha y no pagadas en los meses cargados), no solo a las candidatas de esta corrida (ver `podarGastos`).
 */
export function planificarAvisos(docs: MonthDoc[], config: AvisosConfig, estado: AvisosEstado, now: Date, opts: { todo?: boolean } = {}): Plan {
  const today = partesLocales(now).date;
  const todas = candidatas(docs, config, today);
  const gastos = podarGastos(estado.gastos, docs);
  const estadoNuevo: AvisosEstado = { ...estado, gastos };
  const vigente = (hasta: string | null) => hasta !== null && new Date(hasta).getTime() > now.getTime();
  const debido = (e: { enviado: string | null; aplazadoHasta: string | null } | undefined) => {
    if (opts.todo || !e) return true;
    if (e.aplazadoHasta) return !vigente(e.aplazadoHasta);
    return !e.enviado || partesLocales(new Date(e.enviado)).date !== today;
  };
  const visibles = todas.filter((it) => {
    const e = gastos[claveGasto(it.ym, it.rowId)];
    if (!e) return true;
    if (e.silenciadoFecha === it.fecha) return false;
    return opts.todo || !vigente(e.aplazadoHasta);
  });
  const urgentes = visibles.filter((i) => i.tipo !== 'proxima');
  const proximas = visibles.filter((i) => i.tipo === 'proxima');
  const individual = urgentes.length > 0 && urgentes.length <= config.maxIndividuales;
  const gastosDebidos = individual ? urgentes.filter((it) => debido(gastos[claveGasto(it.ym, it.rowId)])).map((it) => avisoGasto(it, config.aplazarHoras)) : [];
  const enResumen = individual ? proximas : visibles;
  let resumen: Aviso | null = null;
  if ((enResumen.length > 0 || (!config.soloSiHayAlgo && visibles.length === 0)) && debido(estado.resumen)) resumen = armarResumen(enResumen, config);
  return { gastos: gastosDebidos, resumen, estado: estadoNuevo, modo: individual ? 'individual' : 'desborde' };
}
