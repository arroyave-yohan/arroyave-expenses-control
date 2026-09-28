import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { makeAuthedApp, api, type AuthedApp } from '../helpers';

let A: AuthedApp;
beforeEach(async () => {
  A = await makeAuthedApp();
  await env.GASTOS_KV.delete('month:2026-08');
  await env.GASTOS_KV.delete('index:months');
});

describe('lectura de documentos corruptos', () => {
  it('500 schema si el documento del mes no valida', async () => {
    await env.GASTOS_KV.put('month:2026-08', JSON.stringify({ version: 1, month: '2026-08', rows: 'no' }));
    const res = await api(A.app, A.headers, 'GET', '/api/months/2026-08');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('schema');
    expect(body.message).toMatch(/2026-08/);
  });

  it('500 schema si el valor no es JSON', async () => {
    await env.GASTOS_KV.put('month:2026-08', '{not json');
    const res = await api(A.app, A.headers, 'GET', '/api/months/2026-08');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('schema');
  });

  it('GET /raw devuelve el texto crudo aunque esté corrupto, 404 si no existe', async () => {
    expect((await api(A.app, A.headers, 'GET', '/api/months/2026-08/raw')).status).toBe(404);
    await env.GASTOS_KV.put('month:2026-08', '{not json');
    const res = await api(A.app, A.headers, 'GET', '/api/months/2026-08/raw');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('{not json');
  });

  it('un documento válido sigue leyéndose normal', async () => {
    await api(A.app, A.headers, 'PUT', '/api/months/2026-08', { version: 0, month: '2026-08', ingresos: 1, rows: [] });
    expect((await api(A.app, A.headers, 'GET', '/api/months/2026-08')).status).toBe(200);
  });
});
