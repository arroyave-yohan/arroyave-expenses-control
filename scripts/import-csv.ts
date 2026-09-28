/**
 * Uso:
 *   npm run import:csv -- 2026-08=./csv/agosto.csv 2026-09=./csv/septiembre.csv [--ingresos 2026-08=12400000]
 * Escribe import/bulk.json listo para:
 *   npx wrangler kv bulk put import/bulk.json --binding GASTOS_KV --remote
 * El bulk incluye meta:categorias (semilla) e index:months con TODOS los meses pasados, así que
 * importa todos los meses en una sola corrida.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseSheetCsv, toMonthDoc } from './import-csv/parse';
import { computeTotals } from '../src/shared/totals';
import { SEED_CATEGORIAS } from '../src/worker/seed';
import type { CategoriasDoc, MonthsIndex } from '../src/shared/types';

const args = process.argv.slice(2);
const ingresosOverrides = new Map<string, number>();
const inputs: { month: string; file: string }[] = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ingresos') {
    const raw = args[++i] ?? '';
    const [m, v] = raw.split('=');
    const n = parseInt(v ?? '', 10);
    if (!m || !/^\d{4}-\d{2}$/.test(m) || !Number.isFinite(n) || n < 0) {
      console.error(`Valor inválido para --ingresos: "${raw}". Formato esperado: YYYY-MM=monto (monto >= 0).`);
      process.exit(1);
    }
    ingresosOverrides.set(m, n);
    continue;
  }
  const eq = a.indexOf('=');
  if (eq === -1 || !/^\d{4}-\d{2}$/.test(a.slice(0, eq))) {
    console.error(`Argumento no reconocido: ${a}. Formato esperado: YYYY-MM=ruta.csv`);
    process.exit(1);
  }
  inputs.push({ month: a.slice(0, eq), file: a.slice(eq + 1) });
}
if (inputs.length === 0) {
  console.error('Pasa al menos un mes: YYYY-MM=ruta.csv');
  process.exit(1);
}

const bulk: { key: string; value: string }[] = [];
const months: string[] = [];

for (const { month, file } of inputs) {
  const text = readFileSync(file, 'utf8');
  const parsed = parseSheetCsv(text);
  const { doc, unmatched } = toMonthDoc(parsed, month, SEED_CATEGORIAS, ingresosOverrides.get(month));
  const t = computeTotals(doc);
  console.log(`${month}: ${doc.rows.length} filas · ingresos ${doc.ingresos} · egresos ${t.egresos} · pagado ${t.pagado} · pendiente ${t.pendiente} · sin monto ${t.sinMonto}`);
  if (unmatched.length) console.warn(`  categorías sin coincidencia (quedan null): ${unmatched.join(', ')}`);
  bulk.push({ key: `month:${month}`, value: JSON.stringify(doc) });
  months.push(month);
}

const categorias: CategoriasDoc = { version: 1, items: SEED_CATEGORIAS };
const index: MonthsIndex = { months: [...new Set(months)].sort() };
bulk.push({ key: 'meta:categorias', value: JSON.stringify(categorias) });
bulk.push({ key: 'index:months', value: JSON.stringify(index) });

mkdirSync('import', { recursive: true });
writeFileSync('import/bulk.json', JSON.stringify(bulk, null, 2));
console.log(`\nEscrito import/bulk.json con ${bulk.length} claves.`);
console.log('Siguiente paso: npx wrangler kv bulk put import/bulk.json --binding GASTOS_KV --remote');
