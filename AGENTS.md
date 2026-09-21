# AGENTS.md

## Project Structure

- `backend/` - Express.js API with Prisma ORM
- `frontend/` - Astro + React frontend

## Developer Commands

### Backend
```bash
cd backend
npm run dev          # Start dev server with nodemon
npm start           # Production start
npm run db:migrate   # Run Prisma migrations
npm run db:push     # Push schema to DB
npm run db:studio   # Open Prisma Studio
npm run db:seed    # Seed (colores/tallas/categorías; admin sólo con SEED_ADMIN_EMAIL/PASSWORD)
npm run cleanup:test-data  # Simula la limpieza de datos de prueba (añade -- --confirm para aplicar)
npm test            # Run Vitest suite (unit + integration, Prisma mockeado)
npm run test:db     # Tests contra PostgreSQL real (TEST_DATABASE_URL, base desechable)
npm run test:watch  # Watch mode
npm run test:coverage # With v8 coverage
```

### Frontend
```bash
cd frontend
npm run dev         # Dev server at localhost:4321
npm run build      # Build for production
npm run preview    # Preview build
npm test           # Run Vitest suite
npm run test:watch # Watch mode
npm run test:coverage # With v8 coverage
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

### Frontend (Vercel)
1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Select "frontend" as the directory
4. Build command: `npm run build`
5. Output directory: `dist`
6. Add environment variables: `PUBLIC_API_URL=https://your-backend-url.com/api/v1` and `SSR_API_KEY` (server-only, same value as backend)
7. Deploy

### Backend (Railway/Render)
1. Push your code to GitHub
2. Create a new project on Railway or Render
3. Connect your GitHub repository, select the "backend" folder
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
   - `FRONTEND_URL` (your Vercel URL)
   - `BACKEND_URL` (your Railway/Render URL)
5. Migrations run automatically on boot (`npm run start:prod` → `prisma migrate deploy`)
6. Deploy

### Important
- After deploying backend, update `FRONTEND_URL` in backend env to your Vercel URL
- After deploying backend, update `PUBLIC_API_URL` in Vercel to your backend URL
- Full pre-launch runbook (Spanish): `docs/LANZAMIENTO.md`
