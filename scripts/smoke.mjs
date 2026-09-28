// Smoke headless: requiere `npx wrangler dev --port 8787` corriendo con KV local cargado.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}`); };

async function scenario(label, ctxOpts, touch) {
  const browser = await chromium.launch(); const ctx = await browser.newContext(ctxOpts); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  console.log(`\n=== ${label}`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  const rows = await page.locator(touch ? '#cards .card' : '#tbody tr[data-id]').count();
  check(rows > 0, `${label}: carga filas (${rows})`);
  // 1. estado → guardado + historial
  const first = page.locator(touch ? '#cards .card' : '#tbody tr[data-id]').first(); const id = await first.getAttribute('data-id');
  const before = await page.evaluate((id) => document.querySelector(`[data-id="${id}"] .estado [aria-pressed="true"]`)?.dataset.e, id);
  const target = before === 'separado' ? 'pendiente' : 'separado';
  await first.locator(`.estado button[data-e="${target}"]`).click();
  await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate((id) => document.querySelector(`[data-id="${id}"] .estado [aria-pressed="true"]`)?.dataset.e, id);
  check(after === target, `${label}: estado ${before} → ${after}`);
  check((await page.locator('#sync').textContent())?.startsWith('Guardado'), `${label}: sync Guardado`);
  check((await page.locator('#histCount').textContent()) === '1', `${label}: historial cuenta 1`);
  // 2. deshacer
  await page.locator('#undoBtn').click(); await page.waitForTimeout(300);
  const undone = await page.evaluate((id) => document.querySelector(`[data-id="${id}"] .estado [aria-pressed="true"]`)?.dataset.e, id);
  check(undone === before, `${label}: deshacer restaura ${before}`);
  await page.locator('#histBtn').click(); await page.waitForTimeout(150);
  check((await page.locator('#histList button').count()) === 0, `${label}: historial vacío tras deshacer (monótono)`);
  await page.keyboard.press('Escape');
  if (!touch) {
    // 3. monto en vivo
    const td = page.locator('#tbody tr[data-id]').nth(1).locator('td[data-monto]'); await td.click();
    const input = td.locator('input'); await input.fill(''); await page.keyboard.type('1250000');
    check((await input.inputValue()) === '1.250.000', `${label}: monto en vivo 1.250.000`);
    await page.keyboard.press('Escape');
  }
  if (!touch) {
    // 3b. fecha límite en la celda: escribir, ver dd/mm, deshacer
    const tdf = page.locator('#tbody tr[data-id]').nth(2).locator('td[data-fecha]');
    const antes = (await tdf.textContent())?.trim();
    await tdf.click(); await page.waitForTimeout(150);
    const fin = tdf.locator('input[type=date]');
    check((await fin.count()) === 1, `${label}: editor de fecha abierto`);
    await fin.fill('2026-08-25'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const despues = (await page.locator('#tbody tr[data-id]').nth(2).locator('td[data-fecha]').textContent())?.trim();
    check(despues?.startsWith('25/08') === true, `${label}: fecha guardada 25/08 (antes ${antes})`);
    await page.locator('#undoBtn').click(); await page.waitForTimeout(300);
    const restaurada = (await page.locator('#tbody tr[data-id]').nth(2).locator('td[data-fecha]').textContent())?.trim();
    check(restaurada === antes, `${label}: deshacer restaura la fecha (${antes})`);
  }
  if (!touch) {
    // 3c. rehacer: deshacer una fecha y rehacerla; persistencia: recargar y ver el contador
    const tdf2 = page.locator('#tbody tr[data-id]').nth(2).locator('td[data-fecha]');
    const antes2 = (await tdf2.textContent())?.trim();
    await tdf2.click(); await page.waitForTimeout(150); await tdf2.locator('input[type=date]').fill('2026-08-26'); await page.waitForTimeout(300);
    await page.locator('#undoBtn').click(); await page.waitForTimeout(300);
    check(!(await page.locator('#redoBtn').isDisabled()), `${label}: rehacer habilitado tras deshacer`);
    await page.locator('#redoBtn').click(); await page.waitForTimeout(300);
    check((await page.locator('#tbody tr[data-id]').nth(2).locator('td[data-fecha]').textContent())?.trim().startsWith('26/08') === true, `${label}: rehacer vuelve a 26/08`);
    check((await page.locator('#histCount').textContent()) === '1', `${label}: historial 1 tras rehacer`);
    await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    check((await page.locator('#histCount').textContent()) === '1', `${label}: historial persiste tras recargar`);
    await page.locator('#undoBtn').click(); await page.waitForTimeout(300);
    check((await page.locator('#tbody tr[data-id]').nth(2).locator('td[data-fecha]').textContent())?.trim() === antes2, `${label}: deshacer tras recargar restaura ${antes2}`);
    await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
    // 3d. PWA: manifest, service worker activo y lectura sin red
    check((await page.locator('link[rel="manifest"]').count()) === 1, `${label}: manifest enlazado`);
    const swOk = await page.evaluate(async () => { const r = await navigator.serviceWorker?.ready; return !!(r && navigator.serviceWorker.controller); });
    check(swOk, `${label}: service worker controlando la página`);
    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(1200);
    const offRows = await page.locator('#tbody tr[data-id]').count();
    check(offRows > 0, `${label}: sin red carga el mes desde caché (${offRows} filas)`);
    check((await page.locator('#sync').textContent())?.startsWith('Sin conexión') === true, `${label}: indicador Sin conexión`);
    await page.context().setOffline(false);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  }
  // 4. modal bolsillos
  await page.locator('#menuBtn').click(); await page.locator('#menuList button[data-m="bols"]').click(); await page.waitForTimeout(200);
  check((await page.locator('#bolslist .catrow').count()) > 0, `${label}: modal bolsillos con filas`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
  if (!touch) {
    // 5. modal avisos: valores por defecto, guardar, persistir, prueba sin dispositivos
    await page.locator('#menuBtn').click(); await page.locator('#menuList button[data-m="avisos"]').click();
    await page.locator('#avSave:not([disabled])').waitFor({ timeout: 5000 });
    check((await page.locator('#avHora').inputValue()) === '8', `${label}: avisos hora por defecto 8`);
    check((await page.locator('#avAplazar').inputValue()) === '3', `${label}: avisos aplazar por defecto 3`);
    check((await page.locator('#avMax').inputValue()) === '5', `${label}: avisos máximo individuales por defecto 5`);
    const ventanaAntes = await page.locator('#avVentana').inputValue();
    await page.locator('#avVentana').fill('5');
    await page.locator('#avSave').click(); await page.waitForTimeout(400);
    await page.locator('#menuBtn').click(); await page.locator('#menuList button[data-m="avisos"]').click();
    await page.locator('#avSave:not([disabled])').waitFor({ timeout: 5000 });
    check((await page.locator('#avVentana').inputValue()) === '5', `${label}: avisos ventana guardada 5`);
    await page.locator('#avPrueba:not([disabled])').waitFor({ timeout: 5000 });
    await page.locator('#avPrueba').click(); await page.waitForTimeout(400);
    check((await page.locator('#toastMsg').textContent())?.includes('No hay dispositivos suscritos') === true, `${label}: prueba sin dispositivos avisa`);
    await page.locator('#avVentana').fill(ventanaAntes || '3');
    await page.locator('#avSave').click(); await page.waitForTimeout(400);
    // 6. panel de fila: silenciar avisos de una fecha, ver que persiste, quitar
    const rowFecha = page.locator('#tbody tr[data-id]').nth(2);
    const fechaAntes = (await rowFecha.locator('td[data-fecha]').textContent())?.trim();
    await rowFecha.locator('td[data-fecha]').click(); await page.waitForTimeout(150);
    await rowFecha.locator('td[data-fecha] input[type=date]').fill('2026-08-27');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    check((await rowFecha.locator('td[data-fecha]').textContent())?.trim().startsWith('27/08') === true, `${label}: fecha guardada 27/08 para el panel`);
    // la acción "silenciar" se valida contra la fecha guardada en el servidor: hay que esperar el guardado (debounce) antes de abrir el panel
    await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
    await rowFecha.focus(); await page.keyboard.press('e');
    await page.locator('#f_sinAviso:not([disabled])').waitFor({ timeout: 5000 });
    check((await page.locator('#f_sinAviso').isChecked()) === false, `${label}: sin avisos apagado por defecto`);
    check(await page.locator('#f_quitarFecha').isVisible(), `${label}: botón quitar fecha visible`);
    await page.locator('#f_quitarFecha').click();
    check((await page.locator('#f_lim').inputValue()) === '', `${label}: quitar fecha vacía el campo`);
    await page.locator('#f_sinAviso').click();
    await page.waitForFunction(() => document.getElementById('toastMsg')?.textContent?.includes('Sin avisos para esta fecha'), null, { timeout: 5000 }).catch(() => {});
    check((await page.locator('#toastMsg').textContent())?.includes('Sin avisos para esta fecha') === true, `${label}: silenciar avisa con toast`);
    await page.keyboard.press('Escape');
    await rowFecha.focus(); await page.keyboard.press('e');
    await page.locator('#f_sinAviso:not([disabled])').waitFor({ timeout: 5000 });
    check((await page.locator('#f_sinAviso').isChecked()) === true, `${label}: sin avisos persiste`);
    await page.locator('#f_sinAviso').click(); await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await rowFecha.focus();
    await page.locator('#undoBtn').click(); await page.waitForTimeout(300);
    check((await rowFecha.locator('td[data-fecha]').textContent())?.trim() === fechaAntes, `${label}: deshacer restaura la fecha (${fechaAntes})`);
    await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
    // 6b. botón de copiar la ref. de pago (solo si alguna fila visible tiene ref)
    const copyBtn = page.locator('#tbody tr[data-id] button[data-copy]').first();
    if (await copyBtn.count() && await copyBtn.isVisible()) {
      const ref = await copyBtn.getAttribute('data-copy');
      await copyBtn.click(); await page.waitForTimeout(200);
      check((await page.locator('#toastMsg').textContent())?.includes(`Ref. copiada: ${ref}`) === true, `${label}: copiar ref muestra toast`);
    }
    // 7. selección múltiple: barra, marcar, estado masivo, deshacer, eliminar y deshacer
    const estadoDe = async (row) => (await row.getAttribute('class'))?.split(/\s+/).find((c) => c === 'pagado' || c === 'separado' || c === 'pendiente');
    const histAntes7 = parseInt((await page.locator('#histCount').textContent()) || '0', 10);
    await page.locator('#selBtn').click(); await page.waitForTimeout(200);
    check((await page.locator('#selbar').isVisible()) && (await page.locator('#selTotal').textContent())?.includes('0 seleccionados') === true, `${label}: selección: barra visible`);
    const rowA = page.locator('#tbody tr[data-id]').nth(1);
    const rowB = page.locator('#tbody tr[data-id]').nth(2);
    const estadoAntesA = await estadoDe(rowA);
    const estadoAntesB = await estadoDe(rowB);
    await rowA.locator('td.concept').click();
    await rowB.locator('td.concept').click();
    await page.waitForFunction(() => document.getElementById('selTotal')?.textContent?.includes('2 seleccionados'), null, { timeout: 5000 }).catch(() => {});
    check((await page.locator('#selTotal').textContent())?.includes('2 seleccionados') === true
      && (await rowA.getAttribute('class'))?.split(/\s+/).includes('selected') === true
      && (await rowB.getAttribute('class'))?.split(/\s+/).includes('selected') === true, `${label}: selección: 2 seleccionados`);
    await page.locator('#selEstado button[data-e="pagado"]').click();
    await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
    const histTrasEstado = parseInt((await page.locator('#histCount').textContent()) || '0', 10);
    check((await estadoDe(rowA)) === 'pagado' && (await estadoDe(rowB)) === 'pagado'
      && histTrasEstado === histAntes7 + 1
      && (await page.locator('#sync').textContent())?.startsWith('Guardado') === true, `${label}: selección: estado masivo pagado`);
    await page.locator('#undoBtn').click();
    await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
    check((await estadoDe(rowA)) === estadoAntesA && (await estadoDe(rowB)) === estadoAntesB
      && (await page.locator('#sync').textContent())?.startsWith('Guardado') === true, `${label}: selección: deshacer masivo`);
    await page.locator('#selCancel').click(); await page.waitForTimeout(150);
    await page.locator('#selBtn').click(); await page.waitForTimeout(150);
    const filasAntesDel = await page.locator('#tbody tr[data-id]').count();
    await page.locator('#tbody tr[data-id]').nth(1).click();
    await page.locator('#selDel').click();
    await page.waitForFunction((n) => document.querySelectorAll('#tbody tr[data-id]').length === n, filasAntesDel - 1, { timeout: 5000 }).catch(() => {});
    const filasTrasDel = await page.locator('#tbody tr[data-id]').count();
    await page.waitForFunction(() => document.getElementById('toastMsg')?.textContent?.includes('Eliminada 1 fila'), null, { timeout: 5000 }).catch(() => {});
    const toastOk = (await page.locator('#toastMsg').textContent())?.includes('Eliminada 1 fila') === true;
    await page.locator('#toastAct').click();
    await page.waitForFunction((n) => document.querySelectorAll('#tbody tr[data-id]').length === n, filasAntesDel, { timeout: 5000 }).catch(() => {});
    const filasTrasDeshacer = await page.locator('#tbody tr[data-id]').count();
    await page.waitForFunction(() => document.getElementById('sync')?.textContent?.startsWith('Guardado'), null, { timeout: 5000 }).catch(() => {});
    check(filasTrasDel === filasAntesDel - 1 && toastOk && filasTrasDeshacer === filasAntesDel
      && (await page.locator('#sync').textContent())?.startsWith('Guardado') === true, `${label}: selección: eliminar y deshacer`);
    check(!(await page.locator('#selbar').isVisible())
      && (await page.evaluate(() => document.body.classList.contains('selmode'))) === false, `${label}: selección: modo cerrado`);
    // 8. recibo: la hoja abre y cierra sin disparar el análisis
    await page.locator('#reciboBtn').click();
    await page.locator('#reciboBox').waitFor({ timeout: 5000 });
    check((await page.locator('#reciboBox').isVisible())
      && (await page.locator('#rbTomar').isVisible())
      && (await page.locator('#rbElegir').isVisible()), `${label}: recibo: hoja abierta`);
    await page.keyboard.press('Escape');
    check(await page.locator('#modalRoot').isHidden(), `${label}: recibo: hoja cerrada`);
  }
  if (!touch) {
    // 8. compartir (Web Share Target): el SW intercepta el POST, guarda la imagen y redirige; al arrancar con #compartir la app abre la hoja de recibo (sin AI en CI → error con Reintentar)
    const compartido = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
      const fd = new FormData(); fd.append('imagen', new Blob([new Uint8Array(64)], { type: 'image/jpeg' }), 'recibo.jpg');
      const res = await fetch('/compartir', { method: 'POST', body: fd });
      const hit = await (await caches.open('tg-compartir')).match('/compartir/pendiente');
      return { controlada: !!navigator.serviceWorker.controller, destino: new URL(res.url).pathname, tipo: hit ? hit.headers.get('Content-Type') : null };
    });
    check(compartido.controlada && compartido.destino === '/' && compartido.tipo === 'image/jpeg', `${label}: el SW intercepta POST /compartir y guarda la imagen ${JSON.stringify(compartido)}`);
    // navegación real (no solo cambio de hash) para que la app arranque de nuevo, como al llegar desde Compartir
    await page.goto(new URL(`/?compartir=${Date.now()}#compartir`, page.url()).href, { waitUntil: 'load' });
    await page.locator('#reciboBox').waitFor({ timeout: 8000 });
    await page.locator('#rbReintentar').waitFor({ timeout: 8000 });
    check(true, `${label}: compartir abre la hoja de recibo`);
    await page.keyboard.press('Escape');
  }
  check(errors.length === 0, `${label}: sin pageerror ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
}

await scenario('desktop', { viewport: { width: 1366, height: 900 } }, false);
await scenario('tablet', { ...devices['iPad (gen 7)'], viewport: { width: 810, height: 1080 }, hasTouch: true, isMobile: true }, false);
await scenario('phone', { ...devices['Pixel 7'] }, true);
if (failures.length) { console.error(`\n${failures.length} fallos`); process.exit(1); }
console.log('\nsmoke OK');
