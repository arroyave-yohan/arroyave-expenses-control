import { describe, it, expect } from 'vitest';
import { shiftDateToMonth, daysBetween, vencimiento, resumenVencimientos, partesLocales, ZONA, etiquetaMes } from '../../src/shared/dates';

describe('dates', () => {
  it('shiftDateToMonth conserva el día y recorta al último del mes', () => {
    expect(shiftDateToMonth('2026-08-15', '2026-09')).toBe('2026-09-15');
    expect(shiftDateToMonth('2026-08-31', '2026-09')).toBe('2026-09-30');
    expect(shiftDateToMonth('2026-01-31', '2026-02')).toBe('2026-02-28');
    expect(shiftDateToMonth('2028-01-31', '2028-02')).toBe('2028-02-29');
    expect(shiftDateToMonth(null, '2026-09')).toBeNull();
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-08-20', '2026-08-23')).toBe(3);
    expect(daysBetween('2026-08-20', '2026-08-19')).toBe(-1);
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
  });
  it('vencimiento: vencida, próxima (hoy..+3), lejana, pagada o sin fecha', () => {
    const hoy = '2026-08-20';
    expect(vencimiento('2026-08-19', 'pendiente', hoy)).toBe('vencida');
    expect(vencimiento('2026-08-20', 'pendiente', hoy)).toBe('proxima');
    expect(vencimiento('2026-08-23', 'separado', hoy)).toBe('proxima');
    expect(vencimiento('2026-08-24', 'pendiente', hoy)).toBeNull();
    expect(vencimiento('2026-08-01', 'pagado', hoy)).toBeNull();
    expect(vencimiento(null, 'pendiente', hoy)).toBeNull();
  });
  it('resumenVencimientos cuenta', () => {
    const rows = [
      { fecha: '2026-08-01', estado: 'pendiente' as const }, { fecha: '2026-08-02', estado: 'separado' as const },
      { fecha: '2026-08-21', estado: 'pendiente' as const }, { fecha: '2026-08-01', estado: 'pagado' as const }, { fecha: null, estado: 'pendiente' as const },
    ];
    expect(resumenVencimientos(rows, '2026-08-20')).toEqual({ vencidas: 2, proximas: 1 });
  });
});

describe('partesLocales', () => {
  it('convierte un instante UTC a fecha y hora de Colombia (UTC-5, sin horario de verano)', () => {
    expect(ZONA).toBe('America/Bogota');
    expect(partesLocales(new Date('2026-09-22T13:05:00Z'))).toEqual({ date: '2026-09-22', hour: 8 });
    expect(partesLocales(new Date('2026-09-23T03:30:00Z'))).toEqual({ date: '2026-09-22', hour: 22 });
    expect(partesLocales(new Date('2026-09-23T05:00:00Z'))).toEqual({ date: '2026-09-23', hour: 0 });
  });
  it('acepta otra zona', () => {
    expect(partesLocales(new Date('2026-09-22T13:05:00Z'), 'UTC')).toEqual({ date: '2026-09-22', hour: 13 });
  });
});

describe('etiquetaMes', () => {
  it('mes en palabras y año', () => {
    expect(etiquetaMes('2026-09')).toBe('Septiembre 2026');
    expect(etiquetaMes('2026-01')).toBe('Enero 2026');
    expect(etiquetaMes('2026-12')).toBe('Diciembre 2026');
  });
});
