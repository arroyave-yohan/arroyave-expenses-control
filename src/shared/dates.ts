import type { Estado } from './types';

/** Traslada una fecha al mismo día de otro mes; si el día no existe, al último día. */
export function shiftDateToMonth(iso: string | null, ym: string): string | null {
  if (!iso) return null;
  const day = parseInt(iso.slice(8, 10), 10);
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** Días de diferencia (b - a), ambos YYYY-MM-DD, sin efectos de zona horaria. */
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

export type Vencimiento = 'vencida' | 'proxima' | null;

/** Estado de vencimiento de una fila no pagada: pasada → vencida; hoy o en `ventana` días → próxima. */
export function vencimiento(fecha: string | null, estado: Estado, today: string, ventana = 3): Vencimiento {
  if (!fecha || estado === 'pagado') return null;
  const d = daysBetween(today, fecha);
  if (d < 0) return 'vencida';
  if (d <= ventana) return 'proxima';
  return null;
}

export function resumenVencimientos(rows: { fecha: string | null; estado: Estado }[], today: string): { vencidas: number; proximas: number } {
  let vencidas = 0, proximas = 0;
  for (const r of rows) { const v = vencimiento(r.fecha, r.estado, today); if (v === 'vencida') vencidas++; else if (v === 'proxima') proximas++; }
  return { vencidas, proximas };
}

export const ZONA = 'America/Bogota';

/** Fecha (YYYY-MM-DD) y hora (0-23) locales de `now` en la zona dada. */
export function partesLocales(now: Date, zona: string = ZONA): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** 'Septiembre 2026' a partir de '2026-09'. */
export function etiquetaMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1] ?? ym} ${y}`;
}
