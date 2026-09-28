export function groupDigits(digits: string): string {
  const d = digits.replace(/^0+(?=\d)/, '');
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Reformatea el valor de un input de dinero y calcula dónde debe quedar el cursor. */
export function formatLive(raw: string, caret: number): { value: string; caret: number } {
  const digitsBefore = raw.slice(0, Math.max(0, caret)).replace(/\D/g, '').length;
  const digits = raw.replace(/\D/g, '');
  const value = groupDigits(digits);
  // ceros a la izquierda eliminados también cuentan como dígitos "consumidos" a la izquierda
  const stripped = digits.length - digits.replace(/^0+(?=\d)/, '').length;
  const wanted = Math.max(0, digitsBefore - stripped);
  let pos = 0, seen = 0;
  while (pos < value.length && seen < wanted) { if (/\d/.test(value[pos])) seen++; pos++; }
  // si el cursor original estaba justo después de un separador/símbolo, el nuevo cursor
  // también queda después del separador equivalente (no antes), aunque el conteo de
  // dígitos por sí solo sea ambiguo en ese punto
  if (caret > 0 && !/\d/.test(raw[caret - 1])) {
    while (pos < value.length && !/\d/.test(value[pos])) pos++;
  }
  return { value, caret: pos };
}

/** Entrada mínima compatible con HTMLInputElement, sin depender del lib DOM
 * (este archivo también se compila bajo el tsconfig raíz, que no incluye DOM). */
export type LiveMoneyInput = {
  value: string;
  selectionStart: number | null;
  setSelectionRange(a: number, b: number): void;
  addEventListener(type: 'input', fn: () => void): void;
  dataset: Record<string, string | undefined>;
};

/** Engancha el formateo en vivo a un input; idempotente por elemento. */
export function attachLiveMoney(input: LiveMoneyInput): void {
  if (input.dataset.liveMoney) return;
  input.dataset.liveMoney = '1';
  input.addEventListener('input', () => {
    const caret = input.selectionStart ?? input.value.length;
    const { value, caret: next } = formatLive(input.value, caret);
    if (value !== input.value) { input.value = value; try { input.setSelectionRange(next, next); } catch { /* inputs sin selección */ } }
  });
}
