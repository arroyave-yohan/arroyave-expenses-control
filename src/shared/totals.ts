import type { MonthDoc, Totals } from './types';

export function computeTotals(doc: Pick<MonthDoc, 'ingresos' | 'rows'>): Totals {
  let egresos = 0, pagado = 0, separado = 0, sinMonto = 0;
  for (const r of doc.rows) {
    if (r.monto === null) { sinMonto++; continue; }
    egresos += r.monto;
    if (r.estado === 'pagado') pagado += r.monto;
    else if (r.estado === 'separado') separado += r.monto;
  }
  return { egresos, pagado, separado, pendiente: egresos - pagado, diferencia: doc.ingresos - egresos, sinMonto };
}
