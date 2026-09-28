import { describe, it, expect } from 'vitest';
import { initialFilters, nextEstado, withEstado, newRow, duplicateRow, visibleRows, chipTotals, catName } from '../../src/app/state';
import type { MonthDoc, Row, CategoriasDoc } from '../../src/shared/types';

const row = (p: Partial<Row>): Row => ({
  id: 'r_' + Math.random().toString(36).slice(2, 10), concepto: 'X', monto: 100, categoriaId: null, recurrente: true,
  estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '', ...p,
});
const cats: CategoriasDoc = { version: 1, items: [
  { id: 'vivienda', nombre: 'Vivienda', hue: 205, orden: 0 }, { id: 'ahorro', nombre: 'Ahorro', hue: 150, orden: 1 },
] };
const doc: MonthDoc = { version: 1, month: '2026-08', ingresos: 0, updatedAt: '', rows: [
  row({ id: 'a', concepto: 'Arriendo', monto: 1000, categoriaId: 'vivienda', estado: 'pagado', fecha: null, fechaPago: '2026-08-01', bolsillo: 'Nu: Arriendo' }),
  row({ id: 'b', concepto: 'Ahorro carro', monto: 600, categoriaId: 'ahorro', estado: 'separado', bolsillo: 'Nu: Carro' }),
  row({ id: 'c', concepto: 'Mercado', monto: null, categoriaId: null, bolsillo: 'Datafono', ref: '123456' }),
] };

describe('estado de fila', () => {
  it('cicla pendiente → separado → pagado → pendiente', () => {
    expect(nextEstado('pendiente')).toBe('separado');
    expect(nextEstado('separado')).toBe('pagado');
    expect(nextEstado('pagado')).toBe('pendiente');
  });
  it('withEstado aplica la regla de fechaPago', () => {
    const r = row({});
    const pagado = withEstado(r, 'pagado', '2026-08-20');
    expect(pagado.fechaPago).toBe('2026-08-20');
    const conFecha = withEstado({ ...r, estado: 'pagado', fecha: null, fechaPago: '2026-08-02' }, 'pagado', '2026-08-20');
    expect(conFecha.fechaPago).toBe('2026-08-02');
    expect(withEstado(pagado, 'separado', '2026-08-20').fechaPago).toBeNull();
    expect(r.estado).toBe('pendiente'); // no muta
  });
  it('newRow y duplicateRow', () => {
    const n = newRow();
    expect(n.id).toMatch(/^r_/); expect(n.monto).toBeNull(); expect(n.estado).toBe('pendiente');
    const d = duplicateRow(doc.rows[0]);
    expect(d.id).not.toBe('a'); expect(d.estado).toBe('pendiente'); expect(d.fechaPago).toBeNull(); expect(d.concepto).toBe('Arriendo');
  });
});

describe('filtros', () => {
  it('sin filtros devuelve todo en orden original', () => {
    expect(visibleRows(doc, initialFilters(), cats).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('búsqueda por concepto, bolsillo, ref y nombre de categoría', () => {
    const q = (s: string) => visibleRows(doc, { ...initialFilters(), q: s }, cats).map((r) => r.id);
    expect(q('arri')).toEqual(['a']);
    expect(q('datafono')).toEqual(['c']);
    expect(q('2345')).toEqual(['c']);
    expect(q('vivienda')).toEqual(['a']);
  });
  it('estado, bolsillo y categorías', () => {
    expect(visibleRows(doc, { ...initialFilters(), estado: 'separado' }, cats).map((r) => r.id)).toEqual(['b']);
    expect(visibleRows(doc, { ...initialFilters(), bolsillo: 'Datafono' }, cats).map((r) => r.id)).toEqual(['c']);
    expect(visibleRows(doc, { ...initialFilters(), categorias: new Set([null]) }, cats).map((r) => r.id)).toEqual(['c']);
    expect(visibleRows(doc, { ...initialFilters(), categorias: new Set(['vivienda', 'ahorro']) }, cats).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('orden por monto (nulos al final) y agrupación por categoría', () => {
    expect(visibleRows(doc, { ...initialFilters(), sort: { k: 'monto', dir: -1 } }, cats).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(visibleRows(doc, { ...initialFilters(), sort: { k: 'monto', dir: 1 } }, cats).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(visibleRows(doc, { ...initialFilters(), group: true }, cats).map((r) => r.categoriaId)).toEqual(['vivienda', 'ahorro', null]);
  });
  it('orden por fecha con nulos al final en ambas direcciones', () => {
    const d: MonthDoc = { ...doc, rows: [row({ id: 'x', fecha: '2026-08-20' }), row({ id: 'y', fecha: null }), row({ id: 'z', fecha: '2026-08-05' })] };
    expect(visibleRows(d, { ...initialFilters(), sort: { k: 'fecha', dir: 1 } }, cats).map((r) => r.id)).toEqual(['z', 'x', 'y']);
    expect(visibleRows(d, { ...initialFilters(), sort: { k: 'fecha', dir: -1 } }, cats).map((r) => r.id)).toEqual(['x', 'z', 'y']);
  });
  it('chipTotals responde a los otros filtros pero no al de categoría', () => {
    const t = chipTotals(doc, { ...initialFilters(), estado: 'pagado', categorias: new Set(['ahorro']) });
    expect(t.get('vivienda')).toEqual({ total: 1000, count: 1 });
    expect(t.has('ahorro')).toBe(false);
  });
  it('catName', () => {
    expect(catName(cats, 'ahorro')).toBe('Ahorro');
    expect(catName(cats, null)).toBe('');
    expect(catName(cats, 'zzz')).toBe('zzz');
  });
});
