import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { readBody } from './body';
import { CategoriasInputSchema } from './schema';
import { getCategorias, getIndex, getMonth, putCategorias } from './kv';
import type { CategoriasDoc } from '../shared/types';

export const categoriasRoutes = new Hono<AppEnv>();

categoriasRoutes.get('/', async (c) => c.json(await getCategorias(c.env.GASTOS_KV)));

categoriasRoutes.put('/', async (c) => {
  const body = await readBody(c, CategoriasInputSchema);
  if (!body.ok) return body.response;
  const input = body.value;

  const current = await getCategorias(c.env.GASTOS_KV);
  if (current.version !== input.version) {
    return c.json({ error: 'conflict', message: 'Las categorías cambiaron en otro dispositivo', current }, 409);
  }

  const nextIds = new Set(input.items.map((i) => i.id));
  const removed = current.items.filter((i) => !nextIds.has(i.id)).map((i) => i.id);
  if (removed.length > 0) {
    const months = await getIndex(c.env.GASTOS_KV);
    const docs = await Promise.all(months.map((ym) => getMonth(c.env.GASTOS_KV, ym)));
    for (const id of removed) {
      const used = docs.filter((d) => d?.rows.some((r) => r.categoriaId === id)).map((d) => d!.month);
      if (used.length > 0) {
        return c.json(
          { error: 'in_use', categoriaId: id, months: used, message: `La categoría ${id} está en uso en: ${used.join(', ')}` },
          409,
        );
      }
    }
  }

  const doc: CategoriasDoc = { version: current.version + 1, items: input.items };
  await putCategorias(c.env.GASTOS_KV, doc);
  return c.json(doc);
});
