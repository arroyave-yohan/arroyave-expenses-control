import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import type { Bindings } from '../shared/types';
import { accessAuth, type AppEnv } from './auth';
import { avisosRoutes, pushRoutes } from './avisos';
import { bolsillosRoutes } from './bolsillos';
import { categoriasRoutes } from './categorias';
import { exportRoutes } from './export';
import { SchemaError } from './kv';
import { monthsRoutes } from './months';
import { createSender, runAvisos, type PushSender } from './push';
import { createAnalizador, recibosRoutes, type Analizador } from './recibos';

export type { AppEnv };

export function createApp(opts: { getKey?: JWTVerifyGetKey; sender?: PushSender; analizador?: Analizador } = {}) {
  const app = new Hono<AppEnv>();
  const senderFor = (env: Bindings) => opts.sender ?? createSender(env);
  const analizadorFor = (env: Bindings) => opts.analizador ?? createAnalizador(env);

  app.post('/compartir', (c) => c.redirect('/', 303));

  app.get('/health', (c) => c.json({ ok: true }));

  app.use('/api/*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  });
  app.use('/api/*', accessAuth(opts));

  app.get('/api/me', (c) => c.json({ email: c.get('email') }));

  app.route('/api/months', monthsRoutes);
  app.route('/api/categorias', categoriasRoutes);
  app.route('/api/bolsillos', bolsillosRoutes);
  app.route('/api/export', exportRoutes);
  app.route('/api/avisos', avisosRoutes(senderFor));
  app.route('/api/push', pushRoutes(senderFor));
  app.route('/api/recibos', recibosRoutes(analizadorFor));

  app.notFound((c) => c.json({ error: 'not_found', message: 'Ruta no encontrada' }, 404));
  app.onError((err, c) => {
    if (err instanceof SchemaError) {
      console.error('schema error', err.message);
      return c.json({ error: 'schema', message: err.message }, 500);
    }
    console.error(err);
    return c.json({ error: 'internal', message: 'Error interno' }, 500);
  });
  return app;
}

const app = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  // Cron horario (wrangler.jsonc → triggers.crons); runAvisos decide si es la hora del aviso.
  scheduled: (controller, env, ctx) => {
    ctx.waitUntil(runAvisos(env, { now: new Date(controller.scheduledTime), sender: createSender(env) }).then((r) => console.log('avisos', JSON.stringify(r))));
  },
} satisfies ExportedHandler<Bindings>;
