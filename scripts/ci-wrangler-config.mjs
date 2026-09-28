// Genera wrangler.ci.jsonc a partir de wrangler.jsonc sin el binding `ai` ni las rutas propias:
// en CI no hay sesión de Cloudflare y el binding AI obliga a un proxy remoto que necesita CLOUDFLARE_API_TOKEN.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const cfg = JSON.parse(src.replace(/^\s*\/\/.*$/gm, ''));
delete cfg.ai; delete cfg.routes; delete cfg.workers_dev;
// La clave pública placeholder de wrangler.jsonc no pasa vapidListo(); en CI basta una de relleno
// (solo se comprueba su presencia; nada se envía).
cfg.vars = { ...cfg.vars, VAPID_PUBLIC_KEY: 'ci-dummy-public-key-0123456789abcdef' };
writeFileSync(new URL('../wrangler.ci.jsonc', import.meta.url), JSON.stringify(cfg, null, 2) + '\n');
console.log('wrangler.ci.jsonc generado (sin ai/routes)');
