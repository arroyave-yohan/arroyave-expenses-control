/* Torre de control — service worker.
   Estrategia: red primero; lo que responda bien se guarda en caché y se usa solo cuando la red falla.
   Nunca se cachean redirecciones (login de Access) ni respuestas que no sean 200 del mismo origen. */
const CACHE = 'tg-v5';
const COMPARTIR = 'tg-compartir'; // imagen pendiente de "Compartir": la consume la app, no se borra al activar un SW nuevo
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png', '/icons/badge-96.png'];

/* Los JS/CSS llevan hash en el nombre: se descubren leyendo index.html en vez de fijarlos aquí. */
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL).catch(() => {});
  try {
    const html = await (await fetch('/', { cache: 'no-cache' })).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(assets.map((a) => cache.add(a).catch(() => {})));
  } catch { /* sin red durante la instalación: se cachea al navegar */ }
}
self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== COMPARTIR).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function referrerPropio(ref) {
  if (!ref || ref === 'about:client') return true;
  try { return new URL(ref).origin === self.location.origin; } catch { return false; }
}
const cacheable = (req, res) => req.method === 'GET' && res && res.ok && res.type === 'basic' && !res.redirected;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Web Share Target: Android envía la captura por POST; se guarda y se abre la app en el flujo de recibo.
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname === '/compartir') {
    e.respondWith((async () => {
      // Solo se acepta el envío del sistema (sin referrer) o de la propia app: un formulario de otro origen no deja imagen.
      if (!referrerPropio(req.referrer)) return Response.redirect(new URL('/', self.location.origin).href, 303);
      try {
        const fd = await req.formData(); const f = fd.get('imagen');
        if (f && typeof f !== 'string') { const cache = await caches.open(COMPARTIR); await cache.put('/compartir/pendiente', new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } })); }
      } catch { /* sin archivo: se abre la app igual */ }
      return Response.redirect(new URL('/#compartir', self.location.origin).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return; // fuentes externas: el navegador se encarga
  if (url.pathname.startsWith('/cdn-cgi/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (cacheable(req, res)) cache.put(req.mode === 'navigate' ? '/' : req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req.mode === 'navigate' ? '/' : req);
      if (hit) return hit;
      if (url.pathname.startsWith('/api/')) return new Response(JSON.stringify({ error: 'offline', message: 'Sin conexión' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      throw new Error('offline');
    }
  })());
});

/* Notificaciones: el Worker envía { title, body, url, tag, tipo, actions, data } cifrado; aquí solo se muestra. */
self.addEventListener('push', (e) => {
  let n = { title: 'Gastos', body: '', url: '/', tag: 'aviso', tipo: null, actions: [], data: {} };
  try { n = { ...n, ...e.data.json() }; } catch { if (e.data) n.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(n.title, {
    body: n.body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: n.tag, renotify: true,
    actions: (n.actions || []).slice(0, 2), // Android muestra máximo dos botones
    data: { url: n.url, tipo: n.tipo, ...(n.data || {}) },
  }));
});

async function abrirApp(url) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const w = wins.find((c) => c.url.startsWith(self.location.origin));
  if (w) {
    try { await w.focus(); if ('navigate' in w) await w.navigate(url); return; } catch { /* ventana no controlada: cae a abrir una nueva */ }
  }
  await self.clients.openWindow(url);
}

/* Botones: pagar/aplazar/mastarde llaman a la API con la cookie de Access; si falla (sesión vencida), se abre la app. */
async function ejecutarAccion(accion, d) {
  const body = accion === 'mastarde' ? { accion, horas: d.horas } : { accion, ym: d.ym, rowId: d.rowId, horas: accion === 'aplazar' ? d.horas : undefined };
  const res = await fetch('/api/avisos/accion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  if (!res.ok || res.redirected) throw new Error(`accion ${accion}: ${res.status}`);
}
const ACCIONES = new Set(['pagar', 'aplazar', 'mastarde']);
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = new URL(d.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    if (ACCIONES.has(e.action)) {
      try {
        await ejecutarAccion(e.action, d);
        if (e.action === 'pagar') await self.registration.showNotification(`${d.concepto || 'Gasto'} marcado como pagado`, { tag: 'accion-ok', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url } });
        return;
      } catch { /* sigue abajo: abrir la app en el mes */ }
    }
    await abrirApp(url);
  })());
});
