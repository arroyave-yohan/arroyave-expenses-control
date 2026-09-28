import { z } from 'zod';

export const YM_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const RowSchema = z
  .object({
    id: z.string().min(1).max(40),
    concepto: z.string().min(1).max(200),
    monto: z.number().int().min(0).nullable(),
    categoriaId: z.string().max(40).nullable(),
    recurrente: z.boolean(),
    estado: z.enum(['pendiente', 'separado', 'pagado']),
    fecha: z.string().regex(DATE_REGEX).nullable().default(null),
    fechaPago: z.string().regex(DATE_REGEX).nullable(),
    bolsillo: z.string().trim().max(100),
    link: z.string().max(500),
    ref: z.string().max(200),
  })
  .refine((r) => r.estado === 'pagado' || r.fechaPago === null, {
    message: 'fechaPago solo aplica cuando estado es pagado',
    path: ['fechaPago'],
  });

const MonthBaseSchema = z.object({
  version: z.number().int().min(0),
  month: z.string().regex(YM_REGEX, 'month debe ser YYYY-MM'),
  ingresos: z.number().int().min(0),
  rows: z.array(RowSchema).max(500),
});
const uniqueRowIds = (m: { rows: { id: string }[] }) => new Set(m.rows.map((r) => r.id)).size === m.rows.length;

export const MonthInputSchema = MonthBaseSchema.refine(uniqueRowIds, { message: 'ids de fila repetidos', path: ['rows'] });

export const MonthDocSchema = MonthBaseSchema
  .extend({ updatedAt: z.string().min(1) })
  .refine(uniqueRowIds, { message: 'ids de fila repetidos', path: ['rows'] });

export const DuplicateInputSchema = z.object({
  target: z.string().regex(YM_REGEX, 'target debe ser YYYY-MM'),
  soloRecurrentes: z.boolean().default(true),
  resetEstado: z.boolean().default(true),
  mantenerMontos: z.boolean().default(true),
  mantenerIngresos: z.boolean().default(true),
  reemplazar: z.boolean().default(false),
});

export const CategoriaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, 'id solo minúsculas, dígitos y guiones'),
  nombre: z.string().min(1).max(60),
  hue: z.number().int().min(0).max(359),
  orden: z.number().int().min(0),
});

export const CategoriasInputSchema = z
  .object({
    version: z.number().int().min(0),
    items: z.array(CategoriaSchema).max(100),
  })
  .refine((c) => new Set(c.items.map((i) => i.id)).size === c.items.length, {
    message: 'ids de categoría repetidos',
    path: ['items'],
  });

export const BolsilloSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, 'id solo minúsculas, dígitos y guiones'),
  nombre: z.string().trim().min(1).max(60),
  orden: z.number().int().min(0),
});
export const BolsillosInputSchema = z
  .object({ version: z.number().int().min(0), items: z.array(BolsilloSchema).max(200) })
  .refine((b) => new Set(b.items.map((i) => i.id)).size === b.items.length, { message: 'ids de bolsillo repetidos', path: ['items'] })
  .refine((b) => new Set(b.items.map((i) => i.nombre.toLowerCase())).size === b.items.length, { message: 'nombres de bolsillo repetidos', path: ['items'] });
export const RenameBolsilloSchema = z
  .object({ from: z.string().trim().min(1).max(100), to: z.string().trim().min(1).max(100), version: z.number().int().min(0) })
  .refine((r) => r.from !== r.to, { message: 'from y to deben ser distintos', path: ['to'] });

