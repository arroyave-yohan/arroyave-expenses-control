import { describe, it, expect } from 'vitest';
import { alternar, rango, podar, resumen, aplicarEstado, aplicarPatch, eliminar, restaurar, etiquetaMasiva, seleccionVacia } from '../../src/app/selection';
import type { Row } from '../../src/shared/types';

const row = (id: string, p: Partial<Row> = {}): Row => ({ id, concepto: id, monto: 100, categoriaId: null, recurrente: true, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '', ...p });
const ids = (...x: string[]) => new Set(x);

describe('selection: conjunto', () => {
  it('seleccionVacia', () => { expect(seleccionVacia()).toEqual({ on: false, ids: new Set(), anchor: null }); });
  it('alternar añade y quita sin mutar', () => {
    const a = ids('x'); const b = alternar(a, 'y'); const c = alternar(b, 'x');
    expect([...b]).toEqual(['x', 'y']); expect([...c]).toEqual(['y']); expect([...a]).toEqual(['x']);
  });
  it('rango marca desde el ancla hasta el id en el orden visible, en ambos sentidos; sin ancla válida alterna', () => {
    const orden = ['a', 'b', 'c', 'd', 'e'];
    expect([...rango(orden, 'b', 'd', ids('a'))].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...rango(orden, 'd', 'b', ids())].sort()).toEqual(['b', 'c', 'd']);
    expect([...rango(orden, null, 'c', ids())]).toEqual(['c']);
    expect([...rango(orden, 'zz', 'c', ids('c'))]).toEqual([]);
  });
  it('podar conserva solo los visibles', () => { expect([...podar(ids('a', 'b', 'c'), ['b', 'c', 'd'])].sort()).toEqual(['b', 'c']); });
  it('resumen cuenta, suma y anota los sin monto', () => {
    const rows = [row('a', { monto: 1500 }), row('b', { monto: null }), row('c', { monto: 250 }), row('d')];
    expect(resumen(rows, ids('a', 'b', 'c'))).toEqual({ count: 3, total: 1750, sinMonto: 1 });
    expect(resumen(rows, ids())).toEqual({ count: 0, total: 0, sinMonto: 0 });
  });
});

describe('selection: transformaciones', () => {
  it('aplicarEstado usa withEstado solo en las marcadas', () => {
    const rows = [row('a'), row('b', { estado: 'pagado', fechaPago: '2026-09-01' }), row('c')];
    const out = aplicarEstado(rows, ids('a', 'b'), 'pagado', '2026-09-25');
    expect(out[0]).toMatchObject({ estado: 'pagado', fechaPago: '2026-09-25' });
    expect(out[1]).toMatchObject({ estado: 'pagado', fechaPago: '2026-09-01' });
    expect(out[2].estado).toBe('pendiente');
    expect(aplicarEstado(out, ids('a'), 'separado', '2026-09-25')[0]).toMatchObject({ estado: 'separado', fechaPago: null });
    expect(rows[0].estado).toBe('pendiente'); // no muta
  });
  it('aplicarPatch aplica categoría, bolsillo y fecha (incluidos null y vacío)', () => {
    const rows = [row('a', { categoriaId: 'x', bolsillo: 'Nu', fecha: '2026-09-30' }), row('b')];
    expect(aplicarPatch(rows, ids('a'), { categoriaId: null })[0].categoriaId).toBeNull();
    expect(aplicarPatch(rows, ids('a', 'b'), { bolsillo: '' }).map((r) => r.bolsillo)).toEqual(['', '']);
    expect(aplicarPatch(rows, ids('b'), { fecha: '2026-10-01' })[1].fecha).toBe('2026-10-01');
    expect(aplicarPatch(rows, ids('a'), { fecha: null })[0].fecha).toBeNull();
    expect(aplicarPatch(rows, ids('b'), { categoriaId: 'y' })[0].categoriaId).toBe('x');
  });
  it('eliminar devuelve las quitadas con su índice original y restaurar las reinserta en su sitio', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')];
    const { rows: rest, quitadas } = eliminar(rows, ids('b', 'd'));
    expect(rest.map((r) => r.id)).toEqual(['a', 'c']);
    expect(quitadas.map((q) => [q.index, q.row.id])).toEqual([[1, 'b'], [3, 'd']]);
    expect(restaurar(rest, quitadas).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(restaurar([row('a')], [{ index: 5, row: row('z') }]).map((r) => r.id)).toEqual(['a', 'z']);
  });
  it('restaurar ordena las quitadas por índice sin importar el orden de entrada', () => {
    const out = restaurar([row('b')], [{ index: 2, row: row('c') }, { index: 0, row: row('a') }]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('etiquetaMasiva singular y plural', () => {
    expect(etiquetaMasiva('Estado', 5, 'Pagado')).toBe('Estado: 5 filas → Pagado');
    expect(etiquetaMasiva('Fecha', 1, '—')).toBe('Fecha: 1 fila → —');
  });
});
