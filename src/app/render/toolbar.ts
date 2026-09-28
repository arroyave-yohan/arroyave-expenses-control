import { $, esc } from '../dom';
import { fmtCOP } from '../format';
import { chipTotals, catHue, catName, bolsilloNombres, type EstadoFilter } from '../state';
import type { AppState } from '../state';
import type { Actions } from '../main';

const ICON_SEARCH = '<svg width="15" height="15" viewBox="0 0 14 14"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9.2 9.2L13 13" stroke="currentColor" stroke-width="1.5"/></svg>';
const ICON_PLUS = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_CAM = '<svg width="15" height="15" viewBox="0 0 14 14"><path d="M1.5 4.5h2.2l1-1.6h4.6l1 1.6h2.2v7h-11z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const SEGS: [EstadoFilter, string][] = [['todos', 'Todos'], ['pendiente', 'Pendientes'], ['separado', 'Separados'], ['pagado', 'Pagados']];

export function renderToolbar(s: AppState, a: Actions) {
  const f = s.filters;
  const bols = bolsilloNombres(s, f.bolsillo);
  $('#toolbar').innerHTML = `
    <div class="search">${ICON_SEARCH}<input id="q" type="search" enterkeyhint="search" placeholder="Buscar concepto, bolsillo o ref" autocomplete="off" value="${esc(f.q)}"></div>
    <div class="seg" id="statusSeg" role="group" aria-label="Estado">
      ${SEGS.map(([k, l]) => `<button data-s="${k}" aria-pressed="${f.estado === k}">${l}</button>`).join('')}
    </div>
    <select class="sel" id="bolsSel" aria-label="Bolsillo"><option value="">Todos los bolsillos</option>${bols.map((b) => `<option ${b === f.bolsillo ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
    <button class="toggle" id="groupBtn" aria-pressed="${f.group}"><span class="sw"></span>Agrupar por categoría</button>
    <button class="btn" id="reciboBtn" title="Escanear recibo">${ICON_CAM}Recibo</button>
    <button class="toggle" id="selBtn" aria-pressed="${s.sel.on}"><span class="sw"></span>Seleccionar</button>
    <div class="push"><button class="btn primary" id="newRow">${ICON_PLUS}Nueva fila</button></div>`;

  const q = $<HTMLInputElement>('#q');
  q.oninput = () => a.setFilters({ q: q.value });
  q.onkeydown = (e) => { if (e.key === 'Enter') q.blur(); };
  $('#statusSeg').onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (b) a.setFilters({ estado: b.dataset.s as EstadoFilter }); };
  $<HTMLSelectElement>('#bolsSel').onchange = (e) => a.setFilters({ bolsillo: (e.target as HTMLSelectElement).value });
  $('#groupBtn').onclick = () => a.setFilters({ group: !f.group });
  $('#reciboBtn').onclick = () => a.abrirRecibo();
  $('#selBtn').onclick = () => a.toggleSelectMode();
  $('#newRow').onclick = () => a.addRow();
}

export function syncToolbar(s: AppState) {
  const f = s.filters;
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#statusSeg button'))) {
    b.setAttribute('aria-pressed', String(b.dataset.s === f.estado));
  }
  const groupBtn = document.getElementById('groupBtn');
  if (groupBtn) groupBtn.setAttribute('aria-pressed', String(f.group));
  const selBtn = document.getElementById('selBtn');
  if (selBtn) selBtn.setAttribute('aria-pressed', String(s.sel.on));
  const bolsSel = document.getElementById('bolsSel') as HTMLSelectElement | null;
  if (bolsSel) bolsSel.value = f.bolsillo;
  const q = document.getElementById('q') as HTMLInputElement | null;
  if (q && q.value !== f.q) q.value = f.q;
}

export function renderChips(s: AppState, a: Actions) {
  const box = $('#chips');
  if (!s.doc) { box.innerHTML = ''; return; }
  const totals = chipTotals(s.doc, s.filters, s.categorias);
  const ids: (string | null)[] = [...s.categorias.items.map((c) => c.id), null].filter((id) => totals.has(id));
  box.innerHTML = ids.map((id) => {
    const t = totals.get(id)!;
    const label = id === null ? 'sin categoría' : catName(s.categorias, id);
    return `<button class="chip" style="--h:${catHue(s.categorias, id)}" data-c="${id ?? ''}" aria-pressed="${s.filters.categorias.has(id)}"><span class="dot"></span>${esc(label)}<span class="t">${esc(fmtCOP(t.total))}</span></button>`;
  }).join('') + (s.filters.categorias.size ? '<button class="clear" id="clearCats">Limpiar</button>' : '');
  box.onclick = (e) => {
    const el = e.target as HTMLElement;
    if (el.id === 'clearCats') { a.setFilters({ categorias: new Set() }); return; }
    const chip = el.closest<HTMLButtonElement>('.chip'); if (!chip) return;
    const id = chip.dataset.c === '' ? null : chip.dataset.c!;
    const next = new Set(s.filters.categorias); next.has(id) ? next.delete(id) : next.add(id);
    a.setFilters({ categorias: next });
  };
}
