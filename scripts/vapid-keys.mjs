// Genera un par de claves VAPID (ECDSA P-256) en el formato que espera @block65/webcrypto-web-push:
// pública = punto sin comprimir (65 bytes) base64url; privada = escalar d del JWK (base64url).
// Uso: node scripts/vapid-keys.mjs  → pegar VAPID_PUBLIC_KEY en wrangler.jsonc (vars) y
//      VAPID_PRIVATE_KEY en .dev.vars y en `npx wrangler secret put VAPID_PRIVATE_KEY`.
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const raw = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey));
console.log(`VAPID_PUBLIC_KEY=${raw.toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
