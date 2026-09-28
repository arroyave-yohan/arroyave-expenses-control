import { describe, it, expect } from 'vitest';
import { sugerir, propuestaNueva, mesDestino } from '../../src/app/recibos';
import type { Lectura, Alias } from '../../src/shared/recibos';
import type { Row } from '../../src/shared/types';

const row = (id: string, concepto: string, monto: number | null, estado: Row['estado'] = 'pendiente', extra: Partial<Row> = {}): Row =>
  ({ id, concepto, monto, categoriaId: null, recurrente: true, estado, fecha: null, fechaPago: null, bolsillo: '', link: '', ref: '', ...extra });
const lectura = (p: Partial<Lectura> = {}): Lectura => ({ comercio: 'EPM SERVICIOS PUBLICOS', fecha: '2026-09-26', hora: '10:00', monto: 180000, tipo: 'compra', canal: null, referencia: '998877', banco: 'Bancolombia', ...p });
const HOY = '2026-09-26';

describe('sugerir', () => {
  const rows = [row('luz', 'Luz', 180000), row('agua', 'Agua', 95000), row('gas', 'Gas', 178000), row('arr', 'Arriendo', 1250000, 'pagado'), row('epm', 'Pago EPM', 500000, 'separado')];
  it('el monto exacto gana; el nombre suma; las pagadas no aparecen; máximo 5', () => {
    const s = sugerir(lectura(), rows, {}, HOY);
    expect(s[0].row.id).toBe('luz');
    expect(s.map((x) => x.row.id)).toContain('epm');
    expect(s.map((x) => x.row.id)).not.toContain('arr');
    expect(s.length).toBeLessThanOrEqual(5);
    expect(s.every((x) => x.puntaje > 0)).toBe(true);
  });
  it('tolerancia de monto: ±2 % y ±10 % puntúan por debajo del exacto', () => {
    // Nota (desviación del brief): con monto 181000, tanto 'luz' (180000, 0,56 %) como 'gas' (178000, 1,69 %)
    // caen en la franja ±2 % y ambos reciben 40 puntos (la spec no distingue distancia dentro de una franja);
    // el desempate es alfabético por concepto, así que no se afirma cuál de los dos queda primero.
    const s = sugerir(lectura({ monto: 181000, comercio: 'X' }), rows, {}, HOY);
    expect(s[0].puntaje).toBe(40); // franja ±2 %, no la exacta (60)
    expect(s.map((x) => x.row.id)).toEqual(expect.arrayContaining(['luz', 'gas']));
    const s2 = sugerir(lectura({ monto: 195000, comercio: 'X' }), rows, {}, HOY);
    expect(s2.every((x) => x.puntaje === 15)).toBe(true); // franja ±10 %
    expect(s2.map((x) => x.row.id)).toEqual(expect.arrayContaining(['luz', 'gas']));
  });
  it('el alias aporta el nombre aunque el comercio no se parezca', () => {
    const aliases: Record<string, Alias> = { 'tienda x': { concepto: 'Agua', categoriaId: null, bolsillo: '', usadoEn: '2026-09-01' } };
    const s = sugerir(lectura({ comercio: 'TIENDA X', monto: 1 }), rows, aliases, HOY);
    expect(s[0].row.id).toBe('agua');
  });
  it('fecha límite cercana al recibo suma', () => {
    const r2 = [row('a', 'Cuota', 50000, 'pendiente', { fecha: '2026-09-27' }), row('b', 'Cuota', 50000, 'pendiente', { fecha: '2026-11-01' })];
    expect(sugerir(lectura({ comercio: 'BANCO', monto: 50000 }), r2, {}, HOY)[0].row.id).toBe('a');
  });
  it('sin monto ni parecido no sugiere nada', () => { expect(sugerir(lectura({ comercio: 'ZZZ', monto: null }), rows, {}, HOY)).toEqual([]); });
});

describe('propuestaNueva', () => {
  it('sin alias: título del comercio, pagado con fecha del recibo y ref', () => {
    const p = propuestaNueva(lectura(), undefined, HOY);
    expect(p).toMatchObject({ concepto: 'Epm Servicios Publicos', monto: 180000, estado: 'pagado', fechaPago: '2026-09-26', ref: '998877', categoriaId: null, bolsillo: '', recurrente: false, fecha: null });
    expect(p.id).toMatch(/^r_/);
  });
  it('con alias usa concepto, categoría y bolsillo; sin fecha usa hoy', () => {
    const p = propuestaNueva(lectura({ fecha: null, referencia: null }), { concepto: 'Luz', categoriaId: 'servicios', bolsillo: 'Nu', usadoEn: '' }, HOY);
    expect(p).toMatchObject({ concepto: 'Luz', categoriaId: 'servicios', bolsillo: 'Nu', fechaPago: HOY, ref: '' });
  });
});

describe('mesDestino', () => {
  const months = ['2026-07', '2026-08', '2026-09'];
  it('mes del recibo si existe; si no, el actual; si no, el último', () => {
    expect(mesDestino(lectura({ fecha: '2026-08-15' }), months, '2026-09')).toBe('2026-08');
    expect(mesDestino(lectura({ fecha: '2026-10-02' }), months, '2026-09')).toBe('2026-09');
    expect(mesDestino(lectura({ fecha: null }), months, '2026-12')).toBe('2026-09');
    expect(mesDestino(lectura(), [], '2026-09')).toBeNull();
  });
});
