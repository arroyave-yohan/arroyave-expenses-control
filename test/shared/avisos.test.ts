import { describe, it, expect } from 'vitest';
import { construirAviso, etiquetaDias, AVISOS_DEFAULT, MAX_LINEAS, planificarAvisos, AVISOS_ESTADO_VACIO, claveGasto, type AvisosConfig, type AvisosEstado, type GastoEstado } from '../../src/shared/avisos';
import type { MonthDoc, Row } from '../../src/shared/types';

const row = (concepto: string, fecha: string | null, estado: Row['estado'] = 'pendiente', monto: number | null = 1000): Row =>
  ({ id: 'r_' + concepto.toLowerCase().replace(/\W/g, ''), concepto, monto, categoriaId: null, recurrente: true, estado, fecha, fechaPago: estado === 'pagado' ? '2026-09-01' : null, bolsillo: '', link: '', ref: '' });
const month = (ym: string, ...rows: Row[]): MonthDoc => ({ version: 1, month: ym, ingresos: 0, updatedAt: '', rows });
const HOY = '2026-09-22';
const cfg = (patch: Partial<AvisosConfig> = {}): AvisosConfig => ({ ...AVISOS_DEFAULT, ...patch });

describe('etiquetaDias', () => {
  it('describe los días en español', () => {
    expect(etiquetaDias(-5)).toBe('venció hace 5 d');
    expect(etiquetaDias(-1)).toBe('venció ayer');
    expect(etiquetaDias(0)).toBe('vence hoy');
    expect(etiquetaDias(1)).toBe('vence mañana');
    expect(etiquetaDias(3)).toBe('vence en 3 d');
  });
});

