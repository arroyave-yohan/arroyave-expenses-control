import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push';
import type { Bindings, MonthDoc } from '../shared/types';
import { claveGasto, planificarAvisos, podarGastos, GASTO_ESTADO_VACIO, type AvisoGasto, type Aviso, type AvisosEstado, type AvisosResultado, type GastoEstado, type PushDoc, type PushSub, type ResumenEstado } from '../shared/avisos';
import { partesLocales } from '../shared/dates';
import { getAvisosConfig, getAvisosEstado, getIndex, getMonth, getPushDoc, putAvisosEstado, putPushDoc } from './kv';

export type PushData = { title: string; body: string; url: string; tag: string; tipo?: 'gasto' | 'resumen'; actions?: { action: string; title: string }[]; data?: Record<string, unknown> };
export type PushSender = (sub: PushSub, data: PushData) => Promise<{ status: number }>;

const TTL_SEGUNDOS = 6 * 3600;

/** Las tres variables VAPID presentes, con longitud creíble y sin el placeholder de wrangler.jsonc. */
export function vapidListo(env: Bindings): boolean {
  const ok = (v: string | undefined) => typeof v === 'string' && v.length >= 20 && !v.includes('REEMPLAZAR') && !v.includes('genera-la-tuya');
  return ok(env.VAPID_PUBLIC_KEY) && ok(env.VAPID_PRIVATE_KEY) && typeof env.VAPID_SUBJECT === 'string' && env.VAPID_SUBJECT.length > 0;
}

