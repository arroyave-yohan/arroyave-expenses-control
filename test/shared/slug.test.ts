import { describe, it, expect } from 'vitest';
import { slug, uniqueSlug } from '../../src/shared/slug';
describe('slug', () => {
  it('normaliza', () => {
    expect(slug('Nu: Gastos Niños')).toBe('nu-gastos-ninos');
    expect(slug('Efectivo / Nequi')).toBe('efectivo-nequi');
    expect(slug('  ')).toBe('item');
    expect(slug('a'.repeat(60))).toHaveLength(40);
  });
  it('uniqueSlug agrega sufijos', () => {
    expect(uniqueSlug('Nueva', ['nueva'])).toBe('nueva-2');
    expect(uniqueSlug('Nueva', ['nueva', 'nueva-2'])).toBe('nueva-3');
    expect(uniqueSlug('Otra', ['nueva'])).toBe('otra');
  });
});
