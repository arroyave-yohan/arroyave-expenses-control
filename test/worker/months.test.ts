import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';
import { getMonth, getIndex } from '../../src/worker/kv';
import type { MonthDoc, Row } from '../../src/shared/types';

const row = (p: Partial<Row> = {}): Row => ({
  id: 'r_' + Math.random().toString(36).slice(2, 10), concepto: 'Arriendo', monto: 1250000, categoriaId: 'vivienda',
  recurrente: true, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: 'Nu: Arriendo', link: '', ref: '', ...p,
});
const input = (p: Partial<MonthDoc> = {}) => ({ version: 0, month: '2026-08', ingresos: 12400000, rows: [row()], ...p });

let A: AuthedApp;
beforeEach(async () => {
  // @cloudflare/vitest-pool-workers isolates storage per test FILE, not per `it()`
  // (see https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/).
  // Clear the keys this file's tests reuse so each test starts from a clean slate.
  await env.GASTOS_KV.delete('month:2026-08');
  await env.GASTOS_KV.delete('month:2026-09');
  await env.GASTOS_KV.delete('index:months');
  A = await makeAuthedApp();
});

describe('GET /api/months', () => {
  it('vacío al inicio', async () => {
    const res = await api(A.app, A.headers, 'GET', '/api/months');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ months: [] });
  });
});

describe('PUT /api/months/:ym', () => {
  it('crea el mes con version 1, updatedAt del servidor y lo indexa', async () => {
    const res = await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input({ rows: [row({ bolsillo: '  Datafono ' })] }));
    expect(res.status).toBe(200);
    const doc = (await res.json()) as MonthDoc;
    expect(doc.version).toBe(1);
    expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0].bolsillo).toBe('Datafono');
    expect(await getIndex(env.GASTOS_KV)).toEqual(['2026-08']);
    expect(await getMonth(env.GASTOS_KV, '2026-08')).toEqual(doc);
  });

  it('incrementa version cuando la enviada coincide', async () => {
    const first = (await (await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input())).json()) as MonthDoc;
    const res = await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { ...input(), version: first.version, ingresos: 1 });
    expect(res.status).toBe(200);
    const doc = (await res.json()) as MonthDoc;
    expect(doc.version).toBe(2);
    expect(doc.ingresos).toBe(1);
  });

  it('409 con el documento actual si la version no coincide', async () => {
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input());
    const res = await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { ...input(), version: 0, ingresos: 5 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; current: MonthDoc };
    expect(body.error).toBe('conflict');
    expect(body.current.version).toBe(1);
    expect(body.current.ingresos).toBe(12400000);
  });

  it('400 si el body no valida, si month no coincide con la URL o si ym es inválido', async () => {
    expect((await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { ...input(), rows: [{ ...row(), monto: 1.5 }] })).status).toBe(400);
    expect((await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input({ month: '2026-09' }))).status).toBe(400);
    expect((await api(A.app, A.headers, 'PUT', '/api/months/2026-13', input({ month: '2026-13' }))).status).toBe(400);
  });

  it('400 unknown_categoria si una fila usa una categoría inexistente', async () => {
    const res = await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input({ rows: [row({ categoriaId: 'mascotas' })] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unknown_categoria');
  });

  it('acepta categoriaId null', async () => {
    const res = await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input({ rows: [row({ categoriaId: null })] }));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/months/:ym', () => {
  it('404 si no existe, 400 si ym inválido, 200 con el doc', async () => {
    expect((await api(A.app, A.headers, 'GET', '/api/months/2026-08')).status).toBe(404);
    expect((await api(A.app, A.headers, 'GET', '/api/months/agosto')).status).toBe(400);
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input());
    const res = await api(A.app, A.headers, 'GET', '/api/months/2026-08');
    expect(res.status).toBe(200);
    expect(((await res.json()) as MonthDoc).month).toBe('2026-08');
  });
});

describe('DELETE /api/months/:ym', () => {
  it('204 y quita del índice; 404 si no existe', async () => {
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', input());
    await api(A.app, A.headers, 'PUT', '/api/months/2026-09', input({ month: '2026-09' }));
    const res = await api(A.app, A.headers, 'DELETE', '/api/months/2026-08');
    expect(res.status).toBe(204);
    expect(await getIndex(env.GASTOS_KV)).toEqual(['2026-09']);
    expect((await api(A.app, A.headers, 'DELETE', '/api/months/2026-08')).status).toBe(404);
  });
});
