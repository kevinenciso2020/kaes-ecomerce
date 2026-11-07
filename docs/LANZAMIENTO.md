# Runbook de lanzamiento — Kaes Store

Pasos que **no se pueden hacer desde el código** y que hay que completar antes de
vender. Marca cada casilla. Orden recomendado: de arriba hacia abajo.

## 1. Limpiar producción (hoy)

- [ ] Simulación de limpieza contra producción (desde tu máquina, con `DATABASE_URL` de producción **sólo en esa terminal**):
  ```bash
  cd backend
  DATABASE_URL="postgresql://…neon…" DIRECT_URL="postgresql://…neon…" pnpm run cleanup:test-data
  ```
  Revisa la lista (productos de prueba, admins existentes).
- [ ] Aplicar: repite el comando con `--confirm`.
- [ ] Si `admin@ecommerce.com` existía: **rota** `JWT_SECRET` y `JWT_REFRESH_SECRET` en Railway (todas las sesiones se cierran).
- [ ] Crea tu admin real y retira a los anteriores (simulación; agrega `--confirm` para aplicar):
  ```bash
  NEW_ADMIN_EMAIL=tu@correo.com NEW_ADMIN_PASSWORD='una-clave-larga-2026' pnpm run admin:replace
  ```
- [ ] Crea un **branch de Neon** para desarrollo y cambia tu `backend/.env` local a ese branch (hoy apunta a producción).

## 2. Variables de entorno

Lista completa y comentada en `backend/.env.example` y `frontend/.env.example`.

**Railway (backend):** `NODE_ENV=production`, `FRONTEND_URL`, `BACKEND_URL`, `DATABASE_URL`, `DIRECT_URL`,
`JWT_SECRET`, `JWT_REFRESH_SECRET` (≥32 caracteres, distintos), `JWT_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=7d`,
`CLOUDINARY_*`, `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`,
`SSR_API_KEY`, `SENTRY_DSN`, `SMTP_*`, `SHIPPING_FLAT_RATE`, `FREE_SHIPPING_FROM`.
Opcional: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, `TAX_SOURCE_URL` (fuente oficial del IVA que revisa el job diario), `TAX_ALERT_EMAIL` (correo que recibe el aviso si la tasa difiere).

**Cloudflare Workers (frontend):** hay dos tipos de variables (ver sección 11).
- De **build** (Settings → Build → Variables): `PUBLIC_API_URL` (termina en `/api/v1`), `SITE_URL`, `NODE_VERSION=22` y cualquier `PUBLIC_*` (p. ej. `PUBLIC_LEGAL_NIT`). Se fijan al construir: si cambian, hay que volver a desplegar.
- De **runtime** (Settings → Variables and Secrets): `SSR_API_KEY` como **secreto** (mismo valor que en Railway, sin `PUBLIC_`) y `ADMIN_SSR_GUARD=strict`.
`JWT_SECRET` no se usa en el frontend.

> Si falta una variable requerida o un secreto JWT es débil, el backend no arranca en producción (a propósito).

## 3. Pasarelas de pago (sandbox primero)

> Cómo crear cada cuenta y dónde va cada llave: **[docs/PAGOS.md](PAGOS.md)**.

### Wompi (recomendado para lanzar)
- [ ] Panel Wompi → Desarrolladores → **URL de eventos**: `https://<api>/api/v1/payments/wompi/webhook`
- [ ] Copia las 4 llaves de **prueba** (`pub_test`, `prv_test`, `test_integrity`, `test_events`) a Railway.
- [ ] Checklist sandbox (usa las tarjetas/PSE de prueba de Wompi):
  - [ ] Pago aprobado → la orden pasa a "Pagado", baja el stock, llega el email, el carrito queda vacío.
  - [ ] Pago rechazado → la orden sigue "Pendiente de pago" y se puede **reintentar** desde "Mis pedidos".
  - [ ] PSE pendiente → la página de resultado muestra "Pago en proceso" y luego se confirma sola.
  - [ ] Reenvía el mismo evento desde el panel → el stock **no** baja dos veces.
  - [ ] Dos compras del último ítem → una se confirma y la otra aparece en Admin → Órdenes con "Revisar".
- [ ] Cambia a llaves `pub_prod`/`prv_prod`/`prod_integrity`/`prod_events` y haz **una compra real pequeña** y reembólsala.

