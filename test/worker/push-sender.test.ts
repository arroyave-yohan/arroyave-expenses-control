import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createSender, vapidListo } from '../../src/worker/push';
import type { Bindings } from '../../src/shared/types';

const b64u = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function vapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey) as JsonWebKey;
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer;
  return { publicKey: b64u(raw), privateKey: jwk.d! };
}
async function clientKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const auth = new Uint8Array(16); crypto.getRandomValues(auth);
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer;
  return { p256dh: b64u(raw), auth: b64u(auth) };
}

describe('vapidListo', () => {
  it('exige las tres variables, longitud mínima y sin placeholder', () => {
    expect(vapidListo(env)).toBe(true);
    expect(vapidListo({ ...env, VAPID_PRIVATE_KEY: '' } as Bindings)).toBe(false);
    expect(vapidListo({ ...env, VAPID_PUBLIC_KEY: 'REEMPLAZAR_CON_scripts_vapid-keys' } as Bindings)).toBe(false);
    expect(vapidListo({ ...env, VAPID_SUBJECT: undefined } as Bindings)).toBe(false);
  });
});

describe('createSender', () => {
  it('firma con VAPID, cifra con aes128gcm y envía por POST al endpoint', async () => {
    const vapid = await vapidKeys();
    const sub = { id: 'p_1', endpoint: 'https://push.example.org/send/abc', expirationTime: null, keys: await clientKeys(), nombre: 'Prueba', createdAt: '' };
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn: typeof fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(null, { status: 201 }); };
    const send = createSender({ ...env, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'https://gastos.example' } as Bindings, fetchFn);
    const r = await send(sub, { title: 'Hola', body: 'Cuerpo', url: '/#2026-09', tag: 'prueba' });
    expect(r.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(sub.endpoint);
    expect(calls[0].init.method?.toLowerCase()).toBe('post');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(h.authorization.endsWith(`k=${vapid.publicKey}`)).toBe(true);
    expect(h['content-encoding']).toBe('aes128gcm');
    expect(h.ttl).toBe(String(6 * 3600));
    expect(h.urgency).toBe('normal');
    expect((calls[0].init.body as Uint8Array).byteLength).toBeGreaterThan(100);
  });
});
