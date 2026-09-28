const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Id corto aleatorio con prefijo, p. ej. newId('r_') → r_k3j9x2ab. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = prefix;
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function newRowId(): string {
  return newId('r_');
}
