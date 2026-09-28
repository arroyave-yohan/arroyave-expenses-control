import { describe, it, expect } from 'vitest';
import { formatLive, groupDigits } from '../../src/app/money-input';

describe('groupDigits', () => {
  it('agrupa de a tres y quita ceros a la izquierda', () => {
    expect(groupDigits('')).toBe('');
    expect(groupDigits('0')).toBe('0');
    expect(groupDigits('007')).toBe('7');
    expect(groupDigits('1250')).toBe('1.250');
    expect(groupDigits('1250000')).toBe('1.250.000');
  });
});

describe('formatLive', () => {
  it('formatea mientras se escribe al final', () => {
    expect(formatLive('1', 1)).toEqual({ value: '1', caret: 1 });
    expect(formatLive('1250', 4)).toEqual({ value: '1.250', caret: 5 });
    expect(formatLive('1.2505', 6)).toEqual({ value: '12.505', caret: 6 });
  });
  it('mantiene el cursor por conteo de dígitos al editar en medio', () => {
    // '12.500' con cursor tras el 2 (índice 2); se inserta '9' → '129.500', cursor tras el 9
    expect(formatLive('129.500', 3)).toEqual({ value: '129.500', caret: 3 });
    // borrar el punto no cambia nada: '12500' cursor 2 → '12.500' cursor 2
    expect(formatLive('12500', 2)).toEqual({ value: '12.500', caret: 2 });
    // cursor justo después de un separador cuenta los dígitos a la izquierda
    expect(formatLive('1.250', 2)).toEqual({ value: '1.250', caret: 2 });
  });
  it('ignora caracteres no numéricos y símbolos de moneda', () => {
    expect(formatLive('$12.400.000', 11)).toEqual({ value: '12.400.000', caret: 10 });
    expect(formatLive('abc', 3)).toEqual({ value: '', caret: 0 });
  });
});
