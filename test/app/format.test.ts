import { describe, it, expect } from 'vitest';
import { fmtCOP, parseMonto, ymLabel, nextYm, prevYm, todayISO, fmtFecha } from '../../src/app/format';

describe('format', () => {
  it('fmtCOP y parseMonto son inversos', () => {
    expect(fmtCOP(1250000)).toBe('$1.250.000');
    expect(fmtCOP(0)).toBe('$0');
    expect(fmtCOP(null)).toBe('—');
    expect(fmtCOP(-1234567)).toBe('-$1.234.567');
    expect(parseMonto('$1.250.000')).toBe(1250000);
    expect(parseMonto('1250000')).toBe(1250000);
    expect(parseMonto('')).toBeNull();
    expect(parseMonto('abc')).toBeNull();
  });
  it('meses', () => {
    expect(ymLabel('2026-08')).toBe('Agosto 2026');
    expect(nextYm('2026-12')).toBe('2027-01');
    expect(prevYm('2026-01')).toBe('2025-12');
  });
  it('fechas', () => {
    expect(todayISO(new Date(2026, 7, 5, 23, 30))).toBe('2026-08-05');
    expect(fmtFecha('2026-08-05')).toBe('05/08');
    expect(fmtFecha(null)).toBe('—');
  });
});