### MercadoPago (opcional)
- [ ] Tus integraciones → Webhooks → evento **Pagos**, URL `https://<api>/api/v1/payments/webhook`; copia la clave secreta a `MP_WEBHOOK_SECRET`.
- [ ] Mismo checklist con usuarios de prueba. Si no lo vas a usar al lanzar, deja `MP_ACCESS_TOKEN` vacío.

### Transferencia manual (Nequi / Bancolombia / Bre-B)
- [ ] Llena las variables `BANK_TRANSFER_*` en Railway y pon `BANK_TRANSFER_ENABLED=true`.
- [ ] Compra de prueba → elige "Transferencia" → sube un pantallazo → llega el correo "comprobante por revisar".
- [ ] Admin → Órdenes → la orden → **Rechazar** con motivo → el cliente recibe el correo y puede subir otro.
- [ ] **Aprobar** → la orden pasa a "Confirmado", baja el stock y llega el email de confirmación.

### Addi (opcional)
- [ ] Con las credenciales de **sandbox** de Addi: compra de prueba → solicitud aprobada → la orden se confirma sola.
- [ ] Solicitud rechazada/abandonada → la orden sigue pendiente y se puede pagar con otro medio.
- [ ] Cambia a `ADDI_ENV=production` con las credenciales productivas.

## 4. Dominio propio (muy recomendado)

Con `*.workers.dev` + `*.railway.app` las cookies de sesión son de terceros y **Safari/iPhone las bloquea**.
Sigue este orden (los ejemplos usan `kaes.co`; el dominio real es `kaes-simplyeternal.co`, con DNS en Cloudflare):

- [ ] Compra el dominio (p. ej. `kaes.co`).
- [ ] Cloudflare → Worker `kaes-frontend` → Settings → Domains & Routes: agrega `kaes.co` y `www.kaes.co` como **Custom Domain** (el middleware redirige `www` → `kaes.co`). Detalle en la sección 11.
- [ ] Railway (servicio del API, proyecto `soothing-comfort`) → Settings → Networking → Custom Domain: `api.kaes.co`. Crea el `CNAME api → <valor que muestra Railway>` y el `TXT` de verificación si lo pide.
- [ ] Espera a que ambos muestren el certificado SSL como activo.
- [ ] Railway: `FRONTEND_URL=https://kaes.co`, `BACKEND_URL=https://api.kaes.co`, `ALLOWED_ORIGINS=https://www.kaes.co`, `COOKIE_DOMAIN=.kaes.co`. Redeploy.
- [ ] Cloudflare: `PUBLIC_API_URL=https://api.kaes.co/api/v1` (build) y `ADMIN_SSR_GUARD=strict` (runtime). Redeploy (las `PUBLIC_*` se fijan en el build).
- [ ] Actualiza las URLs de webhook en Wompi/MercadoPago a `https://api.kaes.co/...`.
- [ ] Verifica en un iPhone (Safari): iniciar sesión, recargar, agregar al carrito y entrar a `/admin`. Deja pasar 15 min y vuelve a `/admin`: el login debe reanudar la sesión solo, sin pedir la contraseña.
- [ ] Cierra sesión y confirma que `/admin` vuelve a pedir login.

## 5. Región y rendimiento

Antes, con Vercel (EE. UU.) → Railway (Miami) → Neon (São Paulo): ≈ 1,7 s de TTFB. El Worker usa *Smart Placement* (`wrangler.jsonc`) para ejecutarse cerca del API, y el catálogo se sirve desde la caché del borde.
- [ ] Pon Neon y Railway en la **misma región** (p. ej. ambos `us-east`). En Neon: crear proyecto en la nueva región y restaurar el backup.
- [ ] Comprueba en Cloudflare → Worker → Metrics → Placement que Smart Placement está activo (necesita algo de tráfico para decidir).
- [ ] Lighthouse móvil en `/`, `/productos`, `/checkout` después del cambio.

## 6. Respaldo y monitoreo

- [ ] Neon: plan con PITR de 7+ días.
- [ ] GitHub → Secrets: `BACKUP_DATABASE_URL` (rol de sólo lectura, URL directa) y `BACKUP_PASSPHRASE`. Ejecuta el workflow **Backup diario** a mano una vez.
- [ ] **Prueba una restauración** en un branch de Neon (instrucciones en `.github/workflows/db-backup.yml`).
- [ ] Sentry: crea el proyecto Node, pon `SENTRY_DSN` en Railway, configura alerta por email/Slack para errores nuevos. Los pagos que requieren revisión generan un evento en Sentry.
- [ ] Monitor de uptime (UptimeRobot / Better Stack, gratis): `https://<api>/api/health` y `https://<front>/` cada 1–5 min, alerta a tu correo/WhatsApp.
- [ ] Railway → Healthcheck path: `/api/health`.

