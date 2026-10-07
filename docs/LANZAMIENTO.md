# Runbook de lanzamiento — Kaes Store

Pasos que **no se pueden hacer desde el código** y que hay que completar antes de
vender. Marca cada casilla. Orden recomendado: de arriba hacia abajo.

## 1. Limpiar producción (hoy)

- [ ] Simulación de limpieza contra producción (desde tu máquina, con `DATABASE_URL` de producción **sólo en esa terminal**):
  ```bash
  cd backend
  DATABASE_URL="postgresql://…neon…" DIRECT_URL="postgresql://…neon…" npm run cleanup:test-data
  ```
  Revisa la lista (productos de prueba, admins existentes).
- [ ] Aplicar: repite el comando con `-- --confirm`.
- [ ] Si `admin@ecommerce.com` existía: **rota** `JWT_SECRET` y `JWT_REFRESH_SECRET` en Railway (todas las sesiones se cierran).
- [ ] Crea tu admin real y retira a los anteriores (simulación; agrega `-- --confirm` para aplicar):
  ```bash
  NEW_ADMIN_EMAIL=tu@correo.com NEW_ADMIN_PASSWORD='una-clave-larga-2026' npm run admin:replace
  ```
- [ ] Crea un **branch de Neon** para desarrollo y cambia tu `backend/.env` local a ese branch (hoy apunta a producción).

## 2. Variables de entorno

Lista completa y comentada en `backend/.env.example` y `frontend/.env.example`.

**Railway (backend):** `NODE_ENV=production`, `FRONTEND_URL`, `BACKEND_URL`, `DATABASE_URL`, `DIRECT_URL`,
`JWT_SECRET`, `JWT_REFRESH_SECRET` (≥32 caracteres, distintos), `JWT_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=7d`,
`CLOUDINARY_*`, `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`,
`SSR_API_KEY`, `SENTRY_DSN`, `SMTP_*`, `SHIPPING_FLAT_RATE`, `FREE_SHIPPING_FROM`.
Opcional: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `ALLOWED_ORIGINS`, `COOKIE_DOMAIN`.

**Vercel (frontend):** `PUBLIC_API_URL` (termina en `/api/v1`), `SSR_API_KEY` (mismo valor que en Railway, sin `PUBLIC_`).
Puedes **borrar** `JWT_SECRET` de Vercel: el middleware ya no lo usa.

> Si falta una variable requerida o un secreto JWT es débil, el backend no arranca en producción (a propósito).

## 3. Pasarelas de pago (sandbox primero)

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

## 4. Dominio propio (muy recomendado)

Con `*.vercel.app` + `*.railway.app` las cookies de sesión son de terceros y **Safari/iPhone las bloquea**.
Sigue este orden:

- [ ] Compra el dominio (p. ej. `kaes.co`).
- [ ] Vercel → Settings → Domains: agrega `kaes.co` y `www.kaes.co` (deja `www` redirigiendo a `kaes.co`). Crea en tu proveedor DNS los registros que Vercel indique (normalmente `A @ → 76.76.21.21` y `CNAME www → cname.vercel-dns.com`).
- [ ] Railway (servicio del API, proyecto `soothing-comfort`) → Settings → Networking → Custom Domain: `api.kaes.co`. Crea el `CNAME api → <valor que muestra Railway>` y el `TXT` de verificación si lo pide.
- [ ] Espera a que ambos muestren el certificado SSL como activo.
- [ ] Railway: `FRONTEND_URL=https://kaes.co`, `BACKEND_URL=https://api.kaes.co`, `ALLOWED_ORIGINS=https://www.kaes.co`, `COOKIE_DOMAIN=.kaes.co`. Redeploy.
- [ ] Vercel: `PUBLIC_API_URL=https://api.kaes.co/api/v1`, `ADMIN_SSR_GUARD=strict`. `JWT_SECRET` ya no se usa en Vercel: bórrala. Redeploy (las `PUBLIC_*` se fijan en el build).
- [ ] Actualiza las URLs de webhook en Wompi/MercadoPago a `https://api.kaes.co/...`.
- [ ] Verifica en un iPhone (Safari): iniciar sesión, recargar, agregar al carrito y entrar a `/admin`. Deja pasar 15 min y vuelve a `/admin`: el login debe reanudar la sesión solo, sin pedir la contraseña.
- [ ] Cierra sesión y confirma que `/admin` vuelve a pedir login.

## 5. Región y rendimiento

Hoy: Vercel (EE. UU.) → Railway (Miami) → Neon (São Paulo) ≈ 1,7 s de TTFB.
- [ ] Pon Neon y Railway en la **misma región** (p. ej. ambos `us-east`). En Neon: crear proyecto en la nueva región y restaurar el backup.
- [ ] Vercel → Settings → Functions → región `iad1` (o la más cercana a la API).
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
- [ ] Define si tus precios incluyen IVA (la tienda los muestra como "IVA incluido").

## 8. Después del lanzamiento (primeras semanas)

- Revisa a diario Admin → Órdenes: el banner naranja muestra pagos que requieren acción (reembolsos).
- Los reembolsos se hacen en el panel de Wompi/MercadoPago; luego marca la orden como "Reembolsada" (devuelve el stock).
- Pendientes técnicos conocidos: Sentry en el frontend, códigos DIVIPOLA en las direcciones, quitar columnas antiguas `city`/`department`.
