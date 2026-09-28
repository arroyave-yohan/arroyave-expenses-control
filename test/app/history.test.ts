import { describe, it, expect } from 'vitest';
import { createHistory } from '../../src/app/history';
import type { Row } from '../../src/shared/types';

const row = (id: string, monto: number | null = 1): Row => ({ id, concepto: id, monto, categoriaId: null, recurrente: true, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '' });
const snap = (ingresos: number, ...ids: string[]) => ({ ingresos, rows: ids.map((i) => row(i)) });

describe('createHistory', () => {
  it('guarda una copia profunda y lista de más reciente a más antigua', () => {
    let t = 100; const h = createHistory(10, () => t++);
    const rows = [row('a')];
    const e1 = h.record('2026-08', 'Estado: a → Pagado', { ingresos: 5, rows });
    rows[0].monto = 999; // mutar el original no toca la foto
    const e2 = h.record('2026-08', 'Monto: a', { ingresos: 5, rows });
    expect(h.list().map((e) => e.id)).toEqual([e2.id, e1.id]);
    expect(h.list()[1].before.rows[0].monto).toBe(1);
    expect(h.list()[1].at).toBe(100);
    expect(h.size()).toBe(2);
  });
  it('recorta a `limit` entradas, descartando las más antiguas', () => {
    const h = createHistory(3);
    for (let i = 0; i < 5; i++) h.record('2026-08', `c${i}`, { ingresos: i, rows: [] });
    expect(h.list().map((e) => e.label)).toEqual(['c4', 'c3', 'c2']);
  });
  it('take() sin id quita la cima; take(id) quita hasta esa entrada inclusive', () => {
    const h = createHistory();
    const a = h.record('2026-08', 'a', snap(1));
    const b = h.record('2026-08', 'b', snap(2));
    const c = h.record('2026-07', 'c', snap(3));
    const top = h.take(undefined, snap(9));
    expect(top?.entry.id).toBe(c.id); expect(top?.removed.map((e) => e.id)).toEqual([c.id]);
    const deep = h.take(a.id, snap(8));
    expect(deep?.entry.id).toBe(a.id); expect(deep?.removed.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(h.size()).toBe(0);
    expect(h.take(undefined, snap(0))).toBeNull();
    expect(h.take(999, snap(0))).toBeNull();
  });
});

describe('rehacer', () => {
  it('deshacer guarda el estado previo; rehacer lo devuelve y repone las entradas', () => {
    const h = createHistory();
    const a = h.record('2026-08', 'a', snap(1, 'x'));
    const b = h.record('2026-08', 'b', snap(2, 'x', 'y'));
    const t = h.take(undefined, snap(3, 'x', 'y', 'z'))!; // deshace b; el estado actual (3 filas) queda como rehacer
    expect(t.entry.id).toBe(b.id);
    expect(h.redoSize()).toBe(1); expect(h.redoList()[0].label).toBe('b');
    const r = h.takeRedo()!;
    expect(r.after.rows.map((x) => x.id)).toEqual(['x', 'y', 'z']);
    expect(h.list().map((e) => e.id)).toEqual([b.id, a.id]);
    expect(h.redoSize()).toBe(0);
    expect(h.takeRedo()).toBeNull();
  });
  it('rehacer tras un deshacer profundo repone todas las entradas quitadas en su orden', () => {
    const h = createHistory();
    const a = h.record('2026-08', 'a', snap(1)); const b = h.record('2026-08', 'b', snap(2)); const c = h.record('2026-08', 'c', snap(3));
    h.take(a.id, snap(4));
    expect(h.size()).toBe(0);
    h.takeRedo();
    expect(h.list().map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });
  it('un cambio nuevo invalida los rehacer pendientes', () => {
    const h = createHistory();
    h.record('2026-08', 'a', snap(1)); h.take(undefined, snap(2));
    expect(h.redoSize()).toBe(1);
    h.record('2026-08', 'b', snap(3));
    expect(h.redoSize()).toBe(0);
  });
  it('la copia del rehacer es profunda', () => {
    const h = createHistory(); h.record('2026-08', 'a', snap(1));
    const cur = snap(2, 'q'); h.take(undefined, cur); cur.rows[0].monto = 999;
    expect(h.takeRedo()!.after.rows[0].monto).toBe(1);
  });
});

describe('persistencia', () => {
  it('serialize/hydrate conservan entradas, rehacer y la secuencia de ids', () => {
    const h = createHistory();
    const a = h.record('2026-08', 'a', snap(1)); h.record('2026-08', 'b', snap(2)); h.take(undefined, snap(3));
    const json = h.serialize();
    const h2 = createHistory();
    expect(h2.hydrate(json)).toBe(true);
    expect(h2.list().map((e) => e.id)).toEqual([a.id]);
    expect(h2.redoSize()).toBe(1);
    const c = h2.record('2026-08', 'c', snap(4));
    expect(c.id).toBeGreaterThan(a.id + 1); // no reutiliza ids (b tenía a.id+1)
  });
  it('hydrate rechaza basura sin romper', () => {
    const h = createHistory();
    expect(h.hydrate('{no json')).toBe(false);
    expect(h.hydrate(JSON.stringify({ entries: 'x' }))).toBe(false);
    expect(h.hydrate(null)).toBe(false);
    expect(h.size()).toBe(0);
  });
  it('hydrate respeta el límite', () => {
    const h = createHistory(2);
    const src = createHistory(10); for (let i = 0; i < 5; i++) src.record('2026-08', `c${i}`, snap(i));
    h.hydrate(src.serialize());
    expect(h.list().map((e) => e.label)).toEqual(['c4', 'c3']);
  });
});
