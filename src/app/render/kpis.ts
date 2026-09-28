import { $, esc } from '../dom';
import { fmtCOP, parseMonto, todayISO } from '../format';
import { resumenVencimientos } from '../../shared/dates';
import { computeTotals } from '../../shared/totals';
import type { AppState } from '../state';
import type { Actions } from '../main';
import { attachLiveMoney } from '../money-input';

const money = (n: number | null) => {
  if (n === null) return '<span class="muted">—</span>';
  const s = fmtCOP(n);                 // '$1.234' o '-$1.234'
  const neg = s.startsWith('-');
  return `${neg ? '−' : ''}<span class="cur">$</span>${esc(s.replace(/^-?\$/, ''))}`;
};

export function renderKpis(s: AppState, a: Actions) {
  const box = $('#kpis');
  if (!s.doc) { box.innerHTML = ''; return; }
  const t = computeTotals(s.doc);
  const pct = t.egresos ? Math.round((t.pagado / t.egresos) * 100) : 0;
  const pendN = s.doc.rows.filter((r) => r.estado !== 'pagado').length;
  const venc = resumenVencimientos(s.doc.rows, todayISO());
  const vencTxt = `${venc.vencidas ? ` · <span class="vencidas">${venc.vencidas} ${venc.vencidas === 1 ? 'vencida' : 'vencidas'}</span>` : ''}${venc.proximas ? ` · <span class="proximas">${venc.proximas} ${venc.proximas === 1 ? 'vence pronto' : 'vencen pronto'}</span>` : ''}`;
  box.innerHTML = `
    <div class="kpi ing"><div class="lab">Ingresos <span class="muted">editar</span></div>
      <div class="val"><input class="ing-edit num" id="ingEdit" inputmode="numeric" pattern="[0-9.]*" enterkeyhint="done" value="${esc(fmtCOP(s.doc.ingresos))}" aria-label="Ingresos del mes"></div></div>
    <div class="kpi"><div class="lab">Egresos</div><div class="val">${money(t.egresos)}</div></div>
    <div class="kpi" style="color:${t.diferencia < 0 ? 'var(--danger)' : 'inherit'}"><div class="lab">Diferencia</div><div class="val">${money(t.diferencia)}</div></div>
    <div class="kpi sep"><div class="lab">Separado</div><div class="val">${money(t.separado)}</div></div>
    <div class="kpi pag"><div class="lab">Pagado <span>${pct}%</span></div><div class="val">${money(t.pagado)}</div><div class="meter"><i style="width:${pct}%"></i></div></div>
    <div class="kpi pend"><div class="lab">Pendiente</div><div class="val">${money(t.pendiente)}</div>
      <div class="sub">${pendN} ${pendN === 1 ? 'fila' : 'filas'} por pagar${t.sinMonto ? ` · ${t.sinMonto} sin monto` : ''}${vencTxt}</div></div>`;
  const ie = $<HTMLInputElement>('#ingEdit');
  attachLiveMoney(ie);
  ie.onchange = () => a.setIngresos(parseMonto(ie.value) ?? 0);
  ie.onkeydown = (e) => { if (e.key === 'Enter') ie.blur(); };
  ie.onfocus = () => ie.select();
}
