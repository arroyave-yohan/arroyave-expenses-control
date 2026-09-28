import type { Row } from '../shared/types';
import type { Alias, Lectura } from '../shared/recibos';
import { normalizarComercio, tituloDe, mesDe } from '../shared/recibos';
import { daysBetween } from '../shared/dates';
import { newRowId } from '../shared/ids';

export interface Sugerencia { row: Row; puntaje: number; motivo: string[] }

const tokens = (s: string) => new Set(normalizarComercio(s).split(' ').filter((t) => t.length >= 3));
const parecidoNombre = (a: string, b: string) => {
  const ta = tokens(a), tb = tokens(b); if (!ta.size || !tb.size) return 0;
  let comunes = 0; for (const t of ta) if (tb.has(t)) comunes++;
  return comunes / Math.min(ta.size, tb.size);
};

/** Gastos pendientes/separados que podrían corresponder al recibo, de mayor a menor puntaje (máx. 5). */
export function sugerir(l: Lectura, rows: Row[], aliases: Record<string, Alias>, today: string): Sugerencia[] {
  const alias = aliases[normalizarComercio(l.comercio)];
  const out: Sugerencia[] = [];
  for (const r of rows) {
    if (r.estado === 'pagado') continue;
    let puntaje = 0; const motivo: string[] = [];
    if (l.monto !== null && r.monto !== null && r.monto > 0) {
      const dif = Math.abs(r.monto - l.monto) / r.monto;
      if (r.monto === l.monto) { puntaje += 60; motivo.push('mismo monto'); }
      else if (dif <= 0.02) { puntaje += 40; motivo.push('monto casi igual'); }
      else if (dif <= 0.10) { puntaje += 15; motivo.push('monto cercano'); }
    }
    const nombre = Math.max(parecidoNombre(l.comercio, r.concepto), parecidoNombre(l.comercio, r.bolsillo), alias ? parecidoNombre(alias.concepto, r.concepto) : 0);
    if (nombre > 0) { puntaje += Math.round(40 * nombre); motivo.push('nombre parecido'); }
    if (l.fecha && r.fecha && Math.abs(daysBetween(l.fecha, r.fecha)) <= 7) { puntaje += 10; motivo.push('fecha cercana'); }
    if (puntaje > 0) out.push({ row: r, puntaje, motivo });
  }
  return out.sort((a, b) => b.puntaje - a.puntaje || a.row.concepto.localeCompare(b.row.concepto, 'es')).slice(0, 5);
}

/** Fila nueva ya pagada a partir de la lectura (y del alias si existe). */
export function propuestaNueva(l: Lectura, alias: Alias | undefined, today: string): Row {
  return {
    id: newRowId(), concepto: alias?.concepto ?? tituloDe(l.comercio), monto: l.monto, categoriaId: alias?.categoriaId ?? null,
    recurrente: false, estado: 'pagado', fecha: null, fechaPago: l.fecha ?? today, bolsillo: alias?.bolsillo ?? '', link: '', ref: l.referencia ?? '',
  };
}

/** Mes del recibo si existe; si no, el actual; si no, el último; null sin meses. */
export function mesDestino(l: Lectura, months: string[], currentYm: string): string | null {
  const m = mesDe(l.fecha);
  if (m && months.includes(m)) return m;
  if (months.includes(currentYm)) return currentYm;
  return months.at(-1) ?? null;
}
