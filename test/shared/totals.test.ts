import { describe, it, expect } from 'vitest';
import { computeTotals } from '../../src/shared/totals';
import type { Row } from '../../src/shared/types';

const row = (p: Partial<Row>): Row => ({
  id: 'r_x', concepto: 'x', monto: 0, categoriaId: null, recurrente: true,
  estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '', ...p,
});

describe('computeTotals', () => {
  it('suma egresos, pagado, separado y pendiente', () => {
    const t = computeTotals({
      ingresos: 1000,
      rows: [
        row({ monto: 300, estado: 'pagado', fecha: null, fechaPago: '2026-08-05' }),
        row({ monto: 200, estado: 'separado' }),
        row({ monto: 100, estado: 'pendiente' }),
        row({ monto: null, estado: 'pendiente' }),
      ],
    });
    expect(t).toEqual({ egresos: 600, pagado: 300, separado: 200, pendiente: 300, diferencia: 400, sinMonto: 1 });
  });

  it('con cero filas todo es cero salvo diferencia = ingresos', () => {
    expect(computeTotals({ ingresos: 50, rows: [] })).toEqual({
      egresos: 0, pagado: 0, separado: 0, pendiente: 0, diferencia: 50, sinMonto: 0,
    });
  });
});
