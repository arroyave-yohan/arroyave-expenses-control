import type { BolsillosDoc, CategoriasDoc, MonthDoc } from '../shared/types';
import type { AccionAviso, AccionRespuesta, AvisosConfig, AvisosEstado } from '../shared/avisos';
import type { Lectura, RecibosDoc } from '../shared/recibos';
import type { EnvioResumen, PushInfo, PushSubInput, PushSubPublic } from './push';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: unknown = null) {
    super(message);
    this.name = 'ApiError';
  }
}
export class ConflictError extends ApiError {
  current: unknown;
  constructor(status: number, code: string, message: string, body: { current?: unknown }) {
    super(status, code, message, body);
    this.name = 'ConflictError';
    this.current = body.current ?? null;
  }
}

export interface DuplicateOpts {
  target: string; soloRecurrentes: boolean; resetEstado: boolean; mantenerMontos: boolean; mantenerIngresos: boolean; reemplazar: boolean;
}

export function createApi(deps: { fetchFn?: typeof fetch; onUnauthorized?: () => void } = {}) {
  const fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
  const onUnauthorized = deps.onUnauthorized ?? (() => { (globalThis as { location?: { reload(): void } }).location?.reload(); });

  async function call<T>(method: string, path: string, body?: unknown, parse: 'json' | 'text' = 'json'): Promise<T> {
    const init: RequestInit = { method, headers: {} };
    if (body instanceof Blob) { init.headers = { 'Content-Type': body.type || 'image/jpeg' }; init.body = body; }
    else if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    const res = await fetchFn(path, init);
    const ct = res.headers.get('Content-Type') ?? '';
    if (res.redirected || (res.ok && res.status !== 204 && parse === 'json' && !ct.includes('application/json'))) {
      onUnauthorized();
      throw new ApiError(401, 'unauthorized', 'Sesión expirada');
    }
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (parse === 'text' ? await res.text() : await res.json()) as T;
    }
    let payload: { error?: string; message?: string; current?: unknown } = {};
    try { payload = await res.json(); } catch { /* cuerpo no JSON */ }
    const code = payload.error ?? 'internal';
    const message = payload.message ?? `Error ${res.status}`;
    if (res.status === 401) onUnauthorized();
    if (res.status === 409) throw new ConflictError(res.status, code, message, payload);
    throw new ApiError(res.status, code, message, payload);
  }

  return {
    me: () => call<{ email: string }>('GET', '/api/me'),
    months: async () => (await call<{ months: string[] }>('GET', '/api/months')).months,
    month: (ym: string) => call<MonthDoc>('GET', `/api/months/${ym}`),
    monthRaw: (ym: string) => call<string>('GET', `/api/months/${ym}/raw`, undefined, 'text'),
    putMonth: (doc: MonthDoc) => call<MonthDoc>('PUT', `/api/months/${doc.month}`, { version: doc.version, month: doc.month, ingresos: doc.ingresos, rows: doc.rows }),
    duplicate: (ym: string, opts: DuplicateOpts) => call<MonthDoc>('POST', `/api/months/${ym}/duplicate`, opts),
    deleteMonth: (ym: string) => call<void>('DELETE', `/api/months/${ym}`),
    categorias: () => call<CategoriasDoc>('GET', '/api/categorias'),
    putCategorias: (doc: CategoriasDoc) => call<CategoriasDoc>('PUT', '/api/categorias', doc),
    bolsillos: () => call<BolsillosDoc>('GET', '/api/bolsillos'),
    putBolsillos: (doc: BolsillosDoc) => call<BolsillosDoc>('PUT', '/api/bolsillos', doc),
    renameBolsillo: (from: string, to: string, version: number) => call<{ bolsillos: BolsillosDoc; months: string[] }>('POST', '/api/bolsillos/rename', { from, to, version }),
    avisos: () => call<AvisosConfig>('GET', '/api/avisos'),
    putAvisos: (doc: AvisosConfig) => call<AvisosConfig>('PUT', '/api/avisos', doc),
    enviarAviso: () => call<{ skipped?: string; enviadas?: number; eliminadas?: number; fallidas?: number }>('POST', '/api/avisos/enviar'),
    avisosEstado: () => call<AvisosEstado>('GET', '/api/avisos/estado'),
    accionAviso: (body: AccionAviso) => call<AccionRespuesta>('POST', '/api/avisos/accion', body),
    push: () => call<PushInfo>('GET', '/api/push'),
    subscribePush: (sub: PushSubInput) => call<PushSubPublic>('POST', '/api/push', sub),
    unsubscribePush: (id: string) => call<void>('DELETE', `/api/push/${id}`),
    pruebaPush: (id?: string) => call<EnvioResumen>('POST', '/api/push/prueba', id ? { id } : {}),
    analizarRecibo: (imagen: Blob) => call<{ lectura: Lectura; movimientos: number }>('POST', '/api/recibos/analizar', imagen),
    recibosAlias: () => call<RecibosDoc>('GET', '/api/recibos/alias'),
    putReciboAlias: (a: { comercio: string; concepto: string; categoriaId: string | null; bolsillo: string }) => call<RecibosDoc>('POST', '/api/recibos/alias', a),
    exportUrl: (format: 'json' | 'csv') => (format === 'csv' ? '/api/export?format=csv' : '/api/export'),
  };
}
export type Api = ReturnType<typeof createApi>;
