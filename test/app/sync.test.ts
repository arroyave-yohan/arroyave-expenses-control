import { describe, it, expect, vi } from 'vitest';
import { createSaver } from '../../src/app/sync';
import { ConflictError } from '../../src/app/api';
import type { MonthDoc } from '../../src/shared/types';

const doc = (version: number, ingresos = 0, month = '2026-08'): MonthDoc => ({ version, month, ingresos, updatedAt: '', rows: [] });

// temporizadores manuales: cada `set` guarda el callback; `run()` ejecuta los pendientes
function fakeTimers() {
  const q: { id: number; fn: () => void; ms: number }[] = []; let n = 0;
  return {
    timers: { set: ((fn: () => void, ms: number) => { q.push({ id: ++n, fn, ms }); return n; }) as unknown as typeof setTimeout,
              clear: ((id: number) => { const i = q.findIndex((t) => t.id === id); if (i >= 0) q.splice(i, 1); }) as unknown as typeof clearTimeout },
    async run() { const items = q.splice(0); for (const t of items) t.fn(); await Promise.resolve(); await Promise.resolve(); },
    pending: () => q.map((t) => t.ms),
  };
}

describe('createSaver', () => {
  it('agrupa cambios rápidos en un solo PUT y usa la última versión conocida', async () => {
    const ft = fakeTimers(); const statuses: string[] = [];
    const save = vi.fn(async (d: MonthDoc) => ({ ...d, version: d.version + 1 }));
    const onSaved = vi.fn();
    const s = createSaver({ save, onSaved, onConflict: vi.fn(), onStatus: (st) => statuses.push(st), timers: ft.timers });
    s.schedule(doc(1, 10)); s.schedule(doc(1, 20));
    expect(ft.pending()).toEqual([800]);
    expect(s.hasPending()).toBe(true);
    await ft.run();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].ingresos).toBe(20);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(s.knownVersion()).toBe(2);
    expect(statuses.at(-1)).toBe('guardado');
    expect(statuses).toContain('guardando');
    // un cambio hecho con un doc viejo (version 1) se envía con la versión conocida (2)
    s.schedule(doc(1, 30)); await ft.run();
    expect(save.mock.calls[1][0].version).toBe(2);
  });

  it('si llega un cambio durante el guardado, guarda otra vez al terminar', async () => {
    const ft = fakeTimers(); let resolveFirst!: (d: MonthDoc) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<MonthDoc>((r) => { resolveFirst = r; })).mockImplementation(async (d: MonthDoc) => ({ ...d, version: d.version + 1 }));
    const s = createSaver({ save, onSaved: vi.fn(), onConflict: vi.fn(), onStatus: vi.fn(), timers: ft.timers });
    s.schedule(doc(1, 1)); await ft.run();
    s.schedule(doc(1, 2));
    resolveFirst(doc(2, 1)); await Promise.resolve(); await Promise.resolve(); await ft.run();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ ingresos: 2, version: 2 });
  });

  it('409: llama onConflict con current, estado conflicto, descarta lo pendiente', async () => {
    const ft = fakeTimers(); const onConflict = vi.fn(); const statuses: string[] = [];
    const save = vi.fn(async () => { throw new ConflictError(409, 'conflict', 'x', { current: doc(9) }); });
    const s = createSaver({ save, onSaved: vi.fn(), onConflict, onStatus: (st) => statuses.push(st), timers: ft.timers });
    s.schedule(doc(1)); await ft.run();
    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ version: 9 }));
    expect(statuses.at(-1)).toBe('conflicto');
    expect(s.hasPending()).toBe(false);
    expect(ft.pending()).toEqual([]);
  });

  it('error de red: estado sin-guardar y reintento con backoff 2s, 4s, 8s… máx 30s', async () => {
    const ft = fakeTimers(); const statuses: string[] = [];
    const save = vi.fn().mockRejectedValueOnce(new Error('net')).mockRejectedValueOnce(new Error('net')).mockImplementation(async (d: MonthDoc) => ({ ...d, version: 2 }));
    const s = createSaver({ save, onSaved: vi.fn(), onConflict: vi.fn(), onStatus: (st) => statuses.push(st), timers: ft.timers });
    s.schedule(doc(1)); await ft.run();
    expect(statuses.at(-1)).toBe('sin-guardar'); expect(ft.pending()).toEqual([2000]);
    await ft.run(); expect(ft.pending()).toEqual([4000]);
    await ft.run(); expect(statuses.at(-1)).toBe('guardado'); expect(s.hasPending()).toBe(false);
  });

  it('un conflicto reinicia el backoff: tras resolverse, el siguiente error de red vuelve a esperar 2s', async () => {
    const ft = fakeTimers(); const statuses: string[] = [];
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockRejectedValueOnce(new Error('net'))
      .mockImplementationOnce(async () => { throw new ConflictError(409, 'conflict', 'x', { current: doc(9) }); })
      .mockRejectedValueOnce(new Error('net'));
    const s = createSaver({ save, onSaved: vi.fn(), onConflict: vi.fn(), onStatus: (st) => statuses.push(st), timers: ft.timers });
    s.schedule(doc(1)); await ft.run();
    expect(ft.pending()).toEqual([2000]);
    await ft.run();
    expect(ft.pending()).toEqual([4000]);
    await ft.run();
    expect(statuses.at(-1)).toBe('conflicto');
    expect(s.hasPending()).toBe(false);
    expect(ft.pending()).toEqual([]);
    s.schedule(doc(9)); await ft.run();
    expect(ft.pending()).toEqual([2000]);
  });

  it('la versión conocida es por mes', async () => {
    // mes A termina con known=5 (más alto que lo que necesita el mes B); la lógica
    // global anterior (Math.max sin distinguir mes) enviaría 5 para B en vez de 3.
    const ft = fakeTimers();
    const save = vi.fn(async (d: MonthDoc) => ({ ...d, version: d.version + 1 }));
    const s = createSaver({ save, onSaved: vi.fn(), onConflict: vi.fn(), onStatus: vi.fn(), timers: ft.timers });
    s.schedule(doc(4, 0, '2026-08')); await ft.run();
    expect(save.mock.calls[0][0]).toMatchObject({ version: 4, month: '2026-08' });
    expect(s.knownVersion()).toBe(5);
    s.setKnownVersion(3, '2026-02');
    s.schedule(doc(3, 0, '2026-02')); await ft.run();
    expect(save.mock.calls[1][0]).toMatchObject({ version: 3, month: '2026-02' });
  });

  it('tras un 409 el siguiente guardado usa la versión del servidor', async () => {
    // mes A deja known=5; el 409 de B trae un current con versión MENOR (2). La lógica
    // global anterior haría Math.max(5, 2) = 5 y seguiría enviando 5 para B; la lógica
    // por mes debe adoptar el 2 que vino del servidor para B.
    const ft = fakeTimers();
    const save = vi
      .fn()
      .mockImplementationOnce(async (d: MonthDoc) => ({ ...d, version: d.version + 1 }))
      .mockImplementationOnce(async () => { throw new ConflictError(409, 'conflict', 'x', { current: doc(2, 0, '2026-02') }); })
      .mockImplementation(async (d: MonthDoc) => ({ ...d, version: d.version + 1 }));
    const s = createSaver({ save, onSaved: vi.fn(), onConflict: vi.fn(), onStatus: vi.fn(), timers: ft.timers });
    s.schedule(doc(4, 0, '2026-08')); await ft.run();
    expect(s.knownVersion()).toBe(5);
    s.schedule(doc(1, 0, '2026-02')); await ft.run();
    s.schedule(doc(1, 0, '2026-02')); await ft.run();
    expect(save.mock.calls[2][0].version).toBe(2);
  });

  it('flush guarda inmediatamente lo pendiente', async () => {
    const ft = fakeTimers();
    const save = vi.fn(async (d: MonthDoc) => ({ ...d, version: 2 }));
    const s = createSaver({ save, onSaved: vi.fn(), onConflict: vi.fn(), onStatus: vi.fn(), timers: ft.timers });
    s.schedule(doc(1)); await s.flush();
    expect(save).toHaveBeenCalledTimes(1); expect(ft.pending()).toEqual([]);
  });
});

describe('temporizadores por defecto', () => {
  it('sin `timers` inyectados usa setTimeout real sin perder el this (Illegal invocation en navegadores)', async () => {
    const save = vi.fn(async (d: MonthDoc) => ({ ...d, version: d.version + 1 }));
    const statuses: string[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const s = createSaver({ save, onSaved: vi.fn(), onConflict: vi.fn(), onStatus: (st) => { statuses.push(st); if (st === 'guardado') resolve(); }, debounceMs: 5 });
      try { s.schedule(doc(1)); } catch (e) { reject(e); }
      setTimeout(() => reject(new Error(`no llegó a guardado: ${statuses.join(',')}`)), 500);
    });
    await done;
    expect(save).toHaveBeenCalledTimes(1);
  });
});
