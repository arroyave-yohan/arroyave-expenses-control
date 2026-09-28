import type { BolsillosDoc, CategoriasDoc, Estado, MonthDoc, Row } from '../shared/types';
import { newRowId } from '../shared/ids';
import type { HistoryEntry } from './history';
import type { Seleccion } from './selection';

export type EstadoFilter = 'todos' | Estado;
export type SortKey = 'concepto' | 'monto' | 'categoriaId' | 'estado' | 'bolsillo' | 'fecha';
export interface Filters {
  q: string;
  estado: EstadoFilter;
  bolsillo: string;
  categorias: Set<string | null>;
  group: boolean;
  sort: { k: SortKey | null; dir: 1 | -1 };
}
export type SyncStatus = 'guardado' | 'guardando' | 'sin-guardar' | 'conflicto';
export interface AppState {
  email: string;
  months: string[];
  ym: string | null;
  doc: MonthDoc | null;
  recent: MonthDoc[];
  categorias: CategoriasDoc;
  bolsillos: BolsillosDoc;
  filters: Filters;
  focusId: string | null;
  sync: SyncStatus;
  syncDetail: string;
  history: HistoryEntry[];
  redoCount: number;
  offline: boolean;
  sel: Seleccion;
}

export function initialFilters(): Filters {
  return { q: '', estado: 'todos', bolsillo: '', categorias: new Set(), group: false, sort: { k: null, dir: 1 } };
}

export const ESTADOS: Estado[] = ['pendiente', 'separado', 'pagado'];
export const ESTADO_LABEL: Record<Estado, string> = { pendiente: 'Pend', separado: 'Sep', pagado: 'Pag' };
export const ESTADO_LONG: Record<Estado, string> = { pendiente: 'Pendiente', separado: 'Separado', pagado: 'Pagado' };

export function nextEstado(e: Estado): Estado {
  return ESTADOS[(ESTADOS.indexOf(e) + 1) % ESTADOS.length];
}

export function withEstado(row: Row, estado: Estado, today: string): Row {
  if (estado === 'pagado') return { ...row, estado, fechaPago: row.estado === 'pagado' && row.fechaPago ? row.fechaPago : today };
  return { ...row, estado, fechaPago: null };
}

export function newRow(): Row {
  return { id: newRowId(), concepto: 'Nuevo gasto', monto: null, categoriaId: null, recurrente: false, estado: 'pendiente', fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '' };
}

export function duplicateRow(row: Row): Row {
  return { ...row, id: newRowId(), estado: 'pendiente', fechaPago: null };
}

export function catName(cats: CategoriasDoc, id: string | null): string {
  if (id === null) return '';
  return cats.items.find((c) => c.id === id)?.nombre ?? id;
}

export function catHue(cats: CategoriasDoc, id: string | null): number {
  return cats.items.find((c) => c.id === id)?.hue ?? 0;
}

export function baseFiltered(doc: MonthDoc, f: Filters, cats: CategoriasDoc): Row[] {
  const q = f.q.trim().toLowerCase();
  return doc.rows.filter((r) => {
    if (f.estado !== 'todos' && r.estado !== f.estado) return false;
    if (f.bolsillo && r.bolsillo !== f.bolsillo) return false;
    if (q && !`${r.concepto} ${r.bolsillo} ${r.ref} ${catName(cats, r.categoriaId)}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function compare(a: Row, b: Row, k: SortKey, cats: CategoriasDoc): number {
  if (k === 'monto') {
    if (a.monto === null && b.monto === null) return 0;
    if (a.monto === null) return 1;
    if (b.monto === null) return -1;
    return a.monto - b.monto;
  }
  if (k === 'fecha') {
    if (a.fecha === null && b.fecha === null) return 0;
    if (a.fecha === null) return 1;
    if (b.fecha === null) return -1;
    return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0;
  }
  if (k === 'estado') return ESTADOS.indexOf(a.estado) - ESTADOS.indexOf(b.estado);
  if (k === 'categoriaId') return catName(cats, a.categoriaId).localeCompare(catName(cats, b.categoriaId), 'es');
  return String(a[k]).localeCompare(String(b[k]), 'es');
}

export function visibleRows(doc: MonthDoc, f: Filters, cats: CategoriasDoc): Row[] {
  let rows = baseFiltered(doc, f, cats);
  if (f.categorias.size) rows = rows.filter((r) => f.categorias.has(r.categoriaId));
  if (f.sort.k) {
    const k = f.sort.k;
    rows = rows.slice().sort((a, b) => {
      const c = compare(a, b, k, cats);
      // los montos nulos van siempre al final, sin importar la dirección
      if ((k === 'monto' || k === 'fecha') && (a[k] === null || b[k] === null)) return c;
      return c * f.sort.dir;
    });
  }
  if (f.group) {
    const order = new Map<string | null, number>(cats.items.map((c, i) => [c.id, i]));
    const pos = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : (order.get(id) ?? Number.MAX_SAFE_INTEGER - 1));
    rows = rows.slice().sort((a, b) => pos(a.categoriaId) - pos(b.categoriaId));
  }
  return rows;
}

export function chipTotals(doc: MonthDoc, f: Filters, cats?: CategoriasDoc): Map<string | null, { total: number; count: number }> {
  const out = new Map<string | null, { total: number; count: number }>();
  for (const r of baseFiltered(doc, f, cats ?? { version: 0, items: [] })) {
    const cur = out.get(r.categoriaId) ?? { total: 0, count: 0 };
    out.set(r.categoriaId, { total: cur.total + (r.monto ?? 0), count: cur.count + 1 });
  }
  return out;
}

export function bolsilloNombres(s: AppState, extra = ''): string[] {
  const names = s.bolsillos.items.slice().sort((a, b) => a.orden - b.orden).map((b) => b.nombre);
  if (extra && !names.includes(extra)) names.push(extra);
  return names;
}