describe('construirAviso', () => {
  it('clasifica por días, ignora pagadas y sin fecha, y ordena vencidas → hoy → próximas por fecha', () => {
    const docs = [
      month('2026-09', row('Arriendo', '2026-09-22'), row('Luz', '2026-09-20'), row('Agua', '2026-09-25'), row('Gas', '2026-09-26'), row('Netflix', '2026-09-24'), row('Pagada', '2026-09-20', 'pagado'), row('SinFecha', null)),
      month('2026-08', row('Viejo', '2026-08-30')),
    ];
    const a = construirAviso(docs, cfg(), HOY)!;
    expect(a.items.map((i) => i.concepto)).toEqual(['Viejo', 'Luz', 'Arriendo', 'Netflix', 'Agua']);
    expect(a.items.map((i) => i.tipo)).toEqual(['vencida', 'vencida', 'hoy', 'proxima', 'proxima']);
    expect(a.counts).toEqual({ vencida: 2, hoy: 1, proxima: 2 });
    expect(a.title).toBe('Gastos: 2 vencidas · 1 hoy · 2 próximas');
    expect(a.url).toBe('/#2026-08');
    expect(a.tag).toBe('aviso-diario');
    expect(a.body.split('\n')).toEqual([
      'Viejo · $ 1.000 · venció hace 23 d',
      'Luz · $ 1.000 · venció hace 2 d',
      'Arriendo · $ 1.000 · vence hoy',
      'Netflix · $ 1.000 · vence en 2 d',
      'Agua · $ 1.000 · vence en 3 d',
    ]);
  });
  it('usa singular, formatea miles y muestra "sin monto"', () => {
    const a = construirAviso([month('2026-09', row('Arriendo', '2026-09-21', 'pendiente', 1250000), row('Gas', '2026-09-23', 'separado', null))], cfg(), HOY)!;
    expect(a.title).toBe('Gastos: 1 vencida · 1 próxima');
    expect(a.body).toBe('Arriendo · $ 1.250.000 · venció ayer\nGas · sin monto · vence mañana');
    expect(a.url).toBe('/#2026-09');
  });
  it('respeta la ventana y las secciones apagadas', () => {
    const docs = [month('2026-09', row('Luz', '2026-09-20'), row('Hoy', '2026-09-22'), row('Agua', '2026-09-27'))];
    expect(construirAviso(docs, cfg({ ventanaDias: 5 }), HOY)!.counts).toEqual({ vencida: 1, hoy: 1, proxima: 1 });
    expect(construirAviso(docs, cfg({ ventanaDias: 3 }), HOY)!.counts).toEqual({ vencida: 1, hoy: 1, proxima: 0 });
    const soloHoy = construirAviso(docs, cfg({ ventanaDias: 5, incluir: { vencidas: false, hoy: true, proximas: false } }), HOY)!;
    expect(soloHoy.items.map((i) => i.concepto)).toEqual(['Hoy']);
    expect(soloHoy.title).toBe('Gastos: 1 hoy');
  });
  it('recorta a MAX_LINEAS y añade "… y N más"', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`G${i}`, '2026-09-22'));
    const a = construirAviso([month('2026-09', ...rows)], cfg(), HOY)!;
    const lines = a.body.split('\n');
    expect(lines).toHaveLength(MAX_LINEAS + 1);
    expect(lines.at(-1)).toBe('… y 3 más');
  });
  it('sin nada que avisar: null por defecto, o aviso vacío si soloSiHayAlgo es false', () => {
    const docs = [month('2026-09', row('Lejos', '2026-10-30'), row('Pagada', '2026-09-22', 'pagado'))];
    expect(construirAviso(docs, cfg(), HOY)).toBeNull();
    const a = construirAviso(docs, cfg({ soloSiHayAlgo: false }), HOY)!;
    expect(a.title).toBe('Gastos: sin vencimientos');
    expect(a.body).toBe('Nada con fecha en los próximos 3 días');
    expect(a.url).toBe('/');
    expect(a.items).toEqual([]);
  });
  it('a igual fecha ordena por concepto', () => {
    const a = construirAviso([month('2026-09', row('Zeta', '2026-09-22'), row('Alfa', '2026-09-22'))], cfg(), HOY)!;
    expect(a.items.map((i) => i.concepto)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('planificarAvisos', () => {
  const NOW = new Date('2026-09-22T13:10:00Z'); // 08:10 en Colombia
  const docs = () => [month('2026-09', row('Arriendo', '2026-09-22'), row('Luz', '2026-09-20'), row('Agua', '2026-09-24'), row('Pagada', '2026-09-21', 'pagado'), row('Lejos', '2026-10-20'))];
  const estadoCon = (gastos: Record<string, Partial<GastoEstado>>, resumen: Partial<AvisosEstado['resumen']> = {}): AvisosEstado => ({
    ...AVISOS_ESTADO_VACIO,
    gastos: Object.fromEntries(Object.entries(gastos).map(([k, v]) => [k, { enviado: null, aplazadoHasta: null, silenciadoFecha: null, ...v }])),
    resumen: { enviado: null, aplazadoHasta: null, ...resumen },
  });
  const LUZ = claveGasto('2026-09', 'r_luz'), ARRIENDO = claveGasto('2026-09', 'r_arriendo');

  it('modo individual: una notificación por urgente con botones, y resumen solo con próximas', () => {
    const p = planificarAvisos(docs(), cfg(), AVISOS_ESTADO_VACIO, NOW);
    expect(p.modo).toBe('individual');
    expect(p.gastos.map((g) => g.concepto)).toEqual(['Luz', 'Arriendo']);
    const luz = p.gastos[0];
    expect(luz).toMatchObject({ tipo: 'gasto', key: LUZ, ym: '2026-09', rowId: 'r_luz', title: 'Luz · $ 1.000', body: 'venció hace 2 d · Septiembre 2026', url: '/#2026-09', tag: 'gasto-r_luz' });
    expect(luz.actions).toEqual([{ action: 'pagar', title: 'Pagado' }, { action: 'aplazar', title: 'Aplazar 3 h' }]);
    expect(luz.data).toEqual({ ym: '2026-09', rowId: 'r_luz', concepto: 'Luz', horas: 3 });
    expect(p.gastos[1].body).toBe('vence hoy · Septiembre 2026');
    expect(p.resumen).toMatchObject({ tipo: 'resumen', title: 'Gastos: 1 próxima', body: 'Agua · $ 1.000 · vence en 2 d', url: '/#2026-09', tag: 'aviso-diario' });
    expect(p.resumen!.actions).toEqual([{ action: 'mastarde', title: 'Más tarde' }, { action: 'ver', title: 'Ver' }]);
    expect(p.resumen!.data).toEqual({ horas: 3 });
  });
  it('usa aplazarHoras en el botón y en data', () => {
    const p = planificarAvisos(docs(), cfg({ aplazarHoras: 6 }), AVISOS_ESTADO_VACIO, NOW);
    expect(p.gastos[0].actions[1].title).toBe('Aplazar 6 h');
    expect(p.resumen!.data.horas).toBe(6);
  });
  it('modo desborde: más urgentes que el máximo (o máximo 0) → solo resumen con todo', () => {
    for (const maxIndividuales of [1, 0]) {
      const p = planificarAvisos(docs(), cfg({ maxIndividuales }), AVISOS_ESTADO_VACIO, NOW);
      expect(p.modo).toBe('desborde');
      expect(p.gastos).toEqual([]);
      expect(p.resumen!.title).toBe('Gastos: 1 vencida · 1 hoy · 1 próxima');
    }
  });
  it('silenciada para su fecha: fuera de todo; con otra fecha guardada vuelve a avisar', () => {
    const p1 = planificarAvisos(docs(), cfg(), estadoCon({ [LUZ]: { silenciadoFecha: '2026-09-20' } }), NOW);
    expect(p1.gastos.map((g) => g.concepto)).toEqual(['Arriendo']);
    expect(p1.estado.gastos[LUZ].silenciadoFecha).toBe('2026-09-20'); // se conserva
    const p2 = planificarAvisos(docs(), cfg(), estadoCon({ [LUZ]: { silenciadoFecha: '2026-09-19' } }), NOW);
    expect(p2.gastos.map((g) => g.concepto)).toEqual(['Luz', 'Arriendo']);
  });
  it('aplazada vigente: excluida (tampoco cuenta para el modo); al vencer vuelve aunque ya se haya enviado hoy', () => {
    const estado = estadoCon({ [LUZ]: { enviado: '2026-09-22T13:00:00Z', aplazadoHasta: '2026-09-22T15:00:00Z' } });
    const antes = planificarAvisos(docs(), cfg({ maxIndividuales: 1 }), estado, new Date('2026-09-22T14:10:00Z'));
    expect(antes.modo).toBe('individual'); // solo Arriendo cuenta
    expect(antes.gastos.map((g) => g.concepto)).toEqual(['Arriendo']);
    const despues = planificarAvisos(docs(), cfg(), estado, new Date('2026-09-22T15:10:00Z'));
    expect(despues.gastos.map((g) => g.concepto)).toContain('Luz');
  });
  it('enviado hoy no se repite; enviado ayer sí; igual para el resumen', () => {
    const hoy = estadoCon({ [LUZ]: { enviado: '2026-09-22T13:00:00Z' }, [ARRIENDO]: { enviado: '2026-09-21T13:00:00Z' } }, { enviado: '2026-09-22T13:00:00Z' });
    const p = planificarAvisos(docs(), cfg(), hoy, NOW);
    expect(p.gastos.map((g) => g.concepto)).toEqual(['Arriendo']);
    expect(p.resumen).toBeNull();
    const ayer = planificarAvisos(docs(), cfg(), estadoCon({}, { enviado: '2026-09-21T13:00:00Z' }), NOW);
    expect(ayer.resumen).not.toBeNull();
  });
  it('resumen aplazado vigente no sale; vencido sí', () => {
    expect(planificarAvisos(docs(), cfg(), estadoCon({}, { enviado: '2026-09-22T13:00:00Z', aplazadoHasta: '2026-09-22T16:00:00Z' }), new Date('2026-09-22T15:10:00Z')).resumen).toBeNull();
    expect(planificarAvisos(docs(), cfg(), estadoCon({}, { enviado: '2026-09-22T13:00:00Z', aplazadoHasta: '2026-09-22T16:00:00Z' }), new Date('2026-09-22T16:10:00Z')).resumen).not.toBeNull();
  });
  it('poda el estado: conserva candidatas (también silenciadas) y borra el resto', () => {
    const estado = estadoCon({ [LUZ]: { enviado: '2026-09-21T13:00:00Z' }, [claveGasto('2026-09', 'r_pagada')]: { enviado: '2026-09-21T13:00:00Z' }, 'x/y': { silenciadoFecha: '2026-01-01' } });
    const p = planificarAvisos(docs(), cfg(), estado, NOW);
    expect(Object.keys(p.estado.gastos).sort()).toEqual([LUZ]);
    expect(p.estado.gastos[LUZ].enviado).toBe('2026-09-21T13:00:00Z');
    expect(p.estado.resumen).toEqual(estado.resumen);
  });
  it('poda contra todas las filas con fecha y no pagadas de los meses cargados, no solo las candidatas: una silenciada fuera de la ventana se conserva', () => {
    const LEJOS = claveGasto('2026-09', 'r_lejos'), PAGADA = claveGasto('2026-09', 'r_pagada');
    const estado = estadoCon({ [LEJOS]: { silenciadoFecha: '2026-10-20' }, [PAGADA]: { enviado: '2026-09-21T13:00:00Z' }, 'x/y': { enviado: '2026-09-21T13:00:00Z' } });
    const p = planificarAvisos(docs(), cfg(), estado, NOW);
    expect(Object.keys(p.estado.gastos).sort()).toEqual([LEJOS]); // pagada e inexistente se podan; fuera de ventana pero vigente se conserva
    expect(p.estado.gastos[LEJOS].silenciadoFecha).toBe('2026-10-20');
  });
  it('todo: ignora enviados y aplazamientos, respeta silenciados', () => {
    const estado = estadoCon({ [LUZ]: { enviado: '2026-09-22T13:00:00Z', aplazadoHasta: '2026-09-22T20:00:00Z' }, [ARRIENDO]: { silenciadoFecha: '2026-09-22' } }, { enviado: '2026-09-22T13:00:00Z' });
    const p = planificarAvisos(docs(), cfg(), estado, NOW, { todo: true });
    expect(p.gastos.map((g) => g.concepto)).toEqual(['Luz']);
    expect(p.resumen!.title).toBe('Gastos: 1 próxima');
  });
  it('sin nada: null, o resumen vacío si soloSiHayAlgo es false; nunca resumen vacío si hubo individuales', () => {
    const vacio = [month('2026-09', row('Lejos', '2026-10-20'))];
    expect(planificarAvisos(vacio, cfg(), AVISOS_ESTADO_VACIO, NOW)).toMatchObject({ gastos: [], resumen: null });
    expect(planificarAvisos(vacio, cfg({ soloSiHayAlgo: false }), AVISOS_ESTADO_VACIO, NOW).resumen!.title).toBe('Gastos: sin vencimientos');
    const soloHoy = [month('2026-09', row('Arriendo', '2026-09-22'))];
    const p = planificarAvisos(soloHoy, cfg({ soloSiHayAlgo: false }), AVISOS_ESTADO_VACIO, NOW);
    expect(p.gastos).toHaveLength(1);
    expect(p.resumen).toBeNull();
  });
  it('respeta incluir: sin vencidas ni hoy, todo va al resumen de próximas', () => {
    const p = planificarAvisos(docs(), cfg({ incluir: { vencidas: false, hoy: false, proximas: true } }), AVISOS_ESTADO_VACIO, NOW);
    expect(p.gastos).toEqual([]);
    expect(p.resumen!.title).toBe('Gastos: 1 próxima');
  });
});
