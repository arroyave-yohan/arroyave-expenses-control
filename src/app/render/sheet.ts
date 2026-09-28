import { $, esc } from '../dom';
import { fmtCOP } from '../format';
import { ESTADO_LONG, nextEstado } from '../state';
import type { AppState } from '../state';
import type { Actions } from '../main';
import { ICON, rowActionHandlers, cycleEstado } from './grid';

export function openRowSheet(s: AppState, a: Actions, id: string) {
  const r = s.doc?.rows.find((x) => x.id === id); if (!r) return;
  const root = $('#modalRoot');
  root.innerHTML = `<div class="scrim" id="sheetScrim"></div>
    <div class="sheet" role="menu">
      <div class="title">${esc(r.concepto)} · <span class="num">${esc(fmtCOP(r.monto))}</span></div>
      <button data-a="estado">${ICON.edit} Marcar como ${ESTADO_LONG[nextEstado(r.estado)]}</button>
      <button data-a="edit">${ICON.edit} Editar</button>
      <button data-a="dup">${ICON.dup} Duplicar fila</button>
      <button data-a="copy">${ICON.copy} Copiar concepto, monto y ref</button>
      <button data-a="del" style="color:var(--danger)">${ICON.del} Eliminar</button>
      <button data-a="close">Cancelar</button>
    </div>`;
  root.hidden = false;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  $('#sheetScrim', root).onclick = close;
  const handlers = rowActionHandlers(s, a);
  root.querySelector('.sheet')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]'); if (!b) return;
    close();
    const act = b.dataset.a!;
    if (act === 'estado') cycleEstado(s, a, id);
    else if (act !== 'close') handlers[act]?.(id);
  });
}
