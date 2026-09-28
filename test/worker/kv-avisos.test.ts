import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getAvisosConfig, putAvisosConfig, getPushDoc, putPushDoc, getAvisosEstado, putAvisosEstado, keys, SchemaError } from '../../src/worker/kv';
import { AVISOS_DEFAULT, AVISOS_ESTADO_VACIO } from '../../src/shared/avisos';

beforeEach(async () => { for (const k of [keys.avisos, keys.push, keys.avisosEstado]) await env.GASTOS_KV.delete(k); });

describe('meta:avisos', () => {
  it('devuelve los valores por defecto si no existe y no escribe nada', async () => {
    expect(await getAvisosConfig(env.GASTOS_KV)).toEqual(AVISOS_DEFAULT);
    expect(await env.GASTOS_KV.get(keys.avisos)).toBeNull();
  });
  it('escribe y lee', async () => {
    const doc = { ...AVISOS_DEFAULT, version: 3, hora: 18, ventanaDias: 7 };
    await putAvisosConfig(env.GASTOS_KV, doc);
    expect(await getAvisosConfig(env.GASTOS_KV)).toEqual(doc);
  });
  it('lanza SchemaError si el documento es inválido', async () => {
    await env.GASTOS_KV.put(keys.avisos, JSON.stringify({ version: 1, hora: 99 }));
    await expect(getAvisosConfig(env.GASTOS_KV)).rejects.toBeInstanceOf(SchemaError);
    await env.GASTOS_KV.put(keys.avisos, '{no json');
    await expect(getAvisosConfig(env.GASTOS_KV)).rejects.toBeInstanceOf(SchemaError);
  });
  it('un documento antiguo sin aplazarHoras/maxIndividuales se lee con los defaults', async () => {
    await env.GASTOS_KV.put(keys.avisos, JSON.stringify({ version: 4, hora: 9, ventanaDias: 2, incluir: { vencidas: true, hoy: true, proximas: false }, soloSiHayAlgo: true }));
    expect(await getAvisosConfig(env.GASTOS_KV)).toEqual({ version: 4, hora: 9, ventanaDias: 2, incluir: { vencidas: true, hoy: true, proximas: false }, soloSiHayAlgo: true, aplazarHoras: 3, maxIndividuales: 5 });
  });
});

describe('meta:push y meta:avisos-estado', () => {
  it('push vacío por defecto; escribe y lee', async () => {
    expect(await getPushDoc(env.GASTOS_KV)).toEqual({ items: [] });
    const sub = { id: 'p_abc', endpoint: 'https://push.example/x', expirationTime: null, keys: { p256dh: 'k', auth: 'a' }, nombre: 'Android · Chrome', createdAt: '2026-09-22T13:00:00.000Z' };
    await putPushDoc(env.GASTOS_KV, { items: [sub] });
    expect(await getPushDoc(env.GASTOS_KV)).toEqual({ items: [sub] });
  });
  it('estado vacío por defecto; escribe y lee', async () => {
    expect(await getAvisosEstado(env.GASTOS_KV)).toEqual(AVISOS_ESTADO_VACIO);
    const estado = { ...AVISOS_ESTADO_VACIO, ultimoEnvio: '2026-09-22', ultimoResultado: { at: '2026-09-22T13:00:00.000Z', titulo: 'Gastos: 1 hoy', enviadas: 1, eliminadas: 0, fallidas: 0, mesesOmitidos: [], individuales: 1, resumen: false } };
    await putAvisosEstado(env.GASTOS_KV, estado);
    expect(await getAvisosEstado(env.GASTOS_KV)).toEqual(estado);
  });
  it('un estado antiguo sin gastos/resumen se lee con los defaults', async () => {
    await env.GASTOS_KV.put(keys.avisosEstado, JSON.stringify({ ultimoEnvio: '2026-09-22', ultimoResultado: { at: 'x', titulo: 't', enviadas: 1, eliminadas: 0, fallidas: 0, mesesOmitidos: [] } }));
    const e = await getAvisosEstado(env.GASTOS_KV);
    expect(e.gastos).toEqual({});
    expect(e.resumen).toEqual({ enviado: null, aplazadoHasta: null });
    expect(e.ultimoResultado).toMatchObject({ individuales: 0, resumen: false });
  });
  it('estado nuevo completo se escribe y lee igual', async () => {
    const estado = { ...AVISOS_ESTADO_VACIO, gastos: { '2026-09/r_a': { enviado: '2026-09-22T13:00:00.000Z', aplazadoHasta: null, silenciadoFecha: '2026-09-22' } }, resumen: { enviado: null, aplazadoHasta: '2026-09-22T16:00:00.000Z' } };
    await putAvisosEstado(env.GASTOS_KV, estado);
    expect(await getAvisosEstado(env.GASTOS_KV)).toEqual(estado);
  });
});
