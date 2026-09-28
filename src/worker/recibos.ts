import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { readBody } from './body';
import { AliasInputSchema, MovimientosSchema } from './schema';
import { getRecibos, putRecibos } from './kv';
import type { Bindings } from '../shared/types';
import { extraerJson, arreglarMontos, normalizarComercio, corregirAnio, MAX_ALIASES, type RecibosDoc } from '../shared/recibos';
import { partesLocales } from '../shared/dates';

export type Analizador = (imagen: ArrayBuffer, tipo: string) => Promise<string>;
export const MODELO = '@cf/meta/llama-4-scout-17b-16e-instruct';
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 4 * 1024 * 1024;
const SYSTEM = 'Eres un extractor de datos de capturas de pantalla de apps bancarias colombianas (Bancolombia, Nequi, Nu, Davivienda). Respondes únicamente con JSON válido, sin texto adicional ni markdown.';
const userPrompt = (hoy: string) => `Extrae TODOS los movimientos de la imagen. Devuelve exactamente este JSON:
{"movimientos":[{"comercio":"nombre tal como aparece","fecha":"YYYY-MM-DD","hora":"HH:MM","monto":entero_en_pesos,"tipo":"compra|transferencia|otro","canal":"Bre-B|PSE|tarjeta|null","referencia":"número de aprobación o referencia si aparece, si no null","banco":"Bancolombia|Nequi|Nu|Davivienda|otro|null"}]}
Reglas: el monto es el valor principal en pesos sin decimales (299.960,00 → 299960); IGNORA las líneas de impuesto como "4xMil"; hoy es ${hoy} (Colombia): si el año no aparece en la imagen usa el año de hoy (o el anterior si la fecha quedaría en el futuro); "Enviaste a X" es una transferencia con comercio = X.`;

/** Codifica un ArrayBuffer en base64 sin depender de Node (btoa es global en Workers). */
function aBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binario = '';
  const paso = 0x8000;
  for (let i = 0; i < bytes.length; i += paso) binario += String.fromCharCode(...bytes.subarray(i, i + paso));
  return btoa(binario);
}

/** Workers AI devuelve `response` como texto o, cuando el modelo emite JSON, ya parseado como objeto: se normaliza a texto. */
export function textoDe(r: unknown): string {
  const o = (r ?? {}) as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const v = o.response ?? o.choices?.[0]?.message?.content ?? '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Analizador real: Workers AI con el modelo de visión. Null si el Worker no tiene el binding. */
export function createAnalizador(env: Bindings): Analizador | null {
  const ai = env.AI; if (!ai) return null;
  return async (imagen, tipo) => {
    const b64 = aBase64(imagen);
    return textoDe(await ai.run(MODELO as Parameters<Ai['run']>[0], {
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: [{ type: 'text', text: userPrompt(partesLocales(new Date()).date) }, { type: 'image_url', image_url: { url: `data:${tipo};base64,${b64}` } }] }],
      max_tokens: 800, temperature: 0,
    } as never));
  };
}

export function recibosRoutes(analizadorFor: (env: Bindings) => Analizador | null) {
  const r = new Hono<AppEnv>();
  r.post('/analizar', async (c) => {
    const analizar = analizadorFor(c.env);
    if (!analizar) return c.json({ error: 'misconfigured', message: 'Falta el binding AI' }, 503);
    const tipo = (c.req.header('Content-Type') ?? '').split(';')[0].trim();
    if (!TIPOS.has(tipo)) return c.json({ error: 'bad_request', message: 'La imagen debe ser JPEG, PNG o WebP' }, 400);
    const len = Number(c.req.header('Content-Length') ?? '0');
    if (len > MAX_BYTES) return c.json({ error: 'bad_request', message: 'La imagen supera 4 MB' }, 400);
    const imagen = await c.req.arrayBuffer();
    if (imagen.byteLength === 0) return c.json({ error: 'bad_request', message: 'No llegó ninguna imagen' }, 400);
    if (imagen.byteLength > MAX_BYTES) return c.json({ error: 'bad_request', message: 'La imagen supera 4 MB' }, 400);
    let texto: string;
    try { texto = await analizar(imagen, tipo); } catch (e) { console.error('recibos: modelo falló', e instanceof Error ? e.message : String(e)); return c.json({ error: 'ia', message: 'No se pudo leer el recibo' }, 502); }
    try {
      const parsed = MovimientosSchema.parse(extraerJson(arreglarMontos(texto)));
      const primera = parsed.movimientos[0];
      return c.json({ lectura: { ...primera, fecha: corregirAnio(primera.fecha, partesLocales(new Date()).date) }, movimientos: parsed.movimientos.length });
    } catch (e) { console.error('recibos: respuesta inválida', e instanceof Error ? e.message : String(e), `${texto.length} caracteres`); return c.json({ error: 'ia', message: 'No se pudo leer el recibo' }, 502); }
  });
  r.get('/alias', async (c) => c.json(await getRecibos(c.env.GASTOS_KV)));
  r.post('/alias', async (c) => {
    const body = await readBody(c, AliasInputSchema); if (!body.ok) return body.response;
    const doc = await getRecibos(c.env.GASTOS_KV);
    const clave = normalizarComercio(body.value.comercio);
    if (!clave) return c.json({ error: 'bad_request', message: 'Comercio vacío' }, 400);
    const aliases = { ...doc.aliases, [clave]: { concepto: body.value.concepto, categoriaId: body.value.categoriaId, bolsillo: body.value.bolsillo, usadoEn: new Date().toISOString() } };
    const claves = Object.keys(aliases).sort((a, b) => aliases[b].usadoEn.localeCompare(aliases[a].usadoEn)).slice(0, MAX_ALIASES);
    const podado: RecibosDoc = { aliases: Object.fromEntries(claves.map((k) => [k, aliases[k]])) };
    await putRecibos(c.env.GASTOS_KV, podado);
    return c.json(podado);
  });
  return r;
}
