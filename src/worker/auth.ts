import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Bindings } from '../shared/types';

export type AppEnv = { Bindings: Bindings; Variables: { email: string } };

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteGetKey(issuer: string): JWTVerifyGetKey {
  let getKey = remoteKeySets.get(issuer);
  if (!getKey) {
    getKey = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    remoteKeySets.set(issuer, getKey);
  }
  return getKey;
}

export function accessAuth(opts: { getKey?: JWTVerifyGetKey } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (c.env.ACCESS_BYPASS === '1' && (host === 'localhost' || host === '127.0.0.1')) {
      c.set('email', 'dev@localhost');
      return next();
    }

    const team = c.env.ACCESS_TEAM, aud = c.env.ACCESS_AUD;
    if (!team || !aud || team.startsWith('cambiar') || aud.startsWith('cambiar')) {
      return c.json({ error: 'misconfigured', message: 'Access no está configurado' }, 503);
    }

    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) return c.json({ error: 'unauthorized', message: 'Falta el token de Access' }, 401);

    const issuer = `https://${c.env.ACCESS_TEAM}.cloudflareaccess.com`;
    const getKey = opts.getKey ?? remoteGetKey(issuer);
    try {
      const { payload } = await jwtVerify(token, getKey, {
        issuer,
        audience: c.env.ACCESS_AUD,
        algorithms: ['RS256'],
      });
      const email = payload.email;
      if (typeof email !== 'string' || email.length === 0) {
        throw new Error('missing or invalid email claim');
      }
      c.set('email', email);
    } catch (err) {
      console.error('access jwt rejected', err instanceof Error ? err.message : String(err));
      return c.json({ error: 'unauthorized', message: 'Token de Access inválido' }, 401);
    }
    await next();
  });
}
