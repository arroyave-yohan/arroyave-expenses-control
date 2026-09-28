import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { readBody } from './body';
import { BolsillosInputSchema, RenameBolsilloSchema } from './schema';
import { getBolsillos, getIndex, getMonth, putBolsillos, putMonth } from './kv';
import { uniqueSlug } from '../shared/slug';
import type { BolsillosDoc, MonthDoc } from '../shared/types';

export const bolsillosRoutes = new Hono<AppEnv>();

bolsillosRoutes.get('/', async (c) => c.json(await getBolsillos(c.env.GASTOS_KV)));

bolsillosRoutes.put('/', async (c) => {
  const body = await readBody(c, BolsillosInputSchema);
  if (!body.ok) return body.response;
  const input = body.value;
  const current = await getBolsillos(c.env.GASTOS_KV);
  if (current.version !== input.version) {
    return c.json({ error: 'conflict', message: 'Los bolsillos cambiaron en otro dispositivo', current }, 409);
  }
  const nextNames = new Set(input.items.map((i) => i.nombre));
  const removed = current.items.map((i) => i.nombre).filter((n) => !nextNames.has(n));
  if (removed.length > 0) {
    const months = await getIndex(c.env.GASTOS_KV);
    const docs = await Promise.all(months.map((ym) => getMonth(c.env.GASTOS_KV, ym)));
    for (const nombre of removed) {
      const used = docs.filter((d) => d?.rows.some((r) => r.bolsillo.trim() === nombre)).map((d) => d!.month);
      if (used.length > 0) {
        return c.json({ error: 'in_use', bolsillo: nombre, months: used, message: `El bolsillo "${nombre}" está en uso en: ${used.join(', ')}` }, 409);
      }
    }
  }
  const doc: BolsillosDoc = { version: current.version + 1, items: input.items };
  await putBolsillos(c.env.GASTOS_KV, doc);
  return c.json(doc);
});

bolsillosRoutes.post('/rename', async (c) => {
  const body = await readBody(c, RenameBolsilloSchema);
  if (!body.ok) return body.response;
  const { from, to, version } = body.value;
  const kv = c.env.GASTOS_KV;

  // Fetch bolsillos before any month writes, so the seed (if it needs to run) never sees
  // already-rewritten month data.
  const current = await getBolsillos(kv);
  if (current.version !== version) {
    return c.json({ error: 'conflict', message: 'Los bolsillos cambiaron en otro dispositivo', current }, 409);
  }

  // Read (and thereby validate) every month doc BEFORE writing any of them. If any month is
  // corrupt, getMonth throws and nothing below has been written yet.
  const months = await getIndex(kv);
  const docs = await Promise.all(months.map((ym) => getMonth(kv, ym)));
  const toWrite = months
    .map((ym, i) => ({ ym, doc: docs[i] }))
    .filter((m): m is { ym: string; doc: MonthDoc } => m.doc !== null && m.doc.rows.some((r) => r.bolsillo.trim() === from));

  const changed: string[] = [];
  for (const { ym, doc } of toWrite) {
    await putMonth(kv, { ...doc, version: doc.version + 1, updatedAt: new Date().toISOString(), rows: doc.rows.map((r) => (r.bolsillo.trim() === from ? { ...r, bolsillo: to } : r)) });
    changed.push(ym);
  }

  let items = current.items.slice();
  const target = items.find((b) => b.nombre === to);
  const source = items.find((b) => b.nombre === from);
  if (source && target) items = items.filter((b) => b !== source);
  else if (source) source.nombre = to;
  else if (!target) items.push({ id: uniqueSlug(to, items.map((b) => b.id)), nombre: to, orden: items.length });
  items = items.map((b, orden) => ({ ...b, orden }));
  const doc: BolsillosDoc = { version: current.version + 1, items };
  await putBolsillos(kv, doc);
  return c.json({ bolsillos: doc, months: changed });
});
