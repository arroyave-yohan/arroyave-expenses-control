import type { Categoria, Estado, MonthDoc, Row } from '../../src/shared/types';
import { newRowId } from '../../src/shared/ids';

export interface SheetRow {
  fecha: string;
  concepto: string;
  monto: number | null;
  categoria: string;
  recurrente: boolean;
  separado: boolean;
  pagado: boolean;
  bolsillo: string;
  link: string;
  ref: string;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* ignorar */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseMonto(s: string): number | null {
  const digits = (s ?? '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function normalize(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const bool = (s: string | undefined) => normalize(s ?? '') === 'true';

export function parseSheetCsv(text: string): { ingresos: number | null; rows: SheetRow[] } {
  const grid = parseCsv(text);
  let ingresos: number | null = null;
  let headerIdx = -1;
  for (let i = 0; i < grid.length; i++) {
    const r = grid[i];
    if (normalize(r[0]) === 'ingresos' && ingresos === null) ingresos = parseMonto(r[1] ?? '');
    if (normalize(r[0]) === 'fecha' && normalize(r[1]) === 'concepto') { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('No encontré la fila de encabezado "Fecha,Concepto,..."');

  const header = grid[headerIdx].map(normalize);
  const col = (name: string) => header.indexOf(name);
  const idx = {
    fecha: col('fecha'), concepto: col('concepto'), monto: col('monto'), categoria: col('categoria'),
    recurrente: col('recurrente'), separado: col('separado?'), pagado: col('pagado?'),
    bolsillo: col('bolsillo/medio de pago'), link: col('link de pago'), ref: col('ref de pago'),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  const rows: SheetRow[] = [];
  for (const r of grid.slice(headerIdx + 1)) {
    const concepto = get(r, idx.concepto);
    if (!concepto) continue;
    rows.push({
      fecha: get(r, idx.fecha),
      concepto,
      monto: parseMonto(get(r, idx.monto)),
      categoria: get(r, idx.categoria),
      recurrente: bool(get(r, idx.recurrente)),
      separado: idx.separado >= 0 ? bool(get(r, idx.separado)) : false,
      pagado: bool(get(r, idx.pagado)),
      bolsillo: get(r, idx.bolsillo),
      link: get(r, idx.link),
      ref: get(r, idx.ref),
    });
  }
  return { ingresos, rows };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "jueves, 5 de febrero" → "YYYY-02-05" usando el año del mes importado; null si no se entiende. */
export function parseFechaEs(fecha: string, year: string): string | null {
  const m = normalize(fecha).match(/(\d{1,2}) de ([a-z]+)/);
  if (!m) return null;
  const mes = MESES.indexOf(m[2]);
  if (mes === -1) return null;
  return `${year}-${String(mes + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function toMonthDoc(
  parsed: { ingresos: number | null; rows: SheetRow[] },
  month: string,
  categorias: Categoria[],
  ingresosOverride?: number,
): { doc: MonthDoc; unmatched: string[] } {
  const byName = new Map(categorias.map((c) => [normalize(c.nombre), c.id]));
  const unmatched = new Set<string>();
  const year = month.slice(0, 4);

  const rows: Row[] = parsed.rows.map((s) => {
    let categoriaId: string | null = null;
    if (s.categoria) {
      categoriaId = byName.get(normalize(s.categoria)) ?? null;
      if (categoriaId === null) unmatched.add(s.categoria);
    }
    const estado: Estado = s.pagado ? 'pagado' : s.separado ? 'separado' : 'pendiente';
    return {
      id: newRowId(),
      concepto: s.concepto,
      monto: s.monto,
      categoriaId,
      recurrente: s.recurrente,
      estado,
      fecha: parseFechaEs(s.fecha, year),
      fechaPago: estado === 'pagado' ? parseFechaEs(s.fecha, year) : null,
      bolsillo: s.bolsillo,
      link: s.link,
      ref: s.ref,
    };
  });

  const doc: MonthDoc = {
    version: 1,
    month,
    ingresos: ingresosOverride ?? parsed.ingresos ?? 0,
    updatedAt: new Date().toISOString(),
    rows,
  };
  return { doc, unmatched: [...unmatched] };
}
