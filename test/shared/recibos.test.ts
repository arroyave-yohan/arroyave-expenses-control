import { describe, it, expect } from 'vitest';
import { extraerJson, arreglarMontos, normalizarComercio, tituloDe, mesDe, corregirAnio } from '../../src/shared/recibos';

describe('extraerJson', () => {
  it('acepta JSON limpio, con cercas markdown y con texto alrededor', () => {
    expect(extraerJson('{"a":1}')).toEqual({ a: 1 });
    expect(extraerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extraerJson('Aquí tienes:\n{"movimientos":[{"x":2}]}\nGracias')).toEqual({ movimientos: [{ x: 2 }] });
  });
  it('lanza si no hay JSON', () => {
    expect(() => extraerJson('sin nada')).toThrow();
    expect(() => extraerJson('{rota')).toThrow();
  });
});
describe('arreglarMontos', () => {
  it('quita puntos de miles y decimales solo en montos numéricos', () => {
    expect(arreglarMontos('{"monto": 180.000}')).toBe('{"monto": 180000}');
    expect(arreglarMontos('{"monto":-$1.234.567,50, "x":1}')).toBe('{"monto":1234567, "x":1}');
    expect(JSON.parse(arreglarMontos('{"movimientos":[{"comercio":"A","monto": 299.960},{"monto":323880}]}'))).toEqual({ movimientos: [{ comercio: 'A', monto: 299960 }, { monto: 323880 }] });
  });
  it('no toca textos entre comillas ni decimales reales ni otros campos', () => {
    expect(arreglarMontos('{"monto":"299.960,00"}')).toBe('{"monto":"299.960,00"}');
    expect(arreglarMontos('{"monto":180.5}')).toBe('{"monto":180.5}');
    expect(arreglarMontos('{"referencia":"1.234.567"}')).toBe('{"referencia":"1.234.567"}');
  });
});
describe('normalizarComercio / tituloDe / mesDe', () => {
  it('normaliza para usar como clave', () => {
    expect(normalizarComercio('  TIENDA D1  CENTRO ')).toBe('tienda d centro');
    expect(normalizarComercio('Enviaste a SUSHI PANDA ANA GÓMEZ')).toBe('enviaste a sushi panda ana gomez');
    expect(normalizarComercio('EDS MÓVIL LA ESQUINA #12')).toBe('eds movil la esquina');
  });
  it('tituloDe pasa a formato título', () => {
    expect(tituloDe('TIENDA D1 CENTRO')).toBe('Tienda D1 Centro');
    expect(tituloDe('sushi panda')).toBe('Sushi Panda');
  });
  it('mesDe', () => { expect(mesDe('2026-09-26')).toBe('2026-09'); expect(mesDe(null)).toBeNull(); expect(mesDe('basura')).toBeNull(); });
});

describe('corregirAnio', () => {
  const HOY = '2026-09-26';
  it('deja fechas cercanas y corrige años inventados', () => {
    expect(corregirAnio('2026-09-25', HOY)).toBe('2026-09-25');
    expect(corregirAnio('2024-09-26', HOY)).toBe('2026-09-26');
    expect(corregirAnio('2023-12-15', HOY)).toBe('2025-12-15'); // en 2026 quedaría en el futuro
    expect(corregirAnio('2024-02-29', HOY)).toBe('2024-02-29'); // 29 de febrero no existe en 2026 ni 2025: se conserva
    expect(corregirAnio(null, HOY)).toBeNull();
    expect(corregirAnio('basura', HOY)).toBe('basura');
  });
});
