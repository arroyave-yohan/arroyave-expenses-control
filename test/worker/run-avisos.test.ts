import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { enviarATodos, runAvisos, type PushSender } from '../../src/worker/push';
import { getAvisosEstado, getPushDoc, keys, putAvisosConfig, putAvisosEstado, putPushDoc, putMonth, addToIndex } from '../../src/worker/kv';
import { AVISOS_DEFAULT, AVISOS_ESTADO_VACIO, type PushSub } from '../../src/shared/avisos';
import type { Bindings, MonthDoc, Row } from '../../src/shared/types';

const sub = (id: string): PushSub => ({ id, endpoint: `https://push.example/${id}`, expirationTime: null, keys: { p256dh: 'k', auth: 'a' }, nombre: id, createdAt: '2026-09-01T00:00:00.000Z' });
const row = (concepto: string, fecha: string | null, estado: Row['estado'] = 'pendiente'): Row =>
  ({ id: 'r_' + concepto.toLowerCase(), concepto, monto: 5000, categoriaId: null, recurrente: true, estado, fecha, fechaPago: null, bolsillo: '', link: '', ref: '' });
const month = (ym: string, ...rows: Row[]): MonthDoc => ({ version: 1, month: ym, ingresos: 0, updatedAt: '2026-09-01T00:00:00.000Z', rows });
/** Remitente falso: responde según el id de la suscripción y registra lo enviado. */
function fakeSender(status: Record<string, number | Error> = {}) {
  const sent: { id: string; title: string; body: string; url: string; tag: string }[] = [];
  const sender: PushSender = async (s, data) => {
    const r = status[s.id] ?? 201;
    if (r instanceof Error) throw r;
    sent.push({ id: s.id, ...data });
    return { status: r };
  };
  return { sender, sent };
}
// 2026-09-22 08:xx en Colombia = 13:xx UTC
const AT_7 = new Date('2026-09-22T12:10:00Z');
const AT_8 = new Date('2026-09-22T13:10:00Z');
const AT_9 = new Date('2026-09-22T14:10:00Z');

beforeEach(async () => {
  for (const k of [keys.avisos, keys.push, keys.avisosEstado, keys.index, 'month:2026-08', 'month:2026-09']) await env.GASTOS_KV.delete(k);
  await putMonth(env.GASTOS_KV, month('2026-09', row('Arriendo', '2026-09-22'), row('Luz', '2026-09-20'), row('Lejos', '2026-10-20')));
  await addToIndex(env.GASTOS_KV, '2026-09');
});

describe('enviarATodos', () => {
  it('envía a todas, elimina las 404/410 y cuenta las fallidas sin abortar', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('ok'), sub('muerta'), sub('rota'), sub('excepcion')] });
    const { sender, sent } = fakeSender({ muerta: 410, rota: 500, excepcion: new Error('red') });
    const r = await enviarATodos(env.GASTOS_KV, await getPushDoc(env.GASTOS_KV), sender, { title: 'T', body: 'B', url: '/', tag: 'prueba' });
    expect(r).toEqual({ enviadas: 1, eliminadas: 1, fallidas: 2 });
    expect(sent.map((s) => s.id)).toEqual(['ok', 'muerta', 'rota']);
    expect((await getPushDoc(env.GASTOS_KV)).items.map((s) => s.id)).toEqual(['ok', 'rota', 'excepcion']);
  });
  it('con ids solo envía a esas suscripciones', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('a'), sub('b')] });
    const { sender, sent } = fakeSender();
    const r = await enviarATodos(env.GASTOS_KV, await getPushDoc(env.GASTOS_KV), sender, { title: 'T', body: 'B', url: '/', tag: 'prueba' }, ['b']);
    expect(r.enviadas).toBe(1);
    expect(sent[0].id).toBe('b');
  });
});

