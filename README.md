# Torre de control de gastos

App personal de control de gastos mensuales, pensada para **un solo usuario** y para
desplegarse en **tu propia cuenta de Cloudflare** (free tier). Cloudflare Worker (Hono) +
Workers KV + Workers AI + Cloudflare Access. Frontend Vite + TypeScript sin framework,
tablet-first, instalable como PWA con soporte offline.

> **English summary** — Personal monthly expense tracker you self-host on your own
> Cloudflare account (free tier): a Worker (Hono) with Workers KV storage, protected by
> Cloudflare Access (One-time PIN, single-email policy). Tablet-first PWA with offline
> support, three expense states (pending / set aside / paid), push reminders with action
> buttons, and a receipt scanner powered by Workers AI tuned for Colombian bank
> notifications (Bancolombia, Nequi, Nu). Your financial data never leaves your account.
> Deploy in ~15 minutes following the steps below (in Spanish).

## Qué es

- **Gastos por mes**: cada mes es un documento; duplicas el mes anterior para empezar el siguiente.
- **Tres estados por gasto**: `pendiente` → `separado` → `pagado`, con un toque o deslizando la fila.
- **Tablet-first y PWA**: pensada para usarse en una tableta, instalable desde el navegador,
  y sin red muestra el último mes leído.
- **Avisos push con acciones**: resumen diario a la hora que elijas (hora de Colombia) y avisos
  por gasto con botones "Pagado" y "Aplazar".
- **Escáner de recibos**: comparte la captura de la notificación del banco (o una foto) y
  Workers AI extrae comercio, monto y fecha; está afinado para los formatos de
  **Bancolombia, Nequi y Nu**. La imagen no se guarda.
- **Selección múltiple, deshacer/rehacer, exportar CSV/JSON, modo oscuro.**

## Por qué self-host

Son tus datos financieros. Con este proyecto viven en **tu** cuenta de Cloudflare, dentro de
un KV que solo tu Worker lee, detrás de Cloudflare Access con una política de **un solo
email: el tuyo**. Nadie más los ve, no hay servidor de terceros, y todo cabe en el plan
gratuito de Cloudflare (Workers, KV, Workers AI y Zero Trust tienen free tier).

## Requisitos

