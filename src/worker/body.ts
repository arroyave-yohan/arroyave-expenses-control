import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './auth';
import { parseBody } from './schema';

export type ReadBodyResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Lee y valida el body JSON. Si falla, `response` ya es el 400 listo para devolver. */
export async function readBody<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<ReadBodyResult<z.infer<S>>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch {
    return { ok: false, response: c.json({ error: 'bad_request', message: 'Body JSON inválido' }, 400) };
  }
  const parsed = parseBody(schema, raw);
  if (!parsed.ok) return { ok: false, response: c.json({ error: 'bad_request', message: parsed.message }, 400) };
  return { ok: true, value: parsed.value };
}
