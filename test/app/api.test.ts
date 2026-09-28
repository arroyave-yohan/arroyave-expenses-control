import { describe, it, expect, vi } from 'vitest';
import { createApi, ApiError, ConflictError } from '../../src/app/api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api', () => {
  it('GET month devuelve el documento', async () => {
    const fetchFn = vi.fn(async () => json(200, { month: '2026-08', version: 1 }));
    const api = createApi({ fetchFn: fetchFn as unknown as typeof fetch });
    const doc = await api.month('2026-08');
    expect(doc.month).toBe('2026-08');
    expect(fetchFn).toHaveBeenCalledWith('/api/months/2026-08', expect.objectContaining({ method: 'GET' }));
  });
  it('PUT envía JSON y devuelve el doc guardado', async () => {
    const fetchFn = vi.fn(async (_u: string, init: RequestInit) => json(200, { ...JSON.parse(String(init.body)), version: 2 }));
    const api = createApi({ fetchFn: fetchFn as unknown as typeof fetch });
    const saved = await api.putMonth({ version: 1, month: '2026-08', ingresos: 0, updatedAt: '', rows: [] });
    expect(saved.version).toBe(2);
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
  it('409 lanza ConflictError con current', async () => {
    const api = createApi({ fetchFn: (async () => json(409, { error: 'conflict', message: 'x', current: { version: 5 } })) as unknown as typeof fetch });
    await expect(api.putMonth({ version: 1, month: '2026-08', ingresos: 0, updatedAt: '', rows: [] })).rejects.toMatchObject({ status: 409, current: { version: 5 } });
    try { await api.putMonth({ version: 1, month: '2026-08', ingresos: 0, updatedAt: '', rows: [] }); } catch (e) { expect(e).toBeInstanceOf(ConflictError); }
  });
  it('409 sin current lanza ConflictError con current null', async () => {
    const api = createApi({ fetchFn: (async () => json(409, { error: 'in_use', message: 'x', categoriaId: 'vivienda', months: ['2026-08'] })) as unknown as typeof fetch });
    await expect(api.putMonth({ version: 1, month: '2026-08', ingresos: 0, updatedAt: '', rows: [] })).rejects.toMatchObject({ current: null, code: 'in_use' });
    try {
      await api.putMonth({ version: 1, month: '2026-08', ingresos: 0, updatedAt: '', rows: [] });
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError & { body: { months: string[] } }).body.months).toEqual(['2026-08']);
    }
  });
  it('401 llama onUnauthorized y lanza ApiError', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi({ fetchFn: (async () => json(401, { error: 'unauthorized', message: 'x' })) as unknown as typeof fetch, onUnauthorized });
    await expect(api.months()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalled();
  });
  it('sesión de Access expirada (200 con HTML) llama onUnauthorized y lanza 401', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi({
      fetchFn: (async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch,
      onUnauthorized,
    });
    await expect(api.months()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalled();
  });
  it('errores no JSON producen ApiError con code internal', async () => {
    const api = createApi({ fetchFn: (async () => new Response('boom', { status: 502 })) as unknown as typeof fetch });
    await expect(api.months()).rejects.toMatchObject({ status: 502, code: 'internal' });
  });
  it('exportUrl', () => {
    const api = createApi({ fetchFn: fetch });
    expect(api.exportUrl('csv')).toBe('/api/export?format=csv');
    expect(api.exportUrl('json')).toBe('/api/export');
  });
});
