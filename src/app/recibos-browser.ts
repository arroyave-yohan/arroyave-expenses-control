/** Reescala a máx. 1280 px de lado y JPEG 0,85; si algo falla, devuelve el archivo original. */
export async function reducirImagen(file: Blob, max = 1280): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.type === 'image/jpeg') return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('sin blob'))), 'image/jpeg', 0.85));
  } catch { return file; }
}

/** Abre el selector nativo (cámara si capture=true). Resuelve null si el usuario cancela.
 *  Los navegadores sin evento `cancel` no avisan: si la ventana perdió el foco (selector abierto) y lo recupera sin que
 *  llegue `change` en un momento, se resuelve null para no dejar la promesa colgada. */
export function elegirArchivo(capture: boolean, espera = 2000): Promise<File | null> {
  return new Promise((res) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    let listo = false; let timer = 0;
    const alVolver = () => { timer = window.setTimeout(() => done(input.files?.[0] ?? null), espera); };
    const alSalir = () => { window.addEventListener('focus', alVolver, { once: true }); };
    const done = (f: File | null) => {
      if (listo) return; listo = true; clearTimeout(timer);
      window.removeEventListener('blur', alSalir); window.removeEventListener('focus', alVolver); res(f);
    };
    input.onchange = () => done(input.files?.[0] ?? null);
    input.oncancel = () => done(null);
    window.addEventListener('blur', alSalir, { once: true });
    input.click();
  });
}

export const COMPARTIR_CACHE = 'tg-compartir', COMPARTIR_KEY = '/compartir/pendiente';
/** Borra una imagen compartida que quedó sin consumir (la app no llegó a abrirse tras el "Compartir"). */
export async function limpiarCompartida(): Promise<void> {
  try { if ('caches' in window) await caches.delete(COMPARTIR_CACHE); } catch { /* sin caché */ }
}
/** Recupera (y borra) la imagen que el service worker guardó al recibir "Compartir". */
export async function tomarCompartida(): Promise<Blob | null> {
  if (!('caches' in window)) return null;
  const cache = await caches.open(COMPARTIR_CACHE);
  const hit = await cache.match(COMPARTIR_KEY); if (!hit) return null;
  const blob = await hit.blob(); await cache.delete(COMPARTIR_KEY);
  return blob;
}
