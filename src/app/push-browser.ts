import { deviceLabel, urlBase64ToUint8Array, type PushSubInput } from './push';

export function pushSoportado(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function localSubscription(): Promise<PushSubscription | null> {
  if (!pushSoportado()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Pide permiso y suscribe este navegador; devuelve el cuerpo listo para POST /api/push. */
export async function subscribeHere(publicKey: string): Promise<PushSubInput> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permiso de notificaciones denegado');
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('El service worker no está registrado');
  const opts = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) };
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe(opts);
  } catch (e) {
    // Claves VAPID regeneradas: la suscripción vieja queda con la clave anterior; reintenta una vez tras cancelarla.
    if ((e as Error).name !== 'InvalidStateError') throw e;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    sub = await reg.pushManager.subscribe(opts);
  }
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error('La suscripción no trae claves');
  return { endpoint: j.endpoint, expirationTime: j.expirationTime ?? null, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, nombre: deviceLabel(navigator.userAgent) };
}
