import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';
import type { BolsillosDoc, MonthDoc, Row } from '../../src/shared/types';

const row = (concepto: string, bolsillo: string): Row => ({
  id: 'r_' + Math.random().toString(36).slice(2, 10), concepto, monto: 1, categoriaId: null, recurrente: true, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo, link: '', ref: '',
});
let A: AuthedApp;
beforeEach(async () => {
  A = await makeAuthedApp();
  for (const k of ['meta:bolsillos', 'meta:categorias', 'month:2026-07', 'month:2026-08', 'index:months']) await env.GASTOS_KV.delete(k);
  await api(A.app, A.headers, 'PUT', '/api/months/2026-07', { version: 0, month: '2026-07', ingresos: 0, rows: [row('Arriendo', 'Nu: Arriendo'), row('Netflix', 'Global66')] });
  await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { version: 0, month: '2026-08', ingresos: 0, rows: [row('Arriendo', 'Nu: Arriendo'), row('Mercado', 'Datafono'), row('Suelto', '')] });
});

describe('GET /api/bolsillos', () => {
  it('siembra desde los meses: nombres distintos, no vacíos, orden alfabético, version 1', async () => {
    const res = await api(A.app, A.headers, 'GET', '/api/bolsillos');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as BolsillosDoc;
    expect(doc.version).toBe(1);
    expect(doc.items.map((b) => b.nombre)).toEqual(['Datafono', 'Global66', 'Nu: Arriendo']);
    expect(doc.items.map((b) => b.id)).toEqual(['datafono', 'global66', 'nu-arriendo']);
    expect(doc.items.map((b) => b.orden)).toEqual([0, 1, 2]);
    expect(await env.GASTOS_KV.get('meta:bolsillos', 'json')).toEqual(doc);
  });
  it('ignora un mes corrupto del índice y siembra con los meses válidos', async () => {
    await env.GASTOS_KV.put('month:2026-06', '{not json');
    const idx = (await env.GASTOS_KV.get<{ months: string[] }>('index:months', 'json'))!;
    await env.GASTOS_KV.put('index:months', JSON.stringify({ months: [...idx.months, '2026-06'] }));
    const res = await api(A.app, A.headers, 'GET', '/api/bolsillos');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as BolsillosDoc;
    expect(doc.items.map((b) => b.nombre)).toEqual(['Datafono', 'Global66', 'Nu: Arriendo']);
  });
});

describe('PUT /api/bolsillos', () => {
  it('agrega e incrementa version; 409 conflict si la version no coincide', async () => {
    const cur = (await (await api(A.app, A.headers, 'GET', '/api/bolsillos')).json()) as BolsillosDoc;
    const items = [...cur.items, { id: 'nequi', nombre: 'Nequi', orden: 3 }];
    const ok = await api(A.app, A.headers, 'PUT', '/api/bolsillos', { version: 1, items });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as BolsillosDoc).version).toBe(2);
    const bad = await api(A.app, A.headers, 'PUT', '/api/bolsillos', { version: 1, items });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: string }).error).toBe('conflict');
  });
  it('409 in_use al eliminar un bolsillo usado, con los meses', async () => {
    const cur = (await (await api(A.app, A.headers, 'GET', '/api/bolsillos')).json()) as BolsillosDoc;
    const res = await api(A.app, A.headers, 'PUT', '/api/bolsillos', { version: 1, items: cur.items.filter((b) => b.nombre !== 'Nu: Arriendo') });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'in_use', bolsillo: 'Nu: Arriendo', months: ['2026-07', '2026-08'], message: 'El bolsillo "Nu: Arriendo" está en uso en: 2026-07, 2026-08' });
  });
  it('permite eliminar uno sin uso y rechaza nombres duplicados o vacíos', async () => {
    const cur = (await (await api(A.app, A.headers, 'GET', '/api/bolsillos')).json()) as BolsillosDoc;
    await api(A.app, A.headers, 'PUT', '/api/months/2026-07', { ...((await (await api(A.app, A.headers, 'GET', '/api/months/2026-07')).json()) as MonthDoc), rows: [row('Arriendo', 'Nu: Arriendo')] });
    const ok = await api(A.app, A.headers, 'PUT', '/api/bolsillos', { version: 1, items: cur.items.filter((b) => b.nombre !== 'Global66') });
    expect(ok.status).toBe(200);
    expect((await api(A.app, A.headers, 'PUT', '/api/bolsillos', { version: 2, items: [{ id: 'a', nombre: 'Nequi', orden: 0 }, { id: 'b', nombre: 'nequi', orden: 1 }] })).status).toBe(400);
    expect((await api(A.app, A.headers, 'PUT', '/api/bolsillos', { version: 2, items: [{ id: 'a', nombre: '  ', orden: 0 }] })).status).toBe(400);
  });
});

