import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createLocalJWKSet } from 'jose';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';
import { createApp } from '../../src/worker/index';
import type { PushSender } from '../../src/worker/push';
import { keys, putPushDoc, putMonth, addToIndex, getAvisosEstado, putAvisosEstado, getMonth } from '../../src/worker/kv';
import { AVISOS_DEFAULT, AVISOS_ESTADO_VACIO, claveGasto, type PushSub } from '../../src/shared/avisos';
import { partesLocales } from '../../src/shared/dates';
import type { Bindings, MonthDoc, Row } from '../../src/shared/types';

const SUB_INPUT = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'BPk', auth: 'aut' }, nombre: 'Android · Chrome' };
const sub = (id: string): PushSub => ({ id, endpoint: `https://push.example/${id}`, expirationTime: null, keys: { p256dh: 'k', auth: 'a' }, nombre: id, createdAt: '2026-09-01T00:00:00.000Z' });
const row = (concepto: string, fecha: string): Row => ({ id: 'r_' + concepto.toLowerCase(), concepto, monto: 5000, categoriaId: null, recurrente: true, estado: 'pendiente', fecha, fechaPago: null, bolsillo: '', link: '', ref: '' });
const month = (ym: string, ...rows: Row[]): MonthDoc => ({ version: 1, month: ym, ingresos: 0, updatedAt: '2026-09-01T00:00:00.000Z', rows });

let A: AuthedApp;
let sent: { id: string; title: string; tag: string }[];
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  A = await makeAuthedApp();
  sent = [];
  const sender: PushSender = async (s, d) => { sent.push({ id: s.id, title: d.title, tag: d.tag }); return { status: s.id === 'muerta' ? 410 : 201 }; };
  app = createApp({ getKey: A.publicJwk ? createLocalJWKSet({ keys: [A.publicJwk] }) : undefined, sender });
  for (const k of [keys.avisos, keys.push, keys.avisosEstado, keys.index, 'month:2026-09']) await env.GASTOS_KV.delete(k);
});
const sinClaves = { ...env, VAPID_PRIVATE_KEY: '' } as Bindings;

describe('/api/avisos', () => {
  it('GET devuelve la configuración por defecto', async () => {
    const res = await api(app, A.headers, 'GET', '/api/avisos');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(AVISOS_DEFAULT);
  });
  it('PUT guarda con version+1 y 409 si la versión no coincide; 400 si es inválido', async () => {
    const res = await api(app, A.headers, 'PUT', '/api/avisos', { ...AVISOS_DEFAULT, hora: 18, ventanaDias: 5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 1, hora: 18, ventanaDias: 5 });
    const stale = await api(app, A.headers, 'PUT', '/api/avisos', { ...AVISOS_DEFAULT, version: 0, hora: 7 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'conflict', current: { version: 1, hora: 18 } });
    const bad = await api(app, A.headers, 'PUT', '/api/avisos', { ...AVISOS_DEFAULT, version: 1, hora: 24 });
    expect(bad.status).toBe(400);
  });
  it('POST /enviar fuerza el envío y devuelve el resultado; 503 sin claves', async () => {
    await putMonth(env.GASTOS_KV, month('2026-09', row('Arriendo', '2026-09-22')));
    await addToIndex(env.GASTOS_KV, '2026-09');
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const res = await api(app, A.headers, 'POST', '/api/avisos/enviar');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enviadas: 1, eliminadas: 0, fallidas: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].tag).toBe('gasto-r_arriendo');
    const off = await api(app, A.headers, 'POST', '/api/avisos/enviar', undefined, sinClaves);
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ error: 'misconfigured' });
  });
  it('exige Access', async () => {
    expect((await app.request('/api/avisos', {}, env)).status).toBe(401);
  });
});