/** Remitente real: cifra (RFC 8291), firma (VAPID, RFC 8292) y hace POST al servicio push del navegador. */
export function createSender(env: Bindings, fetchFn: typeof fetch = (input, init) => fetch(input, init)): PushSender {
  return async (sub, data) => {
    const subscription: PushSubscription = { endpoint: sub.endpoint, expirationTime: sub.expirationTime, keys: sub.keys };
    // `Jsonifiable` no se exporta del paquete; data ya es JSON-serializable en tiempo de ejecución.
    const payload = await buildPushPayload(
      { data: data as any, options: { ttl: TTL_SEGUNDOS, urgency: 'normal' } },
      subscription,
      { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    );
    const res = await fetchFn(sub.endpoint, payload);
    return { status: res.status };
  };
}

/** Envía a todas las suscripciones (o a `ids`) de forma independiente; 404/410 borran la suscripción. */
export async function enviarATodos(kv: KVNamespace, push: PushDoc, sender: PushSender, data: PushData, ids?: string[]): Promise<{ enviadas: number; eliminadas: number; fallidas: number }> {
  const targets = ids ? push.items.filter((s) => ids.includes(s.id)) : push.items;
  const results = await Promise.allSettled(targets.map((s) => sender(s, data)));
  let enviadas = 0, fallidas = 0;
  const muertas = new Set<string>();
  results.forEach((res, i) => {
    if (res.status === 'fulfilled' && res.value.status >= 200 && res.value.status < 300) enviadas++;
    else if (res.status === 'fulfilled' && (res.value.status === 404 || res.value.status === 410)) muertas.add(targets[i].id);
    else { fallidas++; console.error('push falló', targets[i].nombre, res.status === 'fulfilled' ? res.value.status : (res.reason as Error)?.message); }
  });
  if (muertas.size > 0) {
    const fresh = await getPushDoc(kv);
    await putPushDoc(kv, { items: fresh.items.filter((s) => !muertas.has(s.id)) });
  }
  return { enviadas, eliminadas: muertas.size, fallidas };
}

export type RunResultado = { skipped: 'sin-claves' | 'hora' | 'sin-suscripciones' | 'nada' } | AvisosResultado;

const dataDeGasto = (g: AvisoGasto): PushData => ({ title: g.title, body: g.body, url: g.url, tag: g.tag, tipo: 'gasto', actions: g.actions, data: g.data });
const dataDeResumen = (r: Aviso): PushData => ({ title: r.title, body: r.body, url: r.url, tag: r.tag, tipo: 'resumen', actions: r.actions, data: r.data });

/**
 * Corrida horaria. Sin `force`: solo desde la hora configurada; envía las notificaciones debidas (no enviadas hoy o con
 * aplazamiento vencido) y marca cada envío que llegó a algún dispositivo. Con `force` (Enviar ahora): envía todo lo
 * candidato sin tocar las marcas de envío ni aplazamientos.
 */
export async function runAvisos(env: Bindings, deps: { now: Date; sender: PushSender; force?: boolean }): Promise<RunResultado> {
  const kv = env.GASTOS_KV;
  if (!vapidListo(env)) { console.error('avisos: faltan las claves VAPID'); return { skipped: 'sin-claves' }; }
  const [config, estado] = await Promise.all([getAvisosConfig(kv), getAvisosEstado(kv)]);
  const local = partesLocales(deps.now);
  if (!deps.force && local.hour < config.hora) return { skipped: 'hora' };
  let push = await getPushDoc(kv);
  if (push.items.length === 0) return { skipped: 'sin-suscripciones' };
  const docs: MonthDoc[] = [];
  const mesesOmitidos: string[] = [];
  for (const ym of await getIndex(kv)) {
    try { const d = await getMonth(kv, ym); if (d) docs.push(d); } catch (e) { console.error('avisos: mes omitido', ym, (e as Error).message); mesesOmitidos.push(ym); }
  }
  const plan = planificarAvisos(docs, config, estado, deps.now, { todo: !!deps.force });
  if (plan.gastos.length === 0 && !plan.resumen) {
    if (!deps.force) await putAvisosEstado(kv, plan.estado);
    return { skipped: 'nada' };
  }
  const nowIso = deps.now.toISOString();
  let enviadas = 0, eliminadas = 0, fallidas = 0;
  const marcados = new Set<string>(); // claves de gasto a marcar `enviado` (individuales + urgentes del resumen en modo desborde)
  const enviar = async (data: PushData) => {
    const r = await enviarATodos(kv, push, deps.sender, data);
    enviadas += r.enviadas; eliminadas += r.eliminadas; fallidas += r.fallidas;
    if (r.eliminadas > 0) push = await getPushDoc(kv); // no volver a intentar las suscripciones muertas
    return r.enviadas > 0;
  };
  for (const g of plan.gastos) {
    const llego = await enviar(dataDeGasto(g));
    if (llego && !deps.force) marcados.add(g.key);
  }
  let resumenEnviado = false;
  if (plan.resumen) {
    const llego = await enviar(dataDeResumen(plan.resumen));
    if (llego && !deps.force) {
      resumenEnviado = true;
      // Modo desborde: el resumen ya cubrió las urgentes; que no se reenvíen individualmente en la próxima corrida.
      if (plan.modo === 'desborde') for (const it of plan.resumen.items) if (it.tipo !== 'proxima') marcados.add(claveGasto(it.ym, it.rowId));
    }
  }
  const n = plan.gastos.length;
  const resultado: AvisosResultado = {
    at: nowIso, titulo: plan.resumen ? plan.resumen.title : `${n} aviso${n === 1 ? '' : 's'} individual${n === 1 ? '' : 'es'}`,
    enviadas, eliminadas, fallidas, mesesOmitidos, individuales: n, resumen: plan.resumen !== null,
  };
  if (deps.force) { await putAvisosEstado(kv, { ...estado, ultimoResultado: resultado }); return resultado; }
  // Se relee el estado justo antes de escribir: el cron tardó segundos en enviar y el usuario pudo aplazar/silenciar
  // desde una notificación mientras tanto; solo se aplican las marcas nuevas sobre lo que haya ahora, no sobre la instantánea inicial.
  const actual = await getAvisosEstado(kv);
  const gastosFinal: Record<string, GastoEstado> = podarGastos(actual.gastos, docs);
  for (const key of marcados) {
    const base = actual.gastos[key] ?? plan.estado.gastos[key] ?? GASTO_ESTADO_VACIO;
    const aplazadoActual = actual.gastos[key]?.aplazadoHasta;
    gastosFinal[key] = { ...base, enviado: nowIso, aplazadoHasta: (aplazadoActual && aplazadoActual > nowIso) ? aplazadoActual : null };
  }
  const resumenFinal: ResumenEstado = resumenEnviado
    ? { enviado: nowIso, aplazadoHasta: (actual.resumen.aplazadoHasta && actual.resumen.aplazadoHasta > nowIso) ? actual.resumen.aplazadoHasta : null }
    : actual.resumen;
  await putAvisosEstado(kv, { ...actual, gastos: gastosFinal, resumen: resumenFinal, ultimoEnvio: enviadas > 0 ? local.date : actual.ultimoEnvio, ultimoResultado: resultado });
  return resultado;
}
