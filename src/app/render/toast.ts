import { $ } from '../dom';
let timer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, actionLabel?: string, actionFn?: () => void, ms = 5000) {
  const t = $('#toast'); $('#toastMsg').textContent = msg;
  const b = $<HTMLButtonElement>('#toastAct');
  b.hidden = !actionLabel; b.textContent = actionLabel ?? '';
  b.onclick = () => { actionFn?.(); t.hidden = true; };
  t.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { t.hidden = true; }, ms);
}