describe('/api/push', () => {
  it('GET expone la clave pública, los dispositivos sin claves y el estado', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const res = await api(app, A.headers, 'GET', '/api/push');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicKey: string; items: Record<string, unknown>[]; estado: { ultimoEnvio: string | null } };
    expect(body.publicKey).toBe(env.VAPID_PUBLIC_KEY);
    expect(body.items).toEqual([{ id: 'a', endpoint: 'https://push.example/a', expirationTime: null, nombre: 'a', createdAt: '2026-09-01T00:00:00.000Z' }]);
    expect(body.estado).toEqual(AVISOS_ESTADO_VACIO);
    expect((await api(app, A.headers, 'GET', '/api/push', undefined, sinClaves)).status).toBe(503);
  });
  it('POST crea (201) y hace upsert por endpoint conservando id y createdAt', async () => {
    const off = await api(app, A.headers, 'POST', '/api/push', SUB_INPUT, sinClaves);
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ error: 'misconfigured' });
    const res = await api(app, A.headers, 'POST', '/api/push', SUB_INPUT);
    expect(res.status).toBe(201);
    const created = (await res.json()) as PushSub;
    expect(created.id).toMatch(/^p_[a-z0-9]{8}$/);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const again = await api(app, A.headers, 'POST', '/api/push', { ...SUB_INPUT, nombre: 'Tablet', keys: { p256dh: 'nuevo', auth: 'x' } });
    expect(again.status).toBe(201);
    const updated = (await again.json()) as PushSub;
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.nombre).toBe('Tablet');
    expect(updated.keys.p256dh).toBe('nuevo');
    const list = (await (await api(app, A.headers, 'GET', '/api/push')).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(1);
  });
  it('POST con 21 suscripciones nuevas mantiene el límite de 20 y descarta la más antigua', async () => {
    const items: PushSub[] = [];
    for (let i = 0; i < 20; i++) {
      items.push({ id: `p_${i}`, endpoint: `https://push.example/${i}`, expirationTime: null, keys: { p256dh: 'k', auth: 'a' }, nombre: `d${i}`, createdAt: `2026-09-01T00:00:${String(i).padStart(2, '0')}.000Z` });
    }
    await putPushDoc(env.GASTOS_KV, { items });
    const res = await api(app, A.headers, 'POST', '/api/push', { ...SUB_INPUT, endpoint: 'https://fcm.googleapis.com/fcm/send/nuevo-21' });
    expect(res.status).toBe(201);
    const nueva = (await res.json()) as PushSub;
    const list = (await (await api(app, A.headers, 'GET', '/api/push')).json()) as { items: { id: string }[] };
    expect(list.items).toHaveLength(20);
    const ids = list.items.map((s) => s.id);
    expect(ids).not.toContain('p_0');
    expect(ids).toContain(nueva.id);
  });
  it('POST valida: endpoint http o sin keys → 400', async () => {
    expect((await api(app, A.headers, 'POST', '/api/push', { ...SUB_INPUT, endpoint: 'http://x' })).status).toBe(400);
    expect((await api(app, A.headers, 'POST', '/api/push', { endpoint: SUB_INPUT.endpoint, nombre: 'x' })).status).toBe(400);
  });
  it('DELETE /:id quita la suscripción; 404 si no existe', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('a'), sub('b')] });
    expect((await api(app, A.headers, 'DELETE', '/api/push/a')).status).toBe(204);
    const list = (await (await api(app, A.headers, 'GET', '/api/push')).json()) as { items: { id: string }[] };
    expect(list.items.map((s) => s.id)).toEqual(['b']);
    expect((await api(app, A.headers, 'DELETE', '/api/push/zzz')).status).toBe(404);
  });
  it('POST /prueba envía "Prueba de avisos" a todas o a una; 409 sin suscripciones', async () => {
    expect((await api(app, A.headers, 'POST', '/api/push/prueba', {}, sinClaves)).status).toBe(503);
    expect((await api(app, A.headers, 'POST', '/api/push/prueba', {})).status).toBe(409);
    expect(await (await api(app, A.headers, 'POST', '/api/push/prueba', {})).json()).toMatchObject({ error: 'sin_suscripciones' });
    await putPushDoc(env.GASTOS_KV, { items: [sub('a'), sub('muerta')] });
    const all = await api(app, A.headers, 'POST', '/api/push/prueba', {});
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ enviadas: 1, eliminadas: 1, fallidas: 0 });
    expect(sent.map((s) => s.title)).toEqual(['Prueba de avisos', 'Prueba de avisos']);
    expect(sent[0].tag).toBe('prueba');
    sent = [];
    const one = await api(app, A.headers, 'POST', '/api/push/prueba', { id: 'a' });
    expect(await one.json()).toEqual({ enviadas: 1, eliminadas: 0, fallidas: 0 });
    expect((await api(app, A.headers, 'POST', '/api/push/prueba', { id: 'nope' })).status).toBe(404);
  });
});

