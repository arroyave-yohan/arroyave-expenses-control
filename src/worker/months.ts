import { Hono, type Context } from 'hono';
import type { AppEnv } from './auth';
import { DuplicateInputSchema, MonthInputSchema, YM_REGEX, type DuplicateInput } from './schema';
import { readBody } from './body';
import { addToIndex, deleteMonth, getCategorias, getIndex, getMonth, getMonthRaw, putMonth, removeFromIndex } from './kv';
import { newRowId } from '../shared/ids';
import { shiftDateToMonth } from '../shared/dates';
import type { MonthDoc } from '../shared/types';

export const monthsRoutes = new Hono<AppEnv>();

function badYm(c: Context<AppEnv>) {
  return c.json({ error: 'bad_request', message: 'El mes debe tener formato YYYY-MM' }, 400);
}

monthsRoutes.get('/', async (c) => {
  return c.json({ months: await getIndex(c.env.GASTOS_KV) });
});

monthsRoutes.get('/:ym/raw', async (c) => {
  const ym = c.req.param('ym');
  if (!YM_REGEX.test(ym)) return badYm(c);
  const raw = await getMonthRaw(c.env.GASTOS_KV, ym);
  if (raw === null) return c.json({ error: 'not_found', message: `El mes ${ym} no existe` }, 404);
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(raw);
});

monthsRoutes.get('/:ym', async (c) => {
  const ym = c.req.param('ym');
  if (!YM_REGEX.test(ym)) return badYm(c);
  const doc = await getMonth(c.env.GASTOS_KV, ym);
  if (!doc) return c.json({ error: 'not_found', message: `El mes ${ym} no existe` }, 404);
  return c.json(doc);
});

monthsRoutes.put('/:ym', async (c) => {
  const ym = c.req.param('ym');
  if (!YM_REGEX.test(ym)) return badYm(c);

  const body = await readBody(c, MonthInputSchema);
  if (!body.ok) return body.response;
  const input = body.value;
  if (input.month !== ym) return c.json({ error: 'bad_request', message: 'month no coincide con la URL' }, 400);

  const categorias = await getCategorias(c.env.GASTOS_KV);
  const known = new Set(categorias.items.map((i) => i.id));
  const unknown = input.rows.find((r) => r.categoriaId !== null && !known.has(r.categoriaId));
  if (unknown) {
    return c.json({ error: 'unknown_categoria', message: `La categoría ${unknown.categoriaId} no existe` }, 400);
  }

  const current = await getMonth(c.env.GASTOS_KV, ym);
  if (current && current.version !== input.version) {
    return c.json({ error: 'conflict', message: 'El mes cambió en otro dispositivo', current }, 409);
  }

  const doc: MonthDoc = {
    version: (current?.version ?? 0) + 1,
    month: ym,
    ingresos: input.ingresos,
    updatedAt: new Date().toISOString(),
    rows: input.rows,
  };
  await putMonth(c.env.GASTOS_KV, doc);
  await addToIndex(c.env.GASTOS_KV, ym);
  return c.json(doc);
});

export function buildDuplicate(source: MonthDoc, target: string, opts: DuplicateInput, now: string): MonthDoc {
  const rows = source.rows
    .filter((r) => !opts.soloRecurrentes || r.recurrente)
    .map((r) => ({
      ...r,
      id: newRowId(),
      estado: opts.resetEstado ? ('pendiente' as const) : r.estado,
      fechaPago: opts.resetEstado ? null : r.fechaPago,
      fecha: shiftDateToMonth(r.fecha, target),
      monto: opts.mantenerMontos ? r.monto : null,
    }));
  return {
    version: 0,
    month: target,
    ingresos: opts.mantenerIngresos ? source.ingresos : 0,
    updatedAt: now,
    rows,
  };
}

monthsRoutes.post('/:ym/duplicate', async (c) => {
  const ym = c.req.param('ym');
  if (!YM_REGEX.test(ym)) return badYm(c);

  const body = await readBody(c, DuplicateInputSchema);
  if (!body.ok) return body.response;
  const opts = body.value;
  if (opts.target === ym) return c.json({ error: 'bad_request', message: 'El destino debe ser otro mes' }, 400);

  const source = await getMonth(c.env.GASTOS_KV, ym);
  if (!source) return c.json({ error: 'not_found', message: `El mes ${ym} no existe` }, 404);

  const existing = await getMonth(c.env.GASTOS_KV, opts.target);
  if (existing && !opts.reemplazar) {
    return c.json({ error: 'exists', message: `El mes ${opts.target} ya existe` }, 409);
  }

  const doc = buildDuplicate(source, opts.target, opts, new Date().toISOString());
  doc.version = (existing?.version ?? 0) + 1;
  await putMonth(c.env.GASTOS_KV, doc);
  await addToIndex(c.env.GASTOS_KV, opts.target);
  return c.json(doc, 201);
});

monthsRoutes.delete('/:ym', async (c) => {
  const ym = c.req.param('ym');
  if (!YM_REGEX.test(ym)) return badYm(c);
  const current = await getMonth(c.env.GASTOS_KV, ym);
  if (!current) return c.json({ error: 'not_found', message: `El mes ${ym} no existe` }, 404);
  await removeFromIndex(c.env.GASTOS_KV, ym);
  await deleteMonth(c.env.GASTOS_KV, ym);
  return c.body(null, 204);
});
