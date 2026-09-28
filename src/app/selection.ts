import type { Estado, Row } from '../shared/types';
import { withEstado } from './state';

export interface Seleccion { on: boolean; ids: Set<string>; anchor: string | null }
export const seleccionVacia = (): Seleccion => ({ on: false, ids: new Set(), anchor: null });

export function alternar(ids: Set<string>, id: string): Set<string> {
  const n = new Set(ids); if (n.has(id)) n.delete(id); else n.add(id); return n;
}
/** Marca todas las filas entre el ancla y `id` según el orden visible; sin ancla válida, alterna solo `id`. */
export function rango(orden: string[], anchor: string | null, id: string, ids: Set<string>): Set<string> {
  const i = orden.indexOf(id), j = anchor === null ? -1 : orden.indexOf(anchor);
  if (i < 0 || j < 0) return alternar(ids, id);
  const n = new Set(ids); for (let k = Math.min(i, j); k <= Math.max(i, j); k++) n.add(orden[k]); return n;
}
export function podar(ids: Set<string>, visibles: string[]): Set<string> {
  const v = new Set(visibles); return new Set([...ids].filter((id) => v.has(id)));
}
export function resumen(rows: Row[], ids: Set<string>): { count: number; total: number; sinMonto: number } {
  let count = 0, total = 0, sinMonto = 0;
  for (const r of rows) { if (!ids.has(r.id)) continue; count++; if (r.monto === null) sinMonto++; else total += r.monto; }
  return { count, total, sinMonto };
}
export function aplicarEstado(rows: Row[], ids: Set<string>, estado: Estado, today: string): Row[] {
  return rows.map((r) => (ids.has(r.id) ? withEstado(r, estado, today) : r));
}
export function aplicarPatch(rows: Row[], ids: Set<string>, patch: Partial<Pick<Row, 'categoriaId' | 'bolsillo' | 'fecha'>>): Row[] {
  return rows.map((r) => (ids.has(r.id) ? { ...r, ...patch } : r));
}
export function eliminar(rows: Row[], ids: Set<string>): { rows: Row[]; quitadas: { index: number; row: Row }[] } {
  const quitadas: { index: number; row: Row }[] = [];
  const rest = rows.filter((r, index) => { if (!ids.has(r.id)) return true; quitadas.push({ index, row: r }); return false; });
  return { rows: rest, quitadas };
}
/** Reinserta en orden ascendente de índice; un índice más allá del final va al final. */
export function restaurar(rows: Row[], quitadas: { index: number; row: Row }[]): Row[] {
  const out = rows.slice();
  for (const q of [...quitadas].sort((a, b) => a.index - b.index)) out.splice(Math.min(q.index, out.length), 0, q.row);
  return out;
}
export const filas = (n: number) => `${n} fila${n === 1 ? '' : 's'}`;
export function etiquetaMasiva(accion: string, n: number, valor: string): string {
  return `${accion}: ${filas(n)} → ${valor}`;
}