describe('/api/avisos/estado y /api/avisos/accion', () => {
  const rowSinFecha = (): Row => ({ ...row('Suelto', '2026-09-22'), id: 'r_suelto', fecha: null });
  beforeEach(async () => {
    await putMonth(env.GASTOS_KV, month('2026-09', row('Arriendo', '2026-09-22'), row('Luz', '2026-09-20'), rowSinFecha()));
    await addToIndex(env.GASTOS_KV, '2026-09');
  });
  const accion = (body: unknown, bindings?: Bindings) => api(app, A.headers, 'POST', '/api/avisos/accion', body, bindings);
  const cercaDe = (iso: string | null, horas: number) => { expect(iso).not.toBeNull(); expect(Math.abs(new Date(iso!).getTime() - (Date.now() + horas * 3600_000))).toBeLessThan(60_000); };

  it('GET /estado devuelve el estado (vacío por defecto) sin exigir claves VAPID', async () => {
    const res = await api(app, A.headers, 'GET', '/api/avisos/estado', undefined, sinClaves);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(AVISOS_ESTADO_VACIO);
  });
  it('pagar: marca pagado con fecha de hoy, sube la versión, poda el estado y es idempotente', async () => {
    await putAvisosEstado(env.GASTOS_KV, { ...AVISOS_ESTADO_VACIO, gastos: { [claveGasto('2026-09', 'r_luz')]: { enviado: 'x', aplazadoHasta: null, silenciadoFecha: null }, [claveGasto('2026-09', 'r_arriendo')]: { enviado: 'y', aplazadoHasta: null, silenciadoFecha: null } } });
    const res = await accion({ accion: 'pagar', ym: '2026-09', rowId: 'r_luz' });
    expect(res.status).toBe(200);
    const hoy = partesLocales(new Date()).date;
    expect(await res.json()).toMatchObject({ ok: true, row: { id: 'r_luz', estado: 'pagado', fechaPago: hoy } });
    const doc = (await getMonth(env.GASTOS_KV, '2026-09'))!;
    expect(doc.version).toBe(2);
    expect(doc.rows.find((r) => r.id === 'r_luz')).toMatchObject({ estado: 'pagado', fechaPago: hoy });
    expect(doc.rows.find((r) => r.id === 'r_arriendo')?.estado).toBe('pendiente');
    expect(Object.keys((await getAvisosEstado(env.GASTOS_KV)).gastos)).toEqual([claveGasto('2026-09', 'r_arriendo')]);
    const again = await accion({ accion: 'pagar', ym: '2026-09', rowId: 'r_luz' });
    expect(again.status).toBe(200);
    expect((await getMonth(env.GASTOS_KV, '2026-09'))!.version).toBe(2);
  });
  it('pagar: 404 si el mes o la fila no existen', async () => {
    expect((await accion({ accion: 'pagar', ym: '2026-09', rowId: 'r_nope' })).status).toBe(404);
    expect((await accion({ accion: 'pagar', ym: '2026-01', rowId: 'r_luz' })).status).toBe(404);
  });
  it('aplazar: por defecto aplazarHoras, con horas explícitas, y horas 0 lo quita', async () => {
    const r1 = (await (await accion({ accion: 'aplazar', ym: '2026-09', rowId: 'r_luz' })).json()) as { ok: boolean; hasta: string | null };
    cercaDe(r1.hasta, 3);
    expect((await getAvisosEstado(env.GASTOS_KV)).gastos[claveGasto('2026-09', 'r_luz')].aplazadoHasta).toBe(r1.hasta);
    const r2 = (await (await accion({ accion: 'aplazar', ym: '2026-09', rowId: 'r_luz', horas: 1 })).json()) as { hasta: string | null };
    cercaDe(r2.hasta, 1);
    const r3 = (await (await accion({ accion: 'aplazar', ym: '2026-09', rowId: 'r_luz', horas: 0 })).json()) as { hasta: string | null };
    expect(r3.hasta).toBeNull();
    expect((await getAvisosEstado(env.GASTOS_KV)).gastos[claveGasto('2026-09', 'r_luz')].aplazadoHasta).toBeNull();
    expect((await accion({ accion: 'aplazar', ym: '2026-09', rowId: 'r_nope' })).status).toBe(404);
  });
  it('silenciar: guarda la fecha de la fila, se puede quitar, y 400 si la fila no tiene fecha', async () => {
    const on = await accion({ accion: 'silenciar', ym: '2026-09', rowId: 'r_luz', valor: true });
    expect(await on.json()).toEqual({ ok: true, silenciado: true });
    expect((await getAvisosEstado(env.GASTOS_KV)).gastos[claveGasto('2026-09', 'r_luz')].silenciadoFecha).toBe('2026-09-20');
    const off = await accion({ accion: 'silenciar', ym: '2026-09', rowId: 'r_luz', valor: false });
    expect(await off.json()).toEqual({ ok: true, silenciado: false });
    expect((await getAvisosEstado(env.GASTOS_KV)).gastos[claveGasto('2026-09', 'r_luz')].silenciadoFecha).toBeNull();
    expect((await accion({ accion: 'silenciar', ym: '2026-09', rowId: 'r_suelto', valor: true })).status).toBe(400);
  });
  it('mastarde: aplaza el resumen; horas 0 lo quita', async () => {
    const r = (await (await accion({ accion: 'mastarde' })).json()) as { hasta: string | null };
    cercaDe(r.hasta, 3);
    expect((await getAvisosEstado(env.GASTOS_KV)).resumen.aplazadoHasta).toBe(r.hasta);
    expect(((await (await accion({ accion: 'mastarde', horas: 0 })).json()) as { hasta: string | null }).hasta).toBeNull();
  });
  it('valida el cuerpo y exige Access', async () => {
    expect((await accion({ accion: 'borrar' })).status).toBe(400);
    expect((await accion({ accion: 'silenciar', ym: '2026-09', rowId: 'r_luz' })).status).toBe(400);
    expect((await app.request('/api/avisos/accion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'mastarde' }) }, env)).status).toBe(401);
  });
});
