import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { getMonth, putMonth, deleteMonth, getIndex, addToIndex, removeFromIndex, getCategorias, keys } from '../../src/worker/kv';
import { SEED_CATEGORIAS } from '../../src/worker/seed';
import type { MonthDoc } from '../../src/shared/types';

const doc: MonthDoc = { version: 1, month: '2026-08', ingresos: 100, updatedAt: '2026-08-01T00:00:00Z', rows: [] };

describe('kv meses', () => {
  it('getMonth devuelve null si no existe y el doc después de putMonth', async () => {
    expect(await getMonth(env.GASTOS_KV, '2026-08')).toBeNull();
    await putMonth(env.GASTOS_KV, doc);
    expect(await getMonth(env.GASTOS_KV, '2026-08')).toEqual(doc);
    expect(await env.GASTOS_KV.get(keys.month('2026-08'))).toBe(JSON.stringify(doc));
  });
  it('deleteMonth borra', async () => {
    await putMonth(env.GASTOS_KV, doc);
    await deleteMonth(env.GASTOS_KV, '2026-08');
    expect(await getMonth(env.GASTOS_KV, '2026-08')).toBeNull();
  });
});

describe('kv índice', () => {
  it('addToIndex mantiene orden ascendente y sin duplicados', async () => {
    expect(await getIndex(env.GASTOS_KV)).toEqual([]);
    await addToIndex(env.GASTOS_KV, '2026-09');
    await addToIndex(env.GASTOS_KV, '2026-02');
    await addToIndex(env.GASTOS_KV, '2026-09');
    expect(await getIndex(env.GASTOS_KV)).toEqual(['2026-02', '2026-09']);
    await removeFromIndex(env.GASTOS_KV, '2026-02');
    expect(await getIndex(env.GASTOS_KV)).toEqual(['2026-09']);
  });
});

describe('kv categorías', () => {
  it('siembra la lista si no existe y la persiste', async () => {
    const c = await getCategorias(env.GASTOS_KV);
    expect(c.version).toBe(1);
    expect(c.items).toEqual(SEED_CATEGORIAS);
    expect(c.items.map((i) => i.id)).toEqual([
      'vivienda', 'ninos', 'servicios-publicos', 'plataformas', 'ahorro', 'transporte', 'alimentacion', 'otros',
    ]);
    expect(await env.GASTOS_KV.get(keys.categorias, 'json')).toEqual(c);
  });
});