## 7. Legal (Colombia)

- [ ] Completa en `frontend/src/lib/site-config.js`: NIT, dirección, ciudad, departamento, email, teléfono, WhatsApp, redes, fecha de actualización, días de despacho (`processingDays`), días para reportar defectos (`warrantyNoticeDays`) y confirma `exchangeDays` (30). Mientras falten, las páginas legales muestran un aviso amarillo.
- [ ] Revisión de las 3 páginas legales por un abogado (son plantillas).
- [ ] **Contador**: RUT, responsabilidad de IVA, registro mercantil y si debes emitir **factura electrónica** (SAS o persona natural responsable de IVA → desde la primera venta).
- [ ] **IVA:** al crear un producto se escribe el precio **sin IVA**; la tienda suma la tasa (19 %) y muestra el precio final. La tasa se cambia en Admin → IVA (sólo SUPER_ADMIN). Un job diario compara con el Estatuto Tributario y avisa por correo/Sentry si difiere (configura `TAX_ALERT_EMAIL` si quieres otro correo). Confirma la tasa con tu contador antes de aplicar cualquier cambio.

## 8. Después del lanzamiento (primeras semanas)

- Revisa a diario Admin → Órdenes: el banner naranja muestra pagos que requieren acción (reembolsos).
- Los reembolsos se hacen en el panel de Wompi/MercadoPago; luego marca la orden como "Reembolsada" (devuelve el stock).
- Pendientes técnicos conocidos: Sentry en el frontend, códigos DIVIPOLA en las direcciones, quitar columnas antiguas `city`/`department`.

## 9. Despliegue del IVA automático

Orden estricto:

- [ ] 1. Crea un **snapshot/branch de Neon** antes de tocar nada (punto de retorno).
- [ ] 2. **Avisa a los admins** que no editen productos mientras dure el despliegue.
- [ ] 3. Despliega el **backend en Railway**; la migración corre al arrancar.
- [ ] 4. Verifica con SQL (en el branch/consola de Neon):
  - `SELECT count(*) FROM products WHERE ROUND("basePrice"*1.19) <> "price";` debe dar **0**.
  - `SELECT * FROM tax_settings;` debe tener **una fila** con rate 19.
- [ ] 5. Despliega el **frontend en Cloudflare** y pide a los admins que **recarguen las pestañas** del panel (un formulario viejo es rechazado con 400).
- [ ] 6. Prueba manual:
  - Producto de prueba con base 20.000 → precio final 23.800.
  - Editar un producto existente no cambia su precio.
  - `/admin/iva` con SUPER_ADMIN y con ADMIN, y el botón "Revisar ahora".
- [ ] 7. Marca como **exentos** los productos que lo sean (la migración deja todos con IVA 19 %).
- [ ] 8. Configura `TAX_ALERT_EMAIL` en Railway.

Advertencia: cambia la **tasa general** con los admins fuera del panel de productos. Así evitas una carrera de milisegundos que dejaría un producto guardado con la tasa anterior.

## 10. Facturación electrónica DIAN

Ya está desplegada pero **apagada** (`EINVOICE_ENABLED=false`). Para activarla:

1. Haz los trámites: RUT con responsabilidad 52, certificado de firma digital, registro como
   "software propio" en el portal de habilitación y resolución de numeración.
2. Configura las variables `EINVOICE_*` en Railway y `PUBLIC_LEGAL_NIT` (variable de build) en Cloudflare, y vuelve a desplegar el frontend.
3. Corre `pnpm run einvoice:check`, envía el set con `pnpm run einvoice:habilitacion` y luego cambia a
   producción.

La guía completa está en `docs/FACTURACION_ELECTRONICA.md`.

## 11. Migración del frontend de Vercel a Cloudflare Workers

Motivo: el plan Hobby de Vercel no permite uso comercial (cobrar con pasarelas exige Vercel Pro).
El plan gratuito de Cloudflare Workers sí lo permite. **Railway, Neon, Wompi y MercadoPago no cambian**:
el dominio sigue siendo el mismo, así que `FRONTEND_URL`, `COOKIE_DOMAIN`, CORS, la `redirect-url`
de Wompi y los webhooks siguen valiendo.

