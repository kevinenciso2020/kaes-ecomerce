# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Clothing e-commerce store (Colombia) — monorepo with two independent npm packages, no root `package.json`:

- `backend/` — Express 4 API + Prisma 5 (PostgreSQL/Neon), plain JavaScript ESM (`"type": "module"`), deployed to Railway via the root `Dockerfile`.
- `frontend/` — Astro 7 (`output: 'server'`, Vercel adapter) with React islands and nanostores.

Code comments, log context, API error messages and UI copy are in **Spanish**; keep new ones in Spanish. `AGENTS.md` has deployment steps and `docs/LANZAMIENTO.md` is the pre-launch runbook.

## Commands

Run each from its package directory (`cd backend` / `cd frontend`).

```bash
# backend
npm run dev                  # nodemon src/server.js
npm test                     # Vitest unit + integration (Prisma mocked, no DB needed)
npx vitest run tests/unit/stock.service.test.js     # single file
npx vitest run -t "nombre del test"                 # single test by name
TEST_DATABASE_URL=postgresql://... npm run test:db  # real-Postgres tests (tests/db/**); DB is wiped before each test
npm run db:migrate           # prisma migrate dev (create a migration after editing schema.prisma)
npm run db:seed              # colors/sizes/categories; admin only if SEED_ADMIN_EMAIL/PASSWORD are set
npm run cleanup:test-data    # dry run; add `-- --confirm` to apply

# frontend
npm run dev                  # localhost:4321
npm test                     # Vitest + jsdom
npm run build                # needs PUBLIC_API_URL set
```

There is no lint, formatter or typecheck step. CI (`.github/workflows/ci.yml`) runs: `prisma validate`, `npm test`, `npm run test:db` against Postgres 16, a **migration drift check** (`prisma migrate diff ... --exit-code` — every `schema.prisma` change needs a matching migration), frontend build, and `npm audit --audit-level=high --omit=dev`.

## Backend architecture

- `src/app.js` builds the Express app (importable by supertest); `src/server.js` does `validateEnv()`, `listen`, graceful shutdown and starts `jobs/maintenance.js` (every 10 min: expire stale unpaid orders, purge expired tokens; disable with `DISABLE_JOBS=true`). `src/instrument.js` initializes Sentry and must stay the first import in `server.js`.
- Layering per domain: `routes/*.routes.js` → `validators/*.validator.js` (express-validator, wrapped by `middleware/validate.js`, returns `400 { errors: [{field, message}] }`) → `controllers/*.controller.js` (thin, `try/catch → next(err)`) → `services/*.service.js` (all Prisma/business logic). Errors reach `middleware/error.middleware.js`, which also maps multer errors and reports to Sentry. All routes are under `/api/v1`; health check is `/api/health`.
- **Middleware order matters** in `app.js`: request context/pino logging → helmet → CORS → CSRF → global rate limit → cookie parser → raw body for the two payment webhook paths → JSON parser → routes. Webhook routes must receive a raw `Buffer` for signature verification.
- **Auth**: JWT access + refresh tokens in httpOnly cookies (a `Bearer` header also works). Refresh tokens are stored/rotated in DB. Cookie `sameSite` is `lax` when `COOKIE_DOMAIN` is set or in dev, `none` in cross-site production (Vercel ↔ Railway). Because of `sameSite=none`, `csrf.middleware.js` requires an allowed `Origin`/`Referer` on every POST/PUT/PATCH/DELETE except payment webhooks. Allowed origins = `FRONTEND_URL` + `ALLOWED_ORIGINS` (+ localhost outside production) — shared by CORS and CSRF.
- **Authorization**: roles `CUSTOMER`, `ADMIN`, `SUPER_ADMIN`. `isAuth`/`isAdmin` in `auth.middleware.js`; permission-based `authorize(PERMISSIONS.X)` / `authorizeRole` in `authorization.middleware.js` (user/admin management is SUPER_ADMIN-only). Some routes also require `requireVerifiedEmail`.
- **SSR trust**: the Astro server sends `x-ssr-key: SSR_API_KEY`; `isTrustedSsrRequest` exempts those requests from the per-IP rate limit (all Vercel traffic shares few IPs).
- **Money flow**:
  - Prices, discounts, coupons and shipping are always computed server-side in `services/pricing.service.js#buildQuote` (used by both `POST /orders/quote` and order creation). Never trust client totals. `Product.price` is the final price **with IVA**, derived as `finalPrice(basePrice, taxRate)` (`services/tax.service.js`); admins enter `basePrice`, and the global rate lives in `tax_settings` (`services/tax-settings.service.js`).
  - Payments: Wompi (primary, Web Checkout + signed events) and MercadoPago (optional). Every payment status change — webhook or redirect verification — goes through `services/payment.service.js#processPaymentUpdate`, which is idempotent via `PaymentEvent.eventKey`, locks the order row, and deducts stock atomically.
  - Stock is only deducted when a payment is approved (`stock.service.js#tryDeductStockForItems`, variant-level or product-level) and restored on cancellation/refund. Order status changes are logged in `OrderStatusLog`.
- `config/prisma.js` appends pool/timeout params to `DATABASE_URL`; use the exported singleton `prisma`, and pass a `tx`/`db` argument into services that must run inside `prisma.$transaction`.
- Logging: pino via `req.log` (falls back to `config/logger.js`); log with an object + dotted event name, e.g. `req.log.warn({ reqId: req.id }, 'auth.token_missing')`.

## Backend tests

- `tests/setup.js` sets `NODE_ENV=test` and dummy secrets. In test mode, rate limiting **and CSRF** are disabled.
- Integration tests mock Prisma per file with `vi.mock('../../src/config/prisma.js', () => ({ prisma: { model: { method: vi.fn() } } }))`, mock uploads with `tests/mocks/upload.mock.js`, sign JWTs directly with `process.env.JWT_SECRET`, and hit `app` via supertest.
- `tests/db/**/*.db.test.js` run only under `vitest.db.config.js` (serial, real Postgres) and cover concurrency, webhook idempotency, coupons and state transitions — add tests there for anything involving locking or stock.

## Frontend architecture

- SSR on Vercel. File-based routes in `src/pages/` (Spanish paths: `/productos`, `/carrito`, `/checkout`, `/perfil`, `/admin/*`). Layouts: `BaseLayout.astro`, `ShopLayout.astro`. Interactive parts are React components hydrated with `client:*` directives; admin panel components live in `src/components/admin/`.
- `src/lib/api.js` is the single API client: `credentials: 'include'`, automatic token refresh on 401 with a subscriber queue, network retry, `ApiError`, and `x-ssr-key` added only when running on the server. Add new endpoints there rather than calling `fetch` directly.
- State in `src/stores/*.store.js` (nanostores): `auth.store` (current user), `cart.store` (localStorage for guests, synced to the API when logged in), `coupon.store`.
- `src/middleware.js` guards `/admin` by forwarding the `accessToken` cookie to `GET /auth/me` (Vercel never holds `JWT_SECRET`). The cookie is only visible when front and API share a domain; unless `ADMIN_SSR_GUARD=strict`, missing cookies fall through and the page checks the role client-side. Real authorization is always the backend; admin pages fetch their data from the browser.
- Env: `PUBLIC_API_URL` (required, e.g. `https://api.kaes.co/api/v1`) and `SSR_API_KEY` (server-only, same value as backend). Frontend requires Node >= 22.12.
