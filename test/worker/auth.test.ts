import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { SignJWT, generateKeyPair } from 'jose';
import { makeAuthedApp, api } from '../helpers';

describe('accessAuth', () => {
  it('401 sin token', async () => {
    const { app } = await makeAuthedApp();
    const res = await api(app, {}, 'GET', '/api/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'unauthorized', message: 'Falta el token de Access' });
  });

  it('200 con token válido y expone el email', async () => {
    const { app, headers } = await makeAuthedApp();
    const res = await api(app, headers, 'GET', '/api/me');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ email: 'yo@ejemplo.com' });
  });

  it('401 con audiencia incorrecta', async () => {
    const { app, signWith } = await makeAuthedApp();
    const token = await signWith({ email: 'yo@ejemplo.com' }, { aud: 'otra-app' });
    const res = await api(app, { 'Cf-Access-Jwt-Assertion': token }, 'GET', '/api/me');
    expect(res.status).toBe(401);
  });

  it('401 con token expirado', async () => {
    const { app, signWith } = await makeAuthedApp();
    const token = await signWith({ email: 'yo@ejemplo.com' }, { exp: '-10m' });
    const res = await api(app, { 'Cf-Access-Jwt-Assertion': token }, 'GET', '/api/me');
    expect(res.status).toBe(401);
  });

  it('401 con emisor incorrecto', async () => {
    const { app, signWith } = await makeAuthedApp();
    const token = await signWith({ email: 'yo@ejemplo.com' }, { iss: 'https://otro.cloudflareaccess.com' });
    const res = await api(app, { 'Cf-Access-Jwt-Assertion': token }, 'GET', '/api/me');
    expect(res.status).toBe(401);
  });

  it('401 sin claim de email', async () => {
    const { app, signWith } = await makeAuthedApp();
    const token = await signWith({});
    const res = await api(app, { 'Cf-Access-Jwt-Assertion': token }, 'GET', '/api/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized', message: 'Token de Access inválido' });
  });

  it('bypass solo con ACCESS_BYPASS=1 y host localhost', async () => {
    const { app } = await makeAuthedApp();
    const bypass = { ...env, ACCESS_BYPASS: '1' };
    const ok = await app.request('http://localhost/api/me', {}, bypass);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ email: 'dev@localhost' });
    const remote = await app.request('https://gastos.ejemplo.com/api/me', {}, bypass);
    expect(remote.status).toBe(401);
    const noFlag = await app.request('http://localhost/api/me', {}, env);
    expect(noFlag.status).toBe(401);
  });

  it('/health sigue abierto', async () => {
    const { app } = await makeAuthedApp();
    expect((await api(app, {}, 'GET', '/health')).status).toBe(200);
  });

  it('401 con token firmado por una llave que no está en el JWKS', async () => {
    const { app } = await makeAuthedApp();
    const { privateKey: otherPrivateKey } = await generateKeyPair('RS256', { extractable: true });
    const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
    const token = await new SignJWT({ email: 'yo@ejemplo.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(env.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherPrivateKey);
    const res = await api(app, { 'Cf-Access-Jwt-Assertion': token }, 'GET', '/api/me');
    expect(res.status).toBe(401);
  });

  it('401 con token HS256 firmado usando la JWK pública como secreto', async () => {
    const { app, publicJwk } = await makeAuthedApp();
    const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
    const secretBytes = new TextEncoder().encode(JSON.stringify(publicJwk));
    const token = await new SignJWT({ email: 'yo@ejemplo.com' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(env.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretBytes);
    const res = await api(app, { 'Cf-Access-Jwt-Assertion': token }, 'GET', '/api/me');
    expect(res.status).toBe(401);
  });

  it('503 misconfigured cuando ACCESS_TEAM sigue con el valor de ejemplo', async () => {
    const { app, headers } = await makeAuthedApp();
    const bindings = { ...env, ACCESS_TEAM: 'cambiar-team' };
    const res = await api(app, headers, 'GET', '/api/me', undefined, bindings);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'misconfigured', message: 'Access no está configurado' });
  });
});
