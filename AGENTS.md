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
npm run db:seed    # Seed database
npm test            # Run Vitest suite (unit + integration)
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
- **Database .env file** at `backend/.env` - contains required secrets (already exists)
- **Two payment providers**: Stripe and MercadoPago configured
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
6. Add environment variable: `PUBLIC_API_URL=https://your-backend-url.com` (Astro uses `PUBLIC_*` prefix for client-exposed env vars, not `VITE_*`)
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
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PUBLIC_KEY`
   - `FRONTEND_URL` (your Vercel URL)
   - `BACKEND_URL` (your Railway/Render URL)
5. Run Prisma migration: Add a "migrate" command in the deployment settings or manually run `npx prisma migrate deploy`
6. Deploy

### Important
- After deploying backend, update `FRONTEND_URL` in backend env to your Vercel URL
- After deploying backend, update `PUBLIC_API_URL` in Vercel to your backend URL