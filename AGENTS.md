# AGENTS.md

## Project Structure

Package manager: **pnpm** (version pinned in each `package.json` → `packageManager`; run `corepack enable` once). Each package has its own `pnpm-lock.yaml`; there is no workspace.

- `backend/` - Express.js API with Prisma ORM
- `frontend/` - Astro + React frontend

## Developer Commands

### Backend
```bash
cd backend
pnpm run dev          # Start dev server with nodemon
pnpm start           # Production start
pnpm run db:migrate   # Run Prisma migrations
pnpm run db:push     # Push schema to DB
pnpm run db:studio   # Open Prisma Studio
pnpm run db:seed    # Seed (colores/tallas/categorías; admin sólo con SEED_ADMIN_EMAIL/PASSWORD)
pnpm run cleanup:test-data  # Simula la limpieza de datos de prueba (añade --confirm para aplicar)
pnpm test            # Run Vitest suite (unit + integration, Prisma mockeado)
pnpm run test:db     # Tests contra PostgreSQL real (TEST_DATABASE_URL, base desechable)
pnpm run test:watch  # Watch mode
pnpm run test:coverage # With v8 coverage
```

### Frontend
```bash
cd frontend
pnpm run dev         # Dev server at localhost:4321
pnpm run build      # Build for production
pnpm run preview    # Preview build
pnpm test           # Run Vitest suite
pnpm run test:watch # Watch mode
pnpm run test:coverage # With v8 coverage
```

## Important Quirks

- **Backend is JavaScript (not TypeScript)** - uses `.js` files, no compilation step despite tsconfig.json `"module": "commonjs"`
- **Backend is split into `src/app.js` (Express app) and `src/server.js` (listen + SIGTERM)** to allow supertest to import the app without binding a port
- **Rate limiting is disabled when `NODE_ENV=test`** (both global limiter and per-route auth limiters) so suites don't self-block
- **Database .env file** at `backend/.env` - contains required secrets (already exists). Never point it at the production DB.
- **Payments**: Wompi (Web Checkout + signed events) and MercadoPago (optional). All payment updates go through `services/payment.service.js#processPaymentUpdate` (idempotent via `payment_events.eventKey`, locks the order row, deducts stock atomically). Stock is only deducted when a payment is approved.
- **Prices/totals** are always computed server-side in `services/pricing.service.js` (`POST /orders/quote` and order creation share it).
- **CI**: `.github/workflows/ci.yml` (tests, DB tests on Postgres, migration drift, build, audit). Nightly encrypted DB backup in `db-backup.yml`.
- **File uploads**: multer + Cloudinary for image handling
- **Frontend Node.js requirement**: `node >= 22.12.0` in engines
- **Tests use Vitest** in both packages; backend uses supertest + mocked Prisma, frontend uses jsdom
- **No lint/typecheck** - no ESLint, Prettier, or TypeScript checking configured

## Deployment

### Frontend (Cloudflare Workers)
1. Push your code to GitHub
2. Cloudflare dashboard → Workers & Pages → Create → Import a repository (Workers Builds)
3. Root directory: `frontend`; build command: `pnpm run build`; deploy command: `pnpm exec wrangler deploy` (config in `frontend/wrangler.jsonc`)
4. **Build** variables: `PUBLIC_API_URL=https://your-backend-url.com/api/v1`, `SITE_URL`, `NODE_VERSION=22` (and `PUBLIC_LEGAL_NIT` etc. — every `PUBLIC_*` is fixed at build time)
5. **Runtime** variables: secret `SSR_API_KEY` (same value as backend) and `ADMIN_SSR_GUARD=strict` (Worker → Settings → Variables and Secrets)
6. Every push to `main` deploys. Local check of the real runtime: `pnpm run build && pnpm exec wrangler dev`

### Backend (Railway/Render)
1. Push your code to GitHub
2. Create a new project on Railway or Render
3. Connect your GitHub repository, select the "backend" folder (Railway builds `backend/Dockerfile`, which installs pnpm via corepack; start command `pnpm run start:prod`)
4. Add all environment variables from `backend/.env`:
   - `PORT` (Railway will set this automatically)
   - `NODE_ENV=production`
   - `DATABASE_URL` (Neon URL)
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   - `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`
   - `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (optional)
   - `SSR_API_KEY`, `SENTRY_DSN` — see `backend/.env.example` for the full list
   - `FRONTEND_URL` (your frontend URL)
   - `BACKEND_URL` (your Railway/Render URL)
5. Migrations run automatically on boot (`pnpm run start:prod` → `prisma migrate deploy`)
6. Deploy

### Important
- After deploying backend, update `FRONTEND_URL` in backend env to your frontend URL
- After deploying backend, update `PUBLIC_API_URL` (build variable) in Cloudflare to your backend URL and redeploy
- Full pre-launch runbook (Spanish): `docs/LANZAMIENTO.md`
