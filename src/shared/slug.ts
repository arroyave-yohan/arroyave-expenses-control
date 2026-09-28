export function slug(nombre: string): string {
  const s = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'item';
}
export function uniqueSlug(nombre: string, taken: Iterable<string>): string {
  const set = new Set(taken); const base = slug(nombre);
  if (!set.has(base)) return base;
  let n = 2; while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