- Cuenta de Cloudflare gratuita ([dash.cloudflare.com](https://dash.cloudflare.com)).
- Node.js 24+ y npm.

## Despliega el tuyo en 15 minutos

1. **Clona e instala**

   ```bash
   git clone https://github.com/arroyave-yohan/arroyave-expenses-control.git
   cd arroyave-expenses-control
   npm install
   npx wrangler login
   ```

2. **Crea el KV**

   ```bash
   npx wrangler kv namespace create GASTOS_KV
   ```

   Copia el `id` que imprime el comando en `wrangler.jsonc` → `kv_namespaces[0].id`.

3. **Claves VAPID (avisos push)**

   ```bash
   npm run vapid:keys
   ```

   - La clave **pública** va en `wrangler.jsonc` → `vars.VAPID_PUBLIC_KEY`.
   - La **privada** va como secreto: `npx wrangler secret put VAPID_PRIVATE_KEY`
     (y en `.dev.vars` para desarrollo local).
   - En `vars.VAPID_SUBJECT` pon `mailto:tu-correo@ejemplo.com` (tu correo real).
   - Si algún día regeneras las claves, todos los dispositivos deben volver a suscribirse.

4. **Primer deploy**

   ```bash
   npm run deploy
   ```

   Anota la URL `https://expenses-control.<tu-subdominio>.workers.dev`.
   **Todavía no la uses ni la compartas**: falta protegerla con Access (paso 5).
   Mientras `ACCESS_TEAM` y `ACCESS_AUD` sigan con los valores de ejemplo, toda petición a
   `/api/*` responde `503 { "error": "misconfigured" }` — es lo esperado en este punto.

   > Nota: si el deploy rechaza la `compatibility_date`, bájala en `wrangler.jsonc` al valor
   > que acepte tu versión de `workerd`.

5. **Protege el Worker con Cloudflare Access** (una sola vez)

   1. Dashboard → **Zero Trust** (si no tienes equipo, créalo con el plan Free) →
      Settings → Authentication → Login methods → agrega **One-time PIN**.
   2. Dashboard → Workers & Pages → `expenses-control` → pestaña **Access** →
      **Protect this Worker**. Crea la política con **tu email exacto** (regla `Emails`).
   3. Zero Trust → Access → Applications → abre la aplicación creada → Configure →
      Additional settings → copia el **Application Audience (AUD) Tag**.
   4. En `wrangler.jsonc` pon:
      - `ACCESS_TEAM`: el subdominio de tu equipo Zero Trust
        (el `<team>` de `<team>.cloudflareaccess.com`).
      - `ACCESS_AUD`: el AUD que copiaste.

      Y despliega otra vez: `npm run deploy`.
   5. **Verifica**: abre `https://.../api/me` en el navegador. Access debe pedirte el PIN por
      email y luego responder `{ "email": "tu@correo" }`. Desde `curl` sin cookie debe
      redirigir al login de Access, y con un `Cf-Access-Jwt-Assertion` inválido responder 401.

6. **Instala la PWA**: abre la URL en tu tableta o teléfono → menú del navegador →
   "Añadir a pantalla de inicio". Activa los avisos en **Avisos…** dentro de la app.

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars     # ACCESS_BYPASS=1 solo en local
npm test                           # construye el frontend y corre Vitest en workerd
npm run typecheck                  # tsc en src/, test/ y scripts/
npm run dev                        # http://localhost:8787/api/me → { "email": "dev@localhost" }
```

- `npm run dev:api` (Worker en :8787 con `--local-upstream localhost`, necesario para el
  bypass de Access) y `npm run dev:app` (Vite en :5173 con proxy a `/api`).
- `npm run build` genera `dist/`; el Worker lo sirve como Static Assets y solo `/api/*`,
  `/health` y `/compartir` pasan por el código.
- `npm run smoke` recorre la app en headless (escritorio, tablet, teléfono) con Playwright;
  requiere `wrangler dev` en :8787 con datos locales. Úsalo como puerta antes de cada deploy.
- La app vive en la raíz; el mes activo va en el hash de la URL (`#2026-08`).

### Importar datos desde CSV (opcional)

Si vienes de una hoja de cálculo, exporta cada mes como CSV y usa:

```bash
npm run import:csv -- 2026-01=ruta/2026-01.csv 2026-02=ruta/2026-02.csv
npx wrangler kv bulk put import/bulk.json --binding GASTOS_KV --remote
```

Revisa los totales que imprime contra tu hoja. Si un mes no trae la fila "Ingresos",
pásalo con `--ingresos 2026-02=<monto>`. Para datos locales de desarrollo, el mismo bulk
con `--local`.

## Lista de chequeo de QA (manual, en tablet)

Checklist genérica antes de cada release:

1. El panel de fila sale como hoja inferior en vertical; al abrir el teclado, el campo enfocado sigue visible.
2. Grilla legible en vertical y horizontal; filas de 44 px; Link y Ref ocultos en tablet y visibles en el panel.
3. Tocar Monto abre el teclado numérico; Enter guarda; el indicador pasa por "Guardando…" y "Guardado".
4. Pend · Sep · Pag cambia con un toque; al marcar Pag aparece la fecha de hoy.
5. Deslizar una fila a la derecha avanza el estado; a la izquierda abre la hoja de acciones; el botón ⋯ también.
6. Filtros: búsqueda, estado, bolsillo, chips y agrupar se combinan y el pie muestra los totales visibles.
7. Duplicar mes, eliminar mes (escribiendo el nombre) y exportar CSV funcionan.
8. Con dos pestañas abiertas, editar en ambas produce el toast de conflicto en la segunda y recarga el mes.
9. El modo oscuro del sistema se respeta.
10. Buscar sigue aceptando texto después de marcar una fila como pagada.
11. Abrir un mes antiguo, editar un monto y ver "Guardado"; volver al mes actual y editar de nuevo.
12. Escribir un monto muestra los puntos de miles mientras se escribe.
13. Deshacer (↶ o Ctrl+Z) revierte de más reciente a más antiguo; la lista muestra hasta 10 y tocar una entrada revierte hasta ella.
14. Bolsillos… permite renombrar y el cambio se refleja en todas las filas.
15. Tocar la columna Fecha abre el selector; una fecha pasada en una fila no pagada se ve en rojo, una que vence en 3 días en ámbar, y la franja Pendiente cuenta vencidas y próximas.
16. Instalar como PWA: abre a pantalla completa y, sin red, muestra el último mes leído con el aviso "Sin conexión".
17. Rehacer (↷ o Ctrl+Shift+Z) revierte un deshacer; el historial sobrevive a recargar la página.
18. Avisos…: activar "Recibir avisos en este dispositivo", "Enviar prueba" muestra la notificación; el aviso diario llega a la hora elegida y al tocarlo abre el mes.
19. Botones de la notificación: "Pagado" marca pagado con fecha de hoy y "Aplazar N h" vuelve a avisar más tarde; en el resumen, "Más tarde" lo aplaza. En el panel de una fila con fecha se puede silenciar ese gasto y quitar un aplazamiento.
20. Seleccionar (botón en la barra de filtros, pulsación larga en tableta, o Ctrl/Shift+clic en escritorio): la barra inferior muestra cuántas filas son y cuánto suman, y permite cambiar estado, categoría, bolsillo o fecha a todas, o eliminarlas; cada acción se deshace en un paso.
21. Recibo: compartir una captura de la notificación del banco con la app (Android) o botón Recibo → foto/imagen; la hoja muestra lo leído y deja crear el gasto pagado o marcar un pendiente sugerido; la imagen no se guarda.

## Seguridad

- **Cloudflare Access protege todo el Worker** (páginas y API; solo `/health` queda sin auth).
  El Worker además valida el JWT de Access (`ACCESS_TEAM` + `ACCESS_AUD`) en cada petición a `/api/*`.
- **Sin Access configurado, NO expongas la URL.** Hasta completar el paso 5, la API responde
  503 a propósito, pero no publiques la URL ni la dejes en marcadores compartidos.
- La política de Access debe tener **un solo email** (el tuyo). Es una app de un solo usuario.
- **`ACCESS_BYPASS=1` es solo para desarrollo local.** El código lo ignora salvo que el
  hostname de la petición sea `localhost` o `127.0.0.1` (`src/worker/auth.ts`), así que
  definir la variable en producción no abre la API; aun así, nunca la pongas en `vars` de
  `wrangler.jsonc` ni como secreto del Worker — su único lugar es `.dev.vars`.
- `.dev.vars` (con `ACCESS_BYPASS` y la clave VAPID privada) nunca se sube al repo; la clave
  privada en producción vive como secreto de Wrangler.

## Respaldo

- `https://.../api/export` (JSON) o `https://.../api/export?format=csv` desde el navegador autenticado.
- Manual: `npx wrangler kv key list --binding GASTOS_KV --remote` y
  `npx wrangler kv key get <clave> --binding GASTOS_KV --remote`.
- Un mes dañado se repara descargando `/api/months/YYYY-MM/raw`, corrigiendo el JSON y
  subiéndolo con `npx wrangler kv key put month:YYYY-MM --path archivo.json --binding GASTOS_KV --remote`.

## API

| Ruta | Descripción |
|---|---|
| `GET /health` | Sin auth. `{ ok: true }` |
| `GET /api/me` | Email autenticado |
| `GET /api/months` | `{ months: ["2026-08", ...] }` |
| `GET /api/months/:ym` | Documento del mes |
| `GET /api/months/:ym/raw` | JSON crudo del mes (para reparar un documento dañado) |
| `PUT /api/months/:ym` | Guarda el mes completo. Envía `version` leída. 409 si cambió. |
| `POST /api/months/:ym/duplicate` | `{ target, soloRecurrentes, resetEstado, mantenerMontos, mantenerIngresos, reemplazar }` |
| `DELETE /api/months/:ym` | Borra el mes |
| `GET /api/categorias` · `PUT /api/categorias` | Lista curada (409 `in_use` si borras una en uso) |
| `GET /api/export[?format=csv]` | Todo |

## Licencia

[MIT](LICENSE) © 2026 Yohan Arroyave
