import { env } from 'cloudflare:test';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { createApp } from '../src/worker/index';
import type { Bindings } from '../src/shared/types';

export async function makeAuthedApp() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const app = createApp({ getKey });
  const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;

  async function signWith(claims: Record<string, unknown>, opts: { aud?: string; exp?: string; iss?: string } = {}) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(opts.iss ?? issuer)
      .setAudience(opts.aud ?? env.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '1h')
      .sign(privateKey);
  }

  const token = await signWith({ email: 'yo@ejemplo.com' });
  return { app, token, headers: { 'Cf-Access-Jwt-Assertion': token }, signWith, publicJwk: jwk };
}

export type AuthedApp = Awaited<ReturnType<typeof makeAuthedApp>>;

export function api(
  app: AuthedApp['app'],
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
  bindings: Bindings = env,
) {
  return app.request(
    path,
    {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    bindings,
  );
}
