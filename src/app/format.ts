export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function fmtCOP(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function parseMonto(s: string): number | null {
  const digits = (s ?? '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MESES[parseInt(m, 10) - 1]} ${y}`;
}

export function nextYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function currentYm(now: Date = new Date()): string {
  return todayISO(now).slice(0, 7);
}

export function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