describe('runAvisos', () => {
  const LUZ = '2026-09/r_luz', ARRIENDO = '2026-09/r_arriendo';
  const tagsDe = (sent: { id: string; tag: string }[], sub = 'a') => sent.filter((s) => s.id === sub).map((s) => s.tag);

  it('sin claves VAPID no hace nada', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    expect(await runAvisos({ ...env, VAPID_PRIVATE_KEY: '' } as Bindings, { now: AT_8, sender })).toEqual({ skipped: 'sin-claves' });
    expect(sent).toHaveLength(0);
  });
  it('omite antes de la hora configurada', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    expect(await runAvisos(env, { now: AT_7, sender })).toEqual({ skipped: 'hora' });
    expect(sent).toHaveLength(0);
  });
  it('omite sin suscripciones', async () => {
    const { sender } = fakeSender();
    expect(await runAvisos(env, { now: AT_8, sender })).toEqual({ skipped: 'sin-suscripciones' });
  });
  it('a la hora: una notificación por urgente con botones, marca el envío y no repite el mismo día', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('a'), sub('b')] });
    const { sender, sent } = fakeSender();
    const r = await runAvisos(env, { now: AT_8, sender });
    expect(r).toMatchObject({ enviadas: 4, eliminadas: 0, fallidas: 0, individuales: 2, resumen: false, titulo: '2 avisos individuales', at: AT_8.toISOString() });
    expect(tagsDe(sent)).toEqual(['gasto-r_luz', 'gasto-r_arriendo']);
    expect(sent[0]).toMatchObject({ title: 'Luz · $ 5.000', body: 'venció hace 2 d · Septiembre 2026', url: '/#2026-09', tipo: 'gasto' });
    expect((sent[0] as { actions?: unknown }).actions).toEqual([{ action: 'pagar', title: 'Pagado' }, { action: 'aplazar', title: 'Aplazar 3 h' }]);
    expect((sent[0] as { data?: unknown }).data).toEqual({ ym: '2026-09', rowId: 'r_luz', concepto: 'Luz', horas: 3 });
    const estado = await getAvisosEstado(env.GASTOS_KV);
    expect(estado.gastos[LUZ]).toEqual({ enviado: AT_8.toISOString(), aplazadoHasta: null, silenciadoFecha: null });
    expect(estado.gastos[ARRIENDO].enviado).toBe(AT_8.toISOString());
    expect(estado.ultimoEnvio).toBe('2026-09-22');
    expect(estado.ultimoResultado?.individuales).toBe(2);
    expect(await runAvisos(env, { now: AT_9, sender })).toEqual({ skipped: 'nada' });
    expect(sent).toHaveLength(4);
  });
  it('con próximas envía además el resumen (solo próximas) con sus botones', async () => {
    await putMonth(env.GASTOS_KV, month('2026-09', row('Arriendo', '2026-09-22'), row('Agua', '2026-09-24')));
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    const r = await runAvisos(env, { now: AT_8, sender });
    expect(r).toMatchObject({ enviadas: 2, individuales: 1, resumen: true, titulo: 'Gastos: 1 próxima' });
    expect(tagsDe(sent)).toEqual(['gasto-r_arriendo', 'aviso-diario']);
    expect(sent[1]).toMatchObject({ tipo: 'resumen', body: 'Agua · $ 5.000 · vence en 2 d' });
    expect((sent[1] as { actions?: unknown }).actions).toEqual([{ action: 'mastarde', title: 'Más tarde' }, { action: 'ver', title: 'Ver' }]);
    expect((await getAvisosEstado(env.GASTOS_KV)).resumen).toEqual({ enviado: AT_8.toISOString(), aplazadoHasta: null });
  });
  it('desborde: con maxIndividuales 1 todo va en el resumen', async () => {
    await putAvisosConfig(env.GASTOS_KV, { ...AVISOS_DEFAULT, version: 1, maxIndividuales: 1 });
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    const r = await runAvisos(env, { now: AT_8, sender });
    expect(r).toMatchObject({ enviadas: 1, individuales: 0, resumen: true, titulo: 'Gastos: 1 vencida · 1 hoy' });
    expect(tagsDe(sent)).toEqual(['aviso-diario']);
  });
  it('desborde: al enviar el resumen se marcan como enviadas las urgentes que incluye, para no reenviarlas individualmente después', async () => {
    await putAvisosConfig(env.GASTOS_KV, { ...AVISOS_DEFAULT, version: 1, maxIndividuales: 1 });
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    const r = await runAvisos(env, { now: AT_8, sender });
    expect(r).toMatchObject({ individuales: 0, resumen: true });
    const estado = await getAvisosEstado(env.GASTOS_KV);
    expect(estado.gastos[LUZ].enviado).toBe(AT_8.toISOString());
    expect(estado.gastos[ARRIENDO].enviado).toBe(AT_8.toISOString());
    // más tarde, el mismo día y con maxIndividuales normal, ya no se reenvían individualmente (ni el resumen, sin próximas)
    await putAvisosConfig(env.GASTOS_KV, { ...AVISOS_DEFAULT, version: 2, maxIndividuales: 5 });
    const antes = sent.length;
    expect(await runAvisos(env, { now: AT_9, sender })).toEqual({ skipped: 'nada' });
    expect(sent).toHaveLength(antes);
  });
  it('aplazado: no sale mientras esté vigente y se reenvía al vencer aunque ya se envió hoy', async () => {
    await putAvisosEstado(env.GASTOS_KV, { ...AVISOS_ESTADO_VACIO, gastos: { [LUZ]: { enviado: AT_8.toISOString(), aplazadoHasta: '2026-09-22T15:00:00.000Z', silenciadoFecha: null } } });
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    await runAvisos(env, { now: AT_9, sender });
    expect(tagsDe(sent)).toEqual(['gasto-r_arriendo']);
    await runAvisos(env, { now: new Date('2026-09-22T15:10:00Z'), sender });
    expect(tagsDe(sent)).toEqual(['gasto-r_arriendo', 'gasto-r_luz']);
    const e = await getAvisosEstado(env.GASTOS_KV);
    expect(e.gastos[LUZ]).toEqual({ enviado: '2026-09-22T15:10:00.000Z', aplazadoHasta: null, silenciadoFecha: null });
  });
  it('silenciado para su fecha no sale y se conserva en el estado', async () => {
    await putAvisosEstado(env.GASTOS_KV, { ...AVISOS_ESTADO_VACIO, gastos: { [LUZ]: { enviado: null, aplazadoHasta: null, silenciadoFecha: '2026-09-20' } } });
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    await runAvisos(env, { now: AT_8, sender });
    expect(tagsDe(sent)).toEqual(['gasto-r_arriendo']);
    expect((await getAvisosEstado(env.GASTOS_KV)).gastos[LUZ].silenciadoFecha).toBe('2026-09-20');
  });
  it('si todos los envíos fallan no marca nada y reintenta en la siguiente hora', async () => {
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender({ a: 500 });
    const r = await runAvisos(env, { now: AT_8, sender });
    expect(r).toMatchObject({ enviadas: 0, fallidas: 2 });
    const e = await getAvisosEstado(env.GASTOS_KV);
    expect(e.gastos[LUZ]?.enviado ?? null).toBeNull();
    expect(e.ultimoEnvio).toBeNull();
    await runAvisos(env, { now: AT_9, sender });
    expect(sent).toHaveLength(4);
  });
  it('force envía todo ignorando envíos y aplazamientos, y no escribe gastos ni resumen', async () => {
    const previo = { ...AVISOS_ESTADO_VACIO, gastos: { [LUZ]: { enviado: AT_8.toISOString(), aplazadoHasta: '2026-09-22T20:00:00.000Z', silenciadoFecha: null }, [ARRIENDO]: { enviado: AT_8.toISOString(), aplazadoHasta: null, silenciadoFecha: null } }, resumen: { enviado: AT_8.toISOString(), aplazadoHasta: null } };
    await putAvisosEstado(env.GASTOS_KV, previo);
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender, sent } = fakeSender();
    const r = await runAvisos(env, { now: AT_9, sender, force: true });
    expect((r as { enviadas: number }).enviadas).toBe(2);
    expect(tagsDe(sent)).toEqual(['gasto-r_luz', 'gasto-r_arriendo']);
    const e = await getAvisosEstado(env.GASTOS_KV);
    expect(e.gastos).toEqual(previo.gastos);
    expect(e.resumen).toEqual(previo.resumen);
    expect(e.ultimoEnvio).toBeNull();
    expect(e.ultimoResultado?.individuales).toBe(2);
  });
  it('sin nada que avisar devuelve nada y guarda el estado podado', async () => {
    await putMonth(env.GASTOS_KV, month('2026-09', row('Lejos', '2026-10-20')));
    await putAvisosEstado(env.GASTOS_KV, { ...AVISOS_ESTADO_VACIO, gastos: { 'x/y': { enviado: null, aplazadoHasta: null, silenciadoFecha: null } } });
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender } = fakeSender();
    expect(await runAvisos(env, { now: AT_8, sender })).toEqual({ skipped: 'nada' });
    expect((await getAvisosEstado(env.GASTOS_KV)).gastos).toEqual({});
  });
  it('omite un mes corrupto y lo anota', async () => {
    await env.GASTOS_KV.put('month:2026-08', '{no json');
    await addToIndex(env.GASTOS_KV, '2026-08');
    await putPushDoc(env.GASTOS_KV, { items: [sub('a')] });
    const { sender } = fakeSender();
    expect(await runAvisos(env, { now: AT_8, sender })).toMatchObject({ enviadas: 2, mesesOmitidos: ['2026-08'] });
  });
});
