import type { z } from 'zod';
import type { Bolsillo, BolsillosDoc, CategoriasDoc, MonthDoc, MonthsIndex } from '../shared/types';
import type { AvisosConfig, AvisosEstado, PushDoc } from '../shared/avisos';
import { AVISOS_DEFAULT, AVISOS_ESTADO_VACIO } from '../shared/avisos';
import type { RecibosDoc } from '../shared/recibos';
import { RECIBOS_VACIO } from '../shared/recibos';
import { uniqueSlug } from '../shared/slug';
import { SEED_CATEGORIAS } from './seed';
import { AvisosConfigSchema, AvisosEstadoSchema, MonthDocSchema, PushDocSchema, RecibosDocSchema } from './schema';

export const keys = {
  month: (ym: string) => `month:${ym}`,
  index: 'index:months',
  categorias: 'meta:categorias',
  bolsillos: 'meta:bolsillos',
  avisos: 'meta:avisos',
  push: 'meta:push',
  avisosEstado: 'meta:avisos-estado',
  recibos: 'meta:recibos',
} as const;

export class SchemaError extends Error {
  constructor(public key: string, detail: string) {
    super(`El documento ${key} no tiene un esquema válido: ${detail}`);
    this.name = 'SchemaError';
  }
}

export async function getMonthRaw(kv: KVNamespace, ym: string): Promise<string | null> {
  return kv.get(keys.month(ym), 'text');
}

export async function getMonth(kv: KVNamespace, ym: string): Promise<MonthDoc | null> {
  const raw = await getMonthRaw(kv, ym);
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new SchemaError(keys.month(ym), 'JSON inválido'); }
  const r = MonthDocSchema.safeParse(parsed);
  if (!r.success) {
    throw new SchemaError(keys.month(ym), r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return r.data;
}

export async function putMonth(kv: KVNamespace, doc: MonthDoc): Promise<void> {
  await kv.put(keys.month(doc.month), JSON.stringify(doc));
}

export async function deleteMonth(kv: KVNamespace, ym: string): Promise<void> {
  await kv.delete(keys.month(ym));
}

export async function getIndex(kv: KVNamespace): Promise<string[]> {
  const idx = await kv.get<MonthsIndex>(keys.index, 'json');
  return idx?.months ?? [];
}

async function writeIndex(kv: KVNamespace, months: string[]): Promise<void> {
  const sorted = [...new Set(months)].sort();
  await kv.put(keys.index, JSON.stringify({ months: sorted } satisfies MonthsIndex));
}

export async function addToIndex(kv: KVNamespace, ym: string): Promise<void> {
  const months = await getIndex(kv);
  if (!months.includes(ym)) await writeIndex(kv, [...months, ym]);
}

export async function removeFromIndex(kv: KVNamespace, ym: string): Promise<void> {
  const months = await getIndex(kv);
  if (months.includes(ym)) await writeIndex(kv, months.filter((m) => m !== ym));
}

export async function getCategorias(kv: KVNamespace): Promise<CategoriasDoc> {
  const existing = await kv.get<CategoriasDoc>(keys.categorias, 'json');
  if (existing) return existing;
  const seeded: CategoriasDoc = { version: 1, items: SEED_CATEGORIAS };
  await putCategorias(kv, seeded);
  return seeded;
}

export async function putCategorias(kv: KVNamespace, doc: CategoriasDoc): Promise<void> {
  await kv.put(keys.categorias, JSON.stringify(doc));
}

export async function seedBolsillosFromMonths(kv: KVNamespace): Promise<BolsillosDoc> {
  const months = await getIndex(kv);
  const docs = await Promise.all(months.map((ym) => getMonth(kv, ym).catch(() => null)));
  const names = new Set<string>();
  for (const d of docs) for (const r of d?.rows ?? []) { const n = r.bolsillo.trim(); if (n) names.add(n); }
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'es'));
  const ids: string[] = [];
  const items: Bolsillo[] = sorted.map((nombre, orden) => { const id = uniqueSlug(nombre, ids); ids.push(id); return { id, nombre, orden }; });
  const doc: BolsillosDoc = { version: 1, items };
  await putBolsillos(kv, doc);
  return doc;
}
export async function getBolsillos(kv: KVNamespace): Promise<BolsillosDoc> {
  const existing = await kv.get<BolsillosDoc>(keys.bolsillos, 'json');
  return existing ?? seedBolsillosFromMonths(kv);
}
export async function putBolsillos(kv: KVNamespace, doc: BolsillosDoc): Promise<void> {
  await kv.put(keys.bolsillos, JSON.stringify(doc));
}

/** Lee un documento meta validándolo; null si no existe; SchemaError si no valida. */
async function getValidado<T>(kv: KVNamespace, key: string, schema: z.ZodType<T, unknown>): Promise<T | null> {
  const raw = await kv.get(key, 'text');
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new SchemaError(key, 'JSON inválido'); }
  const r = schema.safeParse(parsed);
  if (!r.success) throw new SchemaError(key, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export async function getAvisosConfig(kv: KVNamespace): Promise<AvisosConfig> {
  return (await getValidado(kv, keys.avisos, AvisosConfigSchema)) ?? AVISOS_DEFAULT;
}
export async function putAvisosConfig(kv: KVNamespace, doc: AvisosConfig): Promise<void> {
  await kv.put(keys.avisos, JSON.stringify(doc));
}
export async function getPushDoc(kv: KVNamespace): Promise<PushDoc> {
  return (await getValidado(kv, keys.push, PushDocSchema)) ?? { items: [] };
}
export async function putPushDoc(kv: KVNamespace, doc: PushDoc): Promise<void> {
  await kv.put(keys.push, JSON.stringify(doc));
}
export async function getAvisosEstado(kv: KVNamespace): Promise<AvisosEstado> {
  return (await getValidado(kv, keys.avisosEstado, AvisosEstadoSchema)) ?? AVISOS_ESTADO_VACIO;
}
export async function putAvisosEstado(kv: KVNamespace, doc: AvisosEstado): Promise<void> {
  await kv.put(keys.avisosEstado, JSON.stringify(doc));
}
export async function getRecibos(kv: KVNamespace): Promise<RecibosDoc> {
  return (await getValidado(kv, keys.recibos, RecibosDocSchema)) ?? RECIBOS_VACIO;
}
export async function putRecibos(kv: KVNamespace, doc: RecibosDoc): Promise<void> {
  await kv.put(keys.recibos, JSON.stringify(doc));
}
