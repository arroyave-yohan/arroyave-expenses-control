import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { readBody } from './body';
import { AccionSchema, AvisosConfigSchema, PushPruebaSchema, PushSubInputSchema } from './schema';
import { getAvisosConfig, getAvisosEstado, getMonth, getPushDoc, putAvisosConfig, putAvisosEstado, putMonth, putPushDoc } from './kv';
import { enviarATodos, runAvisos, vapidListo, type PushSender } from './push';
import { newId } from '../shared/ids';
import { partesLocales } from '../shared/dates';
import { claveGasto, GASTO_ESTADO_VACIO, type AvisosConfig, type PushSub } from '../shared/avisos';
import type { Bindings, Row } from '../shared/types';

type SenderFor = (env: Bindings) => PushSender;

export function avisosRoutes(senderFor: SenderFor) {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => c.json(await getAvisosConfig(c.env.GASTOS_KV)));
  r.put('/', async (c) => {
    const body = await readBody(c, AvisosConfigSchema);
    if (!body.ok) return body.response;
    const current = await getAvisosConfig(c.env.GASTOS_KV);
    if (current.version !== body.value.version) return c.json({ error: 'conflict', message: 'La configuración cambió en otro dispositivo', current }, 409);
    const doc: AvisosConfig = { ...body.value, version: current.version + 1 };
    await putAvisosConfig(c.env.GASTOS_KV, doc);
    return c.json(doc);
  });
  r.post('/enviar', async (c) => {
    if (!vapidListo(c.env)) return c.json({ error: 'misconfigured', message: 'Faltan las claves VAPID' }, 503);
    return c.json(await runAvisos(c.env, { now: new Date(), sender: senderFor(c.env), force: true }));
  });
  r.get('/estado', async (c) => c.json(await getAvisosEstado(c.env.GASTOS_KV)));

  // Acciones desde los botones de la notificación (service worker) y desde el panel de la fila.
  r.post('/accion', async (c) => {
    const body = await readBody(c, AccionSchema);
    if (!body.ok) return body.response;
    const kv = c.env.GASTOS_KV;
    const a = body.value;
    const now = new Date();
    const [config, estado] = await Promise.all([getAvisosConfig(kv), getAvisosEstado(kv)]);
    const hasta = (horas: number | undefined) => { const h = horas ?? config.aplazarHoras; return h > 0 ? new Date(now.getTime() + h * 3600_000).toISOString() : null; };
    if (a.accion === 'mastarde') {
      const h = hasta(a.horas);
      await putAvisosEstado(kv, { ...estado, resumen: { ...estado.resumen, aplazadoHasta: h } });
      return c.json({ ok: true, hasta: h });
    }
    const doc = await getMonth(kv, a.ym);
    const row = doc?.rows.find((x) => x.id === a.rowId);
    if (!doc || !row) return c.json({ error: 'not_found', message: 'Gasto no encontrado' }, 404);
    const key = claveGasto(a.ym, a.rowId);
    const actual = estado.gastos[key] ?? GASTO_ESTADO_VACIO;
    if (a.accion === 'pagar') {
      let pagada: Row = row;
      if (row.estado !== 'pagado') {
        pagada = { ...row, estado: 'pagado', fechaPago: partesLocales(now).date };
        await putMonth(kv, { ...doc, rows: doc.rows.map((x) => (x.id === row.id ? pagada : x)), version: doc.version + 1, updatedAt: now.toISOString() });
      }
      const { [key]: _quitada, ...gastos } = estado.gastos;
      await putAvisosEstado(kv, { ...estado, gastos });
      return c.json({ ok: true, row: pagada });
    }
    if (a.accion === 'aplazar') {
      const h = hasta(a.horas);
      await putAvisosEstado(kv, { ...estado, gastos: { ...estado.gastos, [key]: { ...actual, aplazadoHasta: h } } });
      return c.json({ ok: true, hasta: h });
    }
    if (!row.fecha) return c.json({ error: 'bad_request', message: 'El gasto no tiene fecha' }, 400);
    await putAvisosEstado(kv, { ...estado, gastos: { ...estado.gastos, [key]: { ...actual, silenciadoFecha: a.valor ? row.fecha : null } } });
    return c.json({ ok: true, silenciado: a.valor });
  });
  return r;
}

export function pushRoutes(senderFor: SenderFor) {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    if (!vapidListo(c.env)) return c.json({ error: 'misconfigured', message: 'Faltan las claves VAPID' }, 503);
    const [doc, estado] = await Promise.all([getPushDoc(c.env.GASTOS_KV), getAvisosEstado(c.env.GASTOS_KV)]);
    return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY, items: doc.items.map(({ keys: _keys, ...rest }) => rest), estado });
  });
  r.post('/', async (c) => {
    if (!vapidListo(c.env)) return c.json({ error: 'misconfigured', message: 'Faltan las claves VAPID' }, 503);
    const body = await readBody(c, PushSubInputSchema);
    if (!body.ok) return body.response;
    const doc = await getPushDoc(c.env.GASTOS_KV);
    const existing = doc.items.find((s) => s.endpoint === body.value.endpoint);
    const sub: PushSub = existing
      ? { ...existing, ...body.value, id: existing.id, createdAt: existing.createdAt }
      : { id: newId('p_'), createdAt: new Date().toISOString(), ...body.value };
    const items = existing ? doc.items.map((s) => (s.id === sub.id ? sub : s)) : [...doc.items, sub];
    if (!existing && doc.items.length >= 20) {
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      items.shift();
    }
    await putPushDoc(c.env.GASTOS_KV, { items });
    return c.json(sub, 201);
  });
  r.delete('/:id', async (c) => {
    const doc = await getPushDoc(c.env.GASTOS_KV);
    const items = doc.items.filter((s) => s.id !== c.req.param('id'));
    if (items.length === doc.items.length) return c.json({ error: 'not_found', message: 'Suscripción no encontrada' }, 404);
    await putPushDoc(c.env.GASTOS_KV, { items });
    return c.body(null, 204);
  });
  r.post('/prueba', async (c) => {
    if (!vapidListo(c.env)) return c.json({ error: 'misconfigured', message: 'Faltan las claves VAPID' }, 503);
    const body = await readBody(c, PushPruebaSchema);
    if (!body.ok) return body.response;
    const doc = await getPushDoc(c.env.GASTOS_KV);
    if (doc.items.length === 0) return c.json({ error: 'sin_suscripciones', message: 'No hay dispositivos suscritos' }, 409);
    if (body.value.id && !doc.items.some((s) => s.id === body.value.id)) return c.json({ error: 'not_found', message: 'Suscripción no encontrada' }, 404);
    const resultado = await enviarATodos(c.env.GASTOS_KV, doc, senderFor(c.env), { title: 'Prueba de avisos', body: 'Los avisos de Gastos funcionan en este dispositivo', url: '/', tag: 'prueba' }, body.value.id ? [body.value.id] : undefined);
    return c.json(resultado);
  });
  return r;
}
