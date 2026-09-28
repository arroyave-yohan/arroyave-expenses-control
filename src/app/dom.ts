export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`No existe ${sel}`);
  return el;
};
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const isTouch = (): boolean => window.matchMedia('(hover: none)').matches;
export const isPhone = (): boolean => window.matchMedia('(max-width: 699px)').matches;
export const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) => el.addEventListener(type, fn);

/** Mantiene --vvh igual a la altura visible real (teclado virtual abierto o cerrado)
 *  y --vvoff con el desplazamiento inferior que ocupa el teclado, para que la hoja
 *  inferior (drawer) no quede tapada. */
export function trackVisualViewport() {
  const vv = window.visualViewport;
  const apply = () => {
    document.documentElement.style.setProperty('--vvh', `${Math.round(vv?.height ?? window.innerHeight)}px`);
    const off = Math.max(0, Math.round(window.innerHeight - ((vv?.height ?? window.innerHeight) + (vv?.offsetTop ?? 0))));
    document.documentElement.style.setProperty('--vvoff', `${off}px`);
  };
  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
}
