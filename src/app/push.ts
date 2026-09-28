import type { AvisosEstado, PushSub } from '../shared/avisos';

export type PushSubInput = { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string }; nombre: string };
export type PushSubPublic = Omit<PushSub, 'keys'>;
export type PushInfo = { publicKey: string; items: PushSubPublic[]; estado: AvisosEstado };
export type EnvioResumen = { enviadas: number; eliminadas: number; fallidas: number };

/** Etiqueta corta del dispositivo a partir del user agent: "Android · Chrome". */
export function deviceLabel(ua: string): string {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Dispositivo';
  const nav = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Navegador';
  return `${os} · ${nav}`;
}

/** Clave pública VAPID (base64url) → bytes, formato que exige pushManager.subscribe. */
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
