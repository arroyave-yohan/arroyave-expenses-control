import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';
import { SEED_CATEGORIAS } from '../../src/worker/seed';
import type { CategoriasDoc, Row } from '../../src/shared/types';

let A: AuthedApp;
beforeEach(async () => {
  // @cloudflare/vitest-pool-workers isolates storage per test FILE, not per `it()`
  // (see https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/).
  // Clear the keys this file's tests reuse so each test starts from a clean slate.
  await env.GASTOS_KV.delete('meta:categorias');
  await env.GASTOS_KV.delete('month:2026-08');
  await env.GASTOS_KV.delete('month:2026-09');
  await env.GASTOS_KV.delete('index:months');
  A = await makeAuthedApp();
});

const row = (categoriaId: string | null): Row => ({
  id: 'r_' + Math.random().toString(36).slice(2, 10), concepto: 'X', monto: 1, categoriaId,
  recurrente: true, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '',
});

describe('GET /api/categorias', () => {
  it('devuelve la semilla con version 1', async () => {
    const res = await api(A.app, A.headers, 'GET', '/api/categorias');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, items: SEED_CATEGORIAS });
  });
});

describe('PUT /api/categorias', () => {
  it('agrega una categoría e incrementa version', async () => {
    const items = [...SEED_CATEGORIAS, { id: 'mascotas', nombre: 'Mascotas', hue: 120, orden: 8 }];
    const res = await api(A.app, A.headers, 'PUT', '/api/categorias', { version: 1, items });
    expect(res.status).toBe(200);
    const doc = (await res.json()) as CategoriasDoc;
    expect(doc.version).toBe(2);
    expect(doc.items).toHaveLength(9);
  });

  it('409 conflict si la version no coincide', async () => {
    const res = await api(A.app, A.headers, 'PUT', '/api/categorias', { version: 7, items: SEED_CATEGORIAS });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('conflict');
  });

  it('409 in_use si se elimina una categoría usada en un mes, indicando los meses', async () => {
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { version: 0, month: '2026-08', ingresos: 0, rows: [row('vivienda')] });
    await api(A.app, A.headers, 'PUT', '/api/months/2026-09', { version: 0, month: '2026-09', ingresos: 0, rows: [row('ahorro')] });
    const items = SEED_CATEGORIAS.filter((c) => c.id !== 'vivienda');
    const res = await api(A.app, A.headers, 'PUT', '/api/categorias', { version: 1, items });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'in_use', categoriaId: 'vivienda', months: ['2026-08'],
      message: 'La categoría vivienda está en uso en: 2026-08',
    });
  });

  it('permite eliminar una categoría que ningún mes usa y renombrar otra', async () => {
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { version: 0, month: '2026-08', ingresos: 0, rows: [row('vivienda')] });
    const items = SEED_CATEGORIAS.filter((c) => c.id !== 'otros').map((c) => (c.id === 'vivienda' ? { ...c, nombre: 'Casa' } : c));
    const res = await api(A.app, A.headers, 'PUT', '/api/categorias', { version: 1, items });
    expect(res.status).toBe(200);
    const doc = (await res.json()) as CategoriasDoc;
    expect(doc.items.find((c) => c.id === 'vivienda')?.nombre).toBe('Casa');
    expect(doc.items.some((c) => c.id === 'otros')).toBe(false);
  });

  it('400 si el body no valida', async () => {
    expect((await api(A.app, A.headers, 'PUT', '/api/categorias', { version: 1, items: [{ id: 'X', nombre: '', hue: 1, orden: 0 }] })).status).toBe(400);
  });
});