describe('POST /api/bolsillos/rename', () => {
  it('reescribe todas las filas de todos los meses, sube la version de cada mes y actualiza la lista', async () => {
    await api(A.app, A.headers, 'GET', '/api/bolsillos');
    const res = await api(A.app, A.headers, 'POST', '/api/bolsillos/rename', { from: 'Nu: Arriendo', to: 'Nu: Casa', version: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bolsillos: BolsillosDoc; months: string[] };
    expect(body.months).toEqual(['2026-07', '2026-08']);
    expect(body.bolsillos.items.map((b) => b.nombre)).toEqual(['Datafono', 'Global66', 'Nu: Casa']);
    expect(body.bolsillos.version).toBe(2);
    const jul = (await (await api(A.app, A.headers, 'GET', '/api/months/2026-07')).json()) as MonthDoc;
    expect(jul.version).toBe(2);
    expect(jul.rows.map((r) => r.bolsillo)).toEqual(['Nu: Casa', 'Global66']);
  });
  it('fusiona si el destino ya existe y no toca meses que no lo usan', async () => {
    await api(A.app, A.headers, 'GET', '/api/bolsillos');
    const res = await api(A.app, A.headers, 'POST', '/api/bolsillos/rename', { from: 'Global66', to: 'Datafono', version: 1 });
    const body = (await res.json()) as { bolsillos: BolsillosDoc; months: string[] };
    expect(body.months).toEqual(['2026-07']);
    expect(body.bolsillos.items.map((b) => b.nombre)).toEqual(['Datafono', 'Nu: Arriendo']);
    const ago = (await (await api(A.app, A.headers, 'GET', '/api/months/2026-08')).json()) as MonthDoc;
    expect(ago.version).toBe(1);
  });
  it('400 si from y to son iguales o vacíos', async () => {
    expect((await api(A.app, A.headers, 'POST', '/api/bolsillos/rename', { from: 'X', to: 'X', version: 1 })).status).toBe(400);
    expect((await api(A.app, A.headers, 'POST', '/api/bolsillos/rename', { from: '', to: 'Y', version: 1 })).status).toBe(400);
  });
  it('500 schema si un mes del índice está corrupto: no escribe ningún mes', async () => {
    await api(A.app, A.headers, 'GET', '/api/bolsillos');
    await env.GASTOS_KV.put('month:2026-06', '{not json');
    const idx = (await env.GASTOS_KV.get<{ months: string[] }>('index:months', 'json'))!;
    await env.GASTOS_KV.put('index:months', JSON.stringify({ months: [...idx.months, '2026-06'] }));
    const res = await api(A.app, A.headers, 'POST', '/api/bolsillos/rename', { from: 'Nu: Arriendo', to: 'Nu: Casa', version: 1 });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('schema');
    const jul = (await (await api(A.app, A.headers, 'GET', '/api/months/2026-07')).json()) as MonthDoc;
    expect(jul.version).toBe(1);
    expect(jul.rows.map((r) => r.bolsillo)).toEqual(['Nu: Arriendo', 'Global66']);
  });
  it('409 conflict si la version no coincide y no reescribe ningún mes', async () => {
    await api(A.app, A.headers, 'GET', '/api/bolsillos');
    const res = await api(A.app, A.headers, 'POST', '/api/bolsillos/rename', { from: 'Nu: Arriendo', to: 'Nu: Casa', version: 7 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('conflict');
    const jul = (await (await api(A.app, A.headers, 'GET', '/api/months/2026-07')).json()) as MonthDoc;
    expect(jul.version).toBe(1);
    expect(jul.rows.map((r) => r.bolsillo)).toEqual(['Nu: Arriendo', 'Global66']);
  });
});
