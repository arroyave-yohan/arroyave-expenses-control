// Datos de prueba para el smoke en CI: un mes (Agosto 2026) con filas variadas, cargado por la API local
// (wrangler dev con ACCESS_BYPASS=1). La primera fila está pagada porque el smoke la pasa a "separado".
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787';
const row = (id, concepto, monto, estado, bolsillo, extra = {}) => ({ id, concepto, monto, categoriaId: null, recurrente: true, estado, fecha: null, fechaPago: estado === 'pagado' ? '2026-08-05' : null, bolsillo, link: '', ref: '', ...extra });
const rows = [
  row('r_ci_arriendo', 'Arriendo', 1250000, 'pagado', 'Nu: Arriendo'),
  row('r_ci_luz', 'Luz', 180000, 'pendiente', 'Datafono', { ref: '1234567890' }),
  row('r_ci_agua', 'Agua', 95000, 'pendiente', 'Datafono'),
  row('r_ci_internet', 'Internet', 120000, 'separado', 'Global66'),
  row('r_ci_gas', 'Gas', null, 'pendiente', 'Datafono'),
  row('r_ci_netflix', 'Netflix', 45000, 'pendiente', 'Global66'),
];
const res = await fetch(`${BASE}/api/months/2026-08`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 0, month: '2026-08', ingresos: 5000000, rows }) });
if (!res.ok && res.status !== 409) { console.error('seed falló', res.status, await res.text()); process.exit(1); }
console.log('seed', res.status, (await res.json()).rows?.length ?? '(ya existía)');
