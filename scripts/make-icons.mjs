// Genera los iconos PNG de la PWA a partir de la tesela "YA" del tema (degradado índigo→violeta)
// y el badge monocromo para las notificaciones (Android lo pinta en blanco sobre la barra de estado).
// Uso: npm run icons   (requiere playwright, ya devDependency)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/app/public/icons');
mkdirSync(OUT, { recursive: true });
const FONT = "'IBM Plex Sans','Segoe UI',system-ui,sans-serif";
const tile = (size, pad, radius) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${pad ? '#1F2736' : 'transparent'}">
  <div style="width:${size - pad * 2}px;height:${size - pad * 2}px;border-radius:${radius}px;background:linear-gradient(135deg,#4653D2 0%,#6A55DD 100%);display:grid;place-items:center;box-shadow:inset 0 ${Math.round(size * 0.01)}px 0 rgba(255,255,255,.22)">
    <span style="font:600 ${Math.round((size - pad * 2) * 0.38)}px/1 ${FONT};color:#fff;letter-spacing:-.02em">YA</span>
  </div></div></body></html>`;
const badge = (size) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;display:grid;place-items:center"><span style="font:700 ${Math.round(size * 0.52)}px/1 ${FONT};color:#fff;letter-spacing:-.04em">YA</span></div></body></html>`;

const b = await chromium.launch();
const jobs = [
  ['icon-192.png', 192, tile(192, 0, 42), true], ['icon-512.png', 512, tile(512, 0, 112), true],
  ['icon-maskable-512.png', 512, tile(512, 64, 96), false], ['apple-touch-icon.png', 180, tile(180, 0, 0), false],
  ['badge-96.png', 96, badge(96), true],
];
for (const [file, size, html, transparent] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(html); await p.waitForTimeout(150);
  await p.screenshot({ path: `${OUT}/${file}`, omitBackground: transparent });
  await p.close(); console.log('icono', file);
}
await b.close();
