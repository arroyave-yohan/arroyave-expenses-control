import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createLocalJWKSet } from 'jose';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';
import { createApp } from '../../src/worker/index';
import { textoDe } from '../../src/worker/recibos';
import { keys } from '../../src/worker/kv';
import type { Bindings } from '../../src/shared/types';

const RESPUESTA = '```json\n{"movimientos":[{"comercio":"TIENDA D1 CENTRO","fecha":"2026-09-26","hora":"15:50","monto":"299.960,00","tipo":"compra","canal":null,"referencia":null,"banco":"Bancolombia"},{"comercio":"TIENDAS ARA","fecha":"2026-09-26","hora":"15:30","monto":323880,"tipo":"compra","canal":null,"referencia":null,"banco":null}]}\n```';
let A: AuthedApp; let recibido: { bytes: number; tipo: string } | null; let respuesta: string | Error;
const mk = () => createApp({ getKey: createLocalJWKSet({ keys: [A.publicJwk] }), analizador: async (img, tipo) => { recibido = { bytes: img.byteLength, tipo }; if (respuesta instanceof Error) throw respuesta; return respuesta; } });
const imagen = (n = 1024, tipo = 'image/jpeg', app = mk()) => app.request('/api/recibos/analizar', { method: 'POST', headers: { ...A.headers, 'Content-Type': tipo }, body: new Uint8Array(n) }, env);
beforeEach(async () => { A = await makeAuthedApp(); recibido = null; respuesta = RESPUESTA; await env.GASTOS_KV.delete(keys.recibos); });

describe('POST /api/recibos/analizar', () => {
  it('devuelve la primera lectura validada y cuántos movimientos había', async () => {
    const res = await imagen(2048, 'image/png');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lectura: { comercio: 'TIENDA D1 CENTRO', fecha: '2026-09-26', hora: '15:50', monto: 299960, tipo: 'compra', canal: null, referencia: null, banco: 'Bancolombia' }, movimientos: 2 });
    expect(recibido).toEqual({ bytes: 2048, tipo: 'image/png' });
  });
  it('lee montos escritos como número JSON con puntos de miles', async () => {
    respuesta = '{"movimientos":[{"comercio":"NEQUI","fecha":"2026-09-20","monto":180.000,"tipo":"transferencia"}]}';
    const res = await imagen(); expect(res.status).toBe(200);
    expect(((await res.json()) as { lectura: unknown }).lectura).toMatchObject({ comercio: 'NEQUI', monto: 180000, tipo: 'transferencia' });
  });
  it('400 sin imagen, tipo no soportado o más de 4 MB', async () => {
    expect((await imagen(0)).status).toBe(400);
    expect((await imagen(10, 'application/pdf')).status).toBe(400);
    expect((await imagen(4 * 1024 * 1024 + 1)).status).toBe(400);
  });
  it('502 si el modelo falla o no devuelve JSON válido', async () => {
    respuesta = 'no sé leer esto';
    let res = await imagen(); expect(res.status).toBe(502); expect(await res.json()).toMatchObject({ error: 'ia', message: 'No se pudo leer el recibo' });
    respuesta = new Error('timeout'); res = await imagen(); expect(res.status).toBe(502);
    respuesta = '{"movimientos":[]}'; res = await imagen(); expect(res.status).toBe(502);
  });
  it('503 sin analizador ni binding AI', async () => {
    const app = createApp({ getKey: createLocalJWKSet({ keys: [A.publicJwk] }) });
    const res = await app.request('/api/recibos/analizar', { method: 'POST', headers: { ...A.headers, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(10) }, { ...env, AI: undefined } as Bindings);
    expect(res.status).toBe(503);
  });
  it('exige Access', async () => { expect((await mk().request('/api/recibos/analizar', { method: 'POST', body: new Uint8Array(10) }, env)).status).toBe(401); });
});

describe('alias', () => {
  it('GET vacío; POST hace upsert por clave normalizada y devuelve el doc', async () => {
    const app = mk();
    expect(await (await api(app, A.headers, 'GET', '/api/recibos/alias')).json()).toEqual({ aliases: {} });
    const r1 = await api(app, A.headers, 'POST', '/api/recibos/alias', { comercio: 'Enviaste a SUSHI PANDA', concepto: 'Sushi', categoriaId: 'ocio', bolsillo: 'Nu' });
    expect(r1.status).toBe(200);
    const d1 = (await r1.json()) as { aliases: Record<string, { concepto: string; usadoEn: string }> };
    expect(d1.aliases['enviaste a sushi panda']).toMatchObject({ concepto: 'Sushi', categoriaId: 'ocio', bolsillo: 'Nu' });
    const r2 = await api(app, A.headers, 'POST', '/api/recibos/alias', { comercio: 'enviaste a sushi panda', concepto: 'Comida', categoriaId: null, bolsillo: '' });
    const d2 = (await r2.json()) as { aliases: Record<string, { concepto: string }> };
    expect(Object.keys(d2.aliases)).toEqual(['enviaste a sushi panda']); expect(d2.aliases['enviaste a sushi panda'].concepto).toBe('Comida');
    expect((await api(app, A.headers, 'POST', '/api/recibos/alias', { comercio: '', concepto: 'x', categoriaId: null, bolsillo: '' })).status).toBe(400);
  });
  it('mantiene como máximo 300 alias descartando el menos reciente', async () => {
    const app = mk();
    const aliases: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) aliases[`c${i}`] = { concepto: `C${i}`, categoriaId: null, bolsillo: '', usadoEn: new Date(2026, 0, 1 + (i % 28)).toISOString() };
    aliases['viejo'] = { concepto: 'V', categoriaId: null, bolsillo: '', usadoEn: '2025-01-01T00:00:00.000Z' };
    await env.GASTOS_KV.put(keys.recibos, JSON.stringify({ aliases }));
    const r = await api(app, A.headers, 'POST', '/api/recibos/alias', { comercio: 'nuevo', concepto: 'N', categoriaId: null, bolsillo: '' });
    const d = (await r.json()) as { aliases: Record<string, unknown> };
    expect(Object.keys(d.aliases)).toHaveLength(300); expect(d.aliases.nuevo).toBeDefined(); expect(d.aliases.viejo).toBeUndefined();
  });
});

describe('POST /compartir', () => {
  it('redirige a / cuando el SW no interceptó', async () => {
    const res = await mk().request('/compartir', { method: 'POST', body: 'x' }, env);
    expect(res.status).toBe(303); expect(res.headers.get('Location')).toBe('/');
  });
});

describe('textoDe (respuesta de Workers AI)', () => {
  it('acepta texto, objeto ya parseado o formato choices', () => {
    expect(textoDe({ response: '{"a":1}' })).toBe('{"a":1}');
    expect(textoDe({ response: { movimientos: [{ monto: 5 }] } })).toBe('{"movimientos":[{"monto":5}]}');
    expect(textoDe({ choices: [{ message: { content: 'hola' } }] })).toBe('hola');
    expect(textoDe({})).toBe(''); expect(textoDe(null)).toBe('');
  });
});
