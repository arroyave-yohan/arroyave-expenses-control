/** Lectura de un movimiento en una captura bancaria (lo que devuelve el modelo, ya validado). */
export interface Lectura {
  comercio: string;
  fecha: string | null;       // YYYY-MM-DD
  hora: string | null;        // HH:MM
  monto: number | null;       // pesos, entero
  tipo: 'compra' | 'transferencia' | 'otro';
  canal: string | null;       // Bre-B, PSE, tarjeta…
  referencia: string | null;  // número de aprobación / referencia si aparece
  banco: string | null;       // Bancolombia, Nequi, Nu…
}
export interface Alias { concepto: string; categoriaId: string | null; bolsillo: string; usadoEn: string }
export interface RecibosDoc { aliases: Record<string, Alias> }
export const RECIBOS_VACIO: RecibosDoc = { aliases: {} };
export const MAX_ALIASES = 300;

/** Saca el primer objeto JSON de un texto (tolera cercas ``` y texto alrededor). Lanza si no hay JSON válido. */
/** El modelo a veces escribe el monto con puntos de miles como número JSON (`"monto": 180.000` se parsearía como 180).
 *  Quita esos puntos (y los decimales ",00") solo en valores numéricos de "monto"; los textos entre comillas no se tocan. */
export function arreglarMontos(texto: string): string {
  return texto.replace(/("monto"\s*:\s*)-?\$?\s*(\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?(?=\s*[,}\]])/g, (_, k: string, n: string) => k + n.replace(/\./g, ''));
}
export function extraerJson(texto: string): unknown {
  const sinCercas = texto.replace(/```(?:json)?/gi, '');
  const ini = sinCercas.indexOf('{'), fin = sinCercas.lastIndexOf('}');
  if (ini < 0 || fin <= ini) throw new Error('sin JSON');
  return JSON.parse(sinCercas.slice(ini, fin + 1));
}
/** Clave estable para la memoria de emparejamientos: minúsculas, sin tildes, sin dígitos ni puntuación. */
export function normalizarComercio(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-zñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function tituloDe(comercio: string): string {
  return comercio.trim().toLowerCase().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}
/** Si el modelo devolvió una fecha a más de ~6 meses de hoy (año inventado), la lleva al año de hoy (o al anterior si quedaría en el futuro). */
export function corregirAnio(fecha: string | null, hoy: string): string | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const dias = (a: string, b: string) => { const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 86400000); };
  if (Math.abs(dias(hoy, fecha)) <= 180) return fecha;
  const [, mm, dd] = fecha.split('-'); const anio = Number(hoy.slice(0, 4));
  const valida = (f: string) => { const [y, m, d] = f.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  for (const y of [anio, anio - 1]) { const c = `${y}-${mm}-${dd}`; if (valida(c) && dias(hoy, c) <= 30) return c; }
  return fecha;
}
export function mesDe(fecha: string | null): string | null {
  return fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha.slice(0, 7) : null;
}
