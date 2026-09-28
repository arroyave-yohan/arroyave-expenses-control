import { describe, it, expect } from 'vitest';
import { newRowId } from '../../src/shared/ids';

describe('newRowId', () => {
  it('genera ids con formato r_ + 8 caracteres y sin repetir', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRowId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^r_[a-z0-9]{8}$/);
  });
});
