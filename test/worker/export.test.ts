import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';
import { toCsv } from '../../src/worker/export';
import { SEED_CATEGORIAS } from '../../src/worker/seed';
import type { MonthDoc } from '../../src/shared/types';

const doc: MonthDoc = {
  version: 1, month: '2026-08', ingresos: 10, updatedAt: '2026-08-01T00:00:00Z',
  rows: [
    { id: 'r_1', concepto: 'Arriendo, casa', monto: 1200000, categoriaId: 'vivienda', recurrente: true, estado: 'pagado', fecha: null, fechaPago: '2026-08-05', bolsillo: 'Nu: Arriendo', link: 'Nequi: 300 000 0000', ref: '' },
    { id: 'r_2', concepto: 'Dice "hola"', monto: null, categoriaId: null, recurrente: false, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: 'A1' },
  ],
};

describe('toCsv', () => {
  it('escapa comas y comillas, deja monto vacío si es null y usa el nombre de categoría', () => {
    const csv = toCsv([doc], SEED_CATEGORIAS);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('month,id,concepto,monto,categoria,recurrente,estado,fecha,fechaPago,bolsillo,link,ref');
    expect(lines[1]).toBe('2026-08,r_1,"Arriendo, casa",1200000,Vivienda,true,pagado,,2026-08-05,Nu: Arriendo,Nequi: 300 000 0000,');
    expect(lines[2]).toBe('2026-08,r_2,"Dice ""hola""",,,false,pendiente,,,,,A1');
    expect(lines).toHaveLength(3);
  });
});

let A: AuthedApp;
beforeEach(async () => {
  // @cloudflare/vitest-pool-workers isolates storage per test FILE, not per `it()`
  // (see https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/).
  // Clear the keys this file's tests reuse so each test starts from a clean slate.
  await env.GASTOS_KV.delete('month:2026-08');
  await env.GASTOS_KV.delete('index:months');
  await env.GASTOS_KV.delete('meta:categorias');
  A = await makeAuthedApp();
});

describe('GET /api/export', () => {
  it('devuelve JSON con todos los meses y categorías', async () => {
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { version: 0, month: '2026-08', ingresos: 10, rows: doc.rows });
    const res = await api(A.app, A.headers, 'GET', '/api/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="expenses-control-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = (await res.json()) as { exportedAt: string; categorias: { version: number }; months: MonthDoc[] };
    expect(body.months.map((m) => m.month)).toEqual(['2026-08']);
    expect(body.categorias.version).toBe(1);
  });

  it('con format=csv devuelve text/csv', async () => {
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { version: 0, month: '2026-08', ingresos: 10, rows: doc.rows });
    const res = await api(A.app, A.headers, 'GET', '/api/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/csv/);
    expect(res.headers.get('Content-Disposition')).toMatch(/\.csv"$/);
    const text = await res.text();
    expect(text.split('\r\n')).toHaveLength(3);
  });
});