### A. Preparar (antes del merge)
- [ ] **Vercel → proyecto → Settings → Git → Disconnect** (o *Ignored Build Step* = "Don't build anything").
  Así el merge no dispara un build en Vercel que podría publicar un sitio roto; el despliegue actual sigue en línea.
- [ ] Cloudflare → **Workers & Pages → Create → Import a repository** → elige el repo de GitHub.
  - Project name: `kaes-frontend` (debe coincidir con `name` en `frontend/wrangler.jsonc`).
  - Production branch: `main`. **Root directory: `frontend`**.
  - Build command: `pnpm run build`. Deploy command: `pnpm exec wrangler deploy`.
  - El primer build (sobre el `main` actual, todavía con Vercel) **fallará**: es normal, se corrige con el merge del paso B.
- [ ] Settings → Build → **Variables de build**: `PUBLIC_API_URL=https://api.kaes-simplyeternal.co/api/v1`,
  `SITE_URL=https://kaes-simplyeternal.co`, `NODE_VERSION=22` (+ `PUBLIC_LEGAL_NIT` y los demás `PUBLIC_*` que tengas en Vercel).
- [ ] Settings → **Variables and Secrets** (runtime): `SSR_API_KEY` tipo **Secret** (copia el valor de Railway)
  y `ADMIN_SSR_GUARD=strict`.

### B. Publicar
- [ ] Merge de la rama `migracion-cloudflare` a `main`. Cloudflare despliega en `kaes-frontend.<tu-cuenta>.workers.dev`.
  Como Vercel ya está desconectado de Git, su último despliegue sigue sirviendo el dominio mientras pruebas.
- [ ] Prueba en `*.workers.dev`: inicio, `/productos` y una ficha cargan con productos reales (confirma SSR → API).
  El login **no** funciona ahí (las cookies son de `.kaes-simplyeternal.co`) y la caché del borde tampoco: es lo esperado.

### C. Cambiar el dominio (unos minutos sin servicio)
- [ ] Cloudflare → DNS de `kaes-simplyeternal.co`: **borra** los registros `A` del dominio raíz que apuntan a Vercel
  (`64.29.17.65`, `216.198.79.65`) y el `CNAME www` → `…vercel-dns-017.com`. **No toques el `CNAME api`** (Railway).
- [ ] Worker `kaes-frontend` → Settings → **Domains & Routes → Add → Custom Domain**: `kaes-simplyeternal.co` y
  `www.kaes-simplyeternal.co`. Cloudflare crea los registros y el certificado solo.
- [ ] Verifica:
  - `curl -sI https://kaes-simplyeternal.co` → `server: cloudflare`, `x-frame-options: DENY`, `strict-transport-security`.
  - `curl -s -D - -o /dev/null https://kaes-simplyeternal.co/productos` dos veces → `x-kaes-cache: MISS` y luego `HIT` (no uses `curl -I`: envía HEAD y la caché sólo guarda GET).
  - `curl -sI https://www.kaes-simplyeternal.co/productos` → `301` a `https://kaes-simplyeternal.co/productos`.
  - `curl -sI https://kaes-simplyeternal.co/admin` → `302` al login con `cache-control: no-store`.
- [ ] Flujo completo en iPhone/Safari y escritorio: registro/login, recargar, carrito, cupón, checkout → Wompi sandbox
  → vuelve a `/checkout/wompi-callback` → resultado "Pagado", llega el email y baja el stock. `/admin` con sesión;
  a los 15 min la sesión se renueva sola.

### D. Después
- [ ] Vercel → proyecto → Settings → Domains: quita los dominios (o borra el proyecto cuando todo esté verificado).
- [ ] Primeros días: Worker → **Observability** → busca errores **1102 / "Exceeded CPU"**. El plan gratuito da 10 ms de CPU
  por petición (la caché del catálogo ayuda mucho). Si aparecen, pasa a **Workers Paid (USD 5/mes)**.
- [ ] Límite gratuito: 100.000 peticiones/día al Worker (los archivos estáticos no cuentan).
- Volver atrás (si algo falla antes de borrar Vercel): quita los Custom Domains del Worker, vuelve a crear en DNS los
  registros de Vercel y haz *Redeploy* del último despliegue bueno en Vercel.
