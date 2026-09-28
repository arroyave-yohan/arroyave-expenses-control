import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';
import { buildDuplicate } from '../../src/worker/months';
import { getIndex } from '../../src/worker/kv';
import type { MonthDoc, Row } from '../../src/shared/types';

const row = (p: Partial<Row> = {}): Row => ({
  id: 'r_' + Math.random().toString(36).slice(2, 10), concepto: 'X', monto: 100, categoriaId: null,
  recurrente: true, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '', ...p,
});
const source: MonthDoc = {
  version: 4, month: '2026-08', ingresos: 12400000, updatedAt: '2026-08-30T00:00:00Z',
  rows: [
    row({ id: 'r_aaaaaaaa', concepto: 'Arriendo', monto: 1200000, estado: 'pagado', fecha: null, fechaPago: '2026-08-05' }),
    row({ id: 'r_bbbbbbbb', concepto: 'Viaje', monto: 500000, recurrente: false, estado: 'separado' }),
    row({ id: 'r_cccccccc', concepto: 'Mercado', monto: null }),
  ],
};
const defaults = { target: '2026-09', soloRecurrentes: true, resetEstado: true, mantenerMontos: true, mantenerIngresos: true, reemplazar: false };

describe('buildDuplicate', () => {
  it('traslada la fecha límite al mismo día del mes destino, o al último día si no existe', () => {
    const src = { ...source, rows: [row({ id: 'r_f1', fecha: '2026-08-31' }), row({ id: 'r_f2', fecha: '2026-08-05' }), row({ id: 'r_f3', fecha: null })] };
    const d = buildDuplicate(src, '2026-09', defaults, 'now');
    expect(d.rows.map((r) => r.fecha)).toEqual(['2026-09-30', '2026-09-05', null]);
    const f = buildDuplicate({ ...src, rows: [row({ fecha: '2026-01-31' })] }, '2026-02', defaults, 'now');
    expect(f.rows[0].fecha).toBe('2026-02-28');
  });
  it('con opciones por defecto copia solo recurrentes, resetea estado y fecha, regenera ids', () => {
    const d = buildDuplicate(source, '2026-09', defaults, '2026-09-01T00:00:00Z');
    expect(d.month).toBe('2026-09');
    expect(d.version).toBe(0);
    expect(d.ingresos).toBe(12400000);
    expect(d.rows.map((r) => r.concepto)).toEqual(['Arriendo', 'Mercado']);
    expect(d.rows.every((r) => r.estado === 'pendiente' && r.fechaPago === null)).toBe(true);
    expect(d.rows[0].monto).toBe(1200000);
    expect(d.rows.map((r) => r.id)).not.toContain('r_aaaaaaaa');
    expect(new Set(d.rows.map((r) => r.id)).size).toBe(2);
  });

  it('sin resetEstado conserva estado y fechaPago; sin mantenerMontos pone null; sin mantenerIngresos pone 0', () => {
    const d = buildDuplicate(source, '2026-09', { ...defaults, soloRecurrentes: false, resetEstado: false, mantenerMontos: false, mantenerIngresos: false }, 'now');
    expect(d.rows).toHaveLength(3);
    expect(d.rows[0].estado).toBe('pagado');
    expect(d.rows[0].fechaPago).toBe('2026-08-05');
    expect(d.rows.every((r) => r.monto === null)).toBe(true);
    expect(d.ingresos).toBe(0);
  });
});

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

describe('POST /api/months/:ym/duplicate', () => {
  const put = () => api(A.app, A.headers, 'PUT', '/api/months/2026-08', { version: 0, month: '2026-08', ingresos: source.ingresos, rows: source.rows });

  it('201 crea el destino con version 1 y lo indexa', async () => {
    await put();
    const res = await api(A.app, A.headers, 'POST', '/api/months/2026-08/duplicate', { target: '2026-09' });
    expect(res.status).toBe(201);
    const doc = (await res.json()) as MonthDoc;
    expect(doc.month).toBe('2026-09');
    expect(doc.version).toBe(1);
    expect(doc.rows).toHaveLength(2);
    expect(await getIndex(env.GASTOS_KV)).toEqual(['2026-08', '2026-09']);
  });

  it('404 si el origen no existe', async () => {
    expect((await api(A.app, A.headers, 'POST', '/api/months/2026-08/duplicate', { target: '2026-09' })).status).toBe(404);
  });

  it('409 exists si el destino ya existe; con reemplazar lo sobreescribe con version+1', async () => {
    await put();
    await api(A.app, A.headers, 'PUT', '/api/months/2026-09', { version: 0, month: '2026-09', ingresos: 1, rows: [] });
    const conflict = await api(A.app, A.headers, 'POST', '/api/months/2026-08/duplicate', { target: '2026-09' });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: string }).error).toBe('exists');
    const ok = await api(A.app, A.headers, 'POST', '/api/months/2026-08/duplicate', { target: '2026-09', reemplazar: true });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as MonthDoc).version).toBe(2);
  });

  it('400 si target es el mismo mes o el body es inválido', async () => {
    await put();
    expect((await api(A.app, A.headers, 'POST', '/api/months/2026-08/duplicate', { target: '2026-08' })).status).toBe(400);
    expect((await api(A.app, A.headers, 'POST', '/api/months/2026-08/duplicate', { target: 'sept' })).status).toBe(400);
  });
});
