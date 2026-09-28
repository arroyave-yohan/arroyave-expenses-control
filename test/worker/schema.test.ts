import { describe, it, expect } from 'vitest';
import { MonthInputSchema, DuplicateInputSchema, CategoriasInputSchema, AccionSchema, MovimientosSchema, parseBody } from '../../src/worker/schema';

const validRow = {
  id: 'r_abc12345', concepto: 'Arriendo', monto: 1250000, categoriaId: 'vivienda',
  recurrente: true, estado: 'pagado', fecha: null, fechaPago: '2026-08-05', bolsillo: 'Nu: Arriendo', link: '', ref: '',
};
const validMonth = { version: 3, month: '2026-08', ingresos: 12400000, rows: [validRow] };

describe('MonthInputSchema', () => {
  it('acepta un mes válido', () => {
    expect(parseBody(MonthInputSchema, validMonth).ok).toBe(true);
  });
  it('rechaza month mal formado', () => {
    const r = parseBody(MonthInputSchema, { ...validMonth, month: '2026-13' });
    expect(r.ok).toBe(false);
  });
  it('rechaza monto decimal o negativo', () => {
    expect(parseBody(MonthInputSchema, { ...validMonth, rows: [{ ...validRow, monto: 10.5 }] }).ok).toBe(false);
    expect(parseBody(MonthInputSchema, { ...validMonth, rows: [{ ...validRow, monto: -1 }] }).ok).toBe(false);
  });
  it('una fila sin `fecha` se lee con fecha null (documentos anteriores)', () => {
    const { fecha: _omit, ...sinFecha } = validRow as typeof validRow & { fecha: string | null };
    void _omit;
    const r = parseBody(MonthInputSchema, { ...validMonth, rows: [sinFecha] });
    expect(r.ok && (r.value.rows[0] as { fecha: string | null }).fecha).toBeNull();
  });
  it('acepta monto null', () => {
    expect(parseBody(MonthInputSchema, { ...validMonth, rows: [{ ...validRow, monto: null }] }).ok).toBe(true);
  });
  it('rechaza fechaPago cuando el estado no es pagado', () => {
    const r = parseBody(MonthInputSchema, { ...validMonth, rows: [{ ...validRow, estado: 'separado' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/fechaPago/);
  });
  it('rechaza estado desconocido e ids de fila repetidos', () => {
    expect(parseBody(MonthInputSchema, { ...validMonth, rows: [{ ...validRow, estado: 'listo' }] }).ok).toBe(false);
    expect(parseBody(MonthInputSchema, { ...validMonth, rows: [validRow, validRow] }).ok).toBe(false);
  });
});

describe('DuplicateInputSchema', () => {
  it('aplica valores por defecto', () => {
    const r = parseBody(DuplicateInputSchema, { target: '2026-09' });
    expect(r.ok && r.value).toEqual({
      target: '2026-09', soloRecurrentes: true, resetEstado: true, mantenerMontos: true, mantenerIngresos: true, reemplazar: false,
    });
  });
});

describe('CategoriasInputSchema', () => {
  it('rechaza hue fuera de rango e ids repetidos', () => {
    const cat = { id: 'vivienda', nombre: 'Vivienda', hue: 205, orden: 0 };
    expect(parseBody(CategoriasInputSchema, { version: 1, items: [{ ...cat, hue: 360 }] }).ok).toBe(false);
    expect(parseBody(CategoriasInputSchema, { version: 1, items: [cat, cat] }).ok).toBe(false);
    expect(parseBody(CategoriasInputSchema, { version: 1, items: [cat] }).ok).toBe(true);
  });
});

describe('AccionSchema', () => {
  it('acepta las cuatro acciones y rechaza las inválidas', () => {
    expect(AccionSchema.safeParse({ accion: 'pagar', ym: '2026-09', rowId: 'r_a' }).success).toBe(true);
    expect(AccionSchema.safeParse({ accion: 'aplazar', ym: '2026-09', rowId: 'r_a' }).success).toBe(true);
    expect(AccionSchema.safeParse({ accion: 'aplazar', ym: '2026-09', rowId: 'r_a', horas: 0 }).success).toBe(true);
    expect(AccionSchema.safeParse({ accion: 'aplazar', ym: '2026-09', rowId: 'r_a', horas: 25 }).success).toBe(false);
    expect(AccionSchema.safeParse({ accion: 'silenciar', ym: '2026-09', rowId: 'r_a', valor: true }).success).toBe(true);
    expect(AccionSchema.safeParse({ accion: 'silenciar', ym: '2026-09', rowId: 'r_a' }).success).toBe(false);
    expect(AccionSchema.safeParse({ accion: 'mastarde' }).success).toBe(true);
    expect(AccionSchema.safeParse({ accion: 'mastarde', horas: 2 }).success).toBe(true);
    expect(AccionSchema.safeParse({ accion: 'pagar', ym: '2026-9', rowId: 'r_a' }).success).toBe(false);
    expect(AccionSchema.safeParse({ accion: 'borrar', ym: '2026-09', rowId: 'r_a' }).success).toBe(false);
  });
});

describe('MovimientosSchema', () => {
  it('coacciona montos con puntos/comas y tolera campos faltantes', () => {
    const r = MovimientosSchema.parse({ movimientos: [{ comercio: 'D1', monto: '-$299.960,00', tipo: 'compra' }, { comercio: 'X', monto: 70000 }] });
    expect(r.movimientos[0]).toMatchObject({ comercio: 'D1', monto: 299960, fecha: null, tipo: 'compra' });
    expect(r.movimientos[1]).toMatchObject({ monto: 70000, tipo: 'otro' });
    expect(MovimientosSchema.parse({ movimientos: [{ monto: 1 }] }).movimientos[0].comercio).toBe('');
    expect(MovimientosSchema.parse({ movimientos: [{ comercio: 'x'.repeat(200) }] }).movimientos[0].comercio).toHaveLength(120);
    expect(() => MovimientosSchema.parse({ movimientos: [] })).toThrow();
  });
});
