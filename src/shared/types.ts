import type { Ai, KVNamespace, Fetcher } from '@cloudflare/workers-types/experimental';

export type Estado = 'pendiente' | 'separado' | 'pagado';

export interface Row {
  id: string;
  concepto: string;
  monto: number | null;
  categoriaId: string | null;
  recurrente: boolean;
  estado: Estado;
  fecha: string | null; // YYYY-MM-DD, fecha límite / plan de pago (independiente del estado)
  fechaPago: string | null; // YYYY-MM-DD, solo cuando estado === 'pagado'
  bolsillo: string;
  link: string;
  ref: string;
}

export interface MonthDoc {
  version: number;
  month: string; // YYYY-MM
  ingresos: number;
  updatedAt: string; // ISO
  rows: Row[];
}

export interface Categoria {
  id: string;
  nombre: string;
  hue: number; // 0-359
  orden: number;
}

export interface CategoriasDoc {
  version: number;
  items: Categoria[];
}

export interface MonthsIndex {
  months: string[]; // ascendente
}

export interface Bolsillo {
  id: string;
  nombre: string;
  orden: number;
}

export interface BolsillosDoc {
  version: number;
  items: Bolsillo[];
}

export interface Totals {
  egresos: number;
  pagado: number;
  separado: number;
  pendiente: number;
  diferencia: number;
  sinMonto: number;
}

export interface Bindings {
  GASTOS_KV: KVNamespace;
  AI?: Ai;
  ACCESS_TEAM: string;
  ACCESS_AUD: string;
  ACCESS_BYPASS?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ASSETS: Fetcher;
}