export const AvisosConfigSchema = z.object({
  version: z.number().int().min(0),
  hora: z.number().int().min(0).max(23),
  ventanaDias: z.number().int().min(0).max(14),
  incluir: z.object({ vencidas: z.boolean(), hoy: z.boolean(), proximas: z.boolean() }),
  soloSiHayAlgo: z.boolean(),
  aplazarHoras: z.number().int().min(1).max(24).default(3),
  maxIndividuales: z.number().int().min(0).max(20).default(5),
});
export const PushSubInputSchema = z.object({
  endpoint: z.string().regex(/^https:\/\/\S+$/, 'endpoint debe ser una URL https').max(2000),
  expirationTime: z.number().nullable().default(null),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  nombre: z.string().trim().min(1).max(60),
});
export const PushSubSchema = PushSubInputSchema.extend({ id: z.string().min(1).max(40), createdAt: z.string() });
export const PushDocSchema = z.object({ items: z.array(PushSubSchema).max(20) });
const GastoEstadoSchema = z.object({
  enviado: z.string().nullable().default(null),
  aplazadoHasta: z.string().nullable().default(null),
  silenciadoFecha: z.string().nullable().default(null),
});
export const AvisosEstadoSchema = z.object({
  ultimoEnvio: z.string().nullable(),
  ultimoResultado: z
    .object({
      at: z.string(),
      titulo: z.string().nullable(),
      enviadas: z.number().int(),
      eliminadas: z.number().int(),
      fallidas: z.number().int(),
      mesesOmitidos: z.array(z.string()),
      individuales: z.number().int().default(0),
      resumen: z.boolean().default(false),
    })
    .nullable(),
  gastos: z.record(z.string(), GastoEstadoSchema).default({}),
  resumen: z.object({ enviado: z.string().nullable().default(null), aplazadoHasta: z.string().nullable().default(null) }).default({ enviado: null, aplazadoHasta: null }),
});
const GastoRef = { ym: z.string().regex(YM_REGEX, 'ym debe ser YYYY-MM'), rowId: z.string().min(1).max(40) };
const Horas = z.number().int().min(0).max(24).optional();
export const AccionSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('pagar'), ...GastoRef }),
  z.object({ accion: z.literal('aplazar'), ...GastoRef, horas: Horas }),
  z.object({ accion: z.literal('silenciar'), ...GastoRef, valor: z.boolean() }),
  z.object({ accion: z.literal('mastarde'), horas: Horas }),
]);
export type Accion = z.infer<typeof AccionSchema>;
export const PushPruebaSchema = z.object({ id: z.string().min(1).max(40).optional() });

const enteroPesos = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(Math.abs(v));
  if (typeof v === 'string') { const n = Number(v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(Math.abs(n)) : null; }
  return null;
}, z.number().int().min(0).nullable());
export const LecturaSchema = z.object({
  comercio: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 120) : ''), z.string()),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  hora: z.string().regex(/^\d{2}:\d{2}$/).nullable().catch(null),
  monto: enteroPesos,
  tipo: z.enum(['compra', 'transferencia', 'otro']).catch('otro'),
  canal: z.string().max(40).nullable().catch(null),
  referencia: z.string().max(60).nullable().catch(null),
  banco: z.string().max(40).nullable().catch(null),
});
export const MovimientosSchema = z.object({ movimientos: z.array(LecturaSchema).min(1) });
export const AliasInputSchema = z.object({ comercio: z.string().trim().min(1).max(120), concepto: z.string().trim().min(1).max(200), categoriaId: z.string().max(40).nullable(), bolsillo: z.string().trim().max(100) });
export const RecibosDocSchema = z.object({ aliases: z.record(z.string(), z.object({ concepto: z.string(), categoriaId: z.string().nullable(), bolsillo: z.string(), usadoEn: z.string() })).default({}) });

export type MonthInput = z.infer<typeof MonthInputSchema>;
export type DuplicateInput = z.infer<typeof DuplicateInputSchema>;
export type CategoriasInput = z.infer<typeof CategoriasInputSchema>;

export function parseBody<S extends z.ZodType>(
  schema: S,
  data: unknown,
): { ok: true; value: z.infer<S> } | { ok: false; message: string } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  const message = r.error.issues
    .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
    .join('; ');
  return { ok: false, message };
}
