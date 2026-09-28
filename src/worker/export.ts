import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { getBolsillos, getCategorias, getIndex, getMonth } from './kv';
import type { Categoria, MonthDoc } from '../shared/types';

const CSV_HEADER = ['month', 'id', 'concepto', 'monto', 'categoria', 'recurrente', 'estado', 'fecha', 'fechaPago', 'bolsillo', 'link', 'ref'];

function csvCell(v: string | number | boolean | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(months: MonthDoc[], categorias: Categoria[]): string {
  const nombre = new Map(categorias.map((c) => [c.id, c.nombre]));
  const lines = [CSV_HEADER.join(',')];
  for (const m of months) {
    for (const r of m.rows) {
      lines.push(
        [
          m.month, r.id, r.concepto, r.monto, r.categoriaId === null ? null : (nombre.get(r.categoriaId) ?? r.categoriaId),
          r.recurrente, r.estado, r.fecha, r.fechaPago, r.bolsillo, r.link, r.ref,
        ].map(csvCell).join(','),
      );
    }
  }
  return lines.join('\r\n');
}

export const exportRoutes = new Hono<AppEnv>();

exportRoutes.get('/', async (c) => {
  const kv = c.env.GASTOS_KV;
  const [categorias, index] = await Promise.all([getCategorias(kv), getIndex(kv)]);
  const months = (await Promise.all(index.map((ym) => getMonth(kv, ym)))).filter((d): d is MonthDoc => d !== null);
  const day = new Date().toISOString().slice(0, 10);

  if (c.req.query('format') === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="expenses-control-${day}.csv"`);
    return c.body(toCsv(months, categorias.items));
  }

  const bolsillos = await getBolsillos(kv);
  c.header('Content-Disposition', `attachment; filename="expenses-control-${day}.json"`);
  return c.json({ exportedAt: new Date().toISOString(), categorias, bolsillos, months });
});
