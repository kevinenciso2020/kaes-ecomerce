# IVA automático en precios de producto — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos usan casillas `- [ ]`.

**Goal:** El admin escribe el precio sin IVA; la tienda guarda y muestra el precio final con IVA. La tasa vive en un solo lugar (SUPER_ADMIN la cambia) y un job diario avisa si la fuente oficial indica otra tasa, sin aplicarla solo.

**Architecture:** `Product.price` sigue siendo el precio final (carrito, cupones, pedidos y pagos no cambian). Se agregan `basePrice` y `taxRate` al producto, `basePrice` a la variante y una tabla `tax_settings` de una fila. Un servicio puro (`tax.service.js`) calcula el precio final; el admin crea/edita con `basePrice`; un cambio de tasa recalcula todo en una transacción con SQL; un job diario (`tax-check.service.js`) compara con la fuente oficial y sólo guarda `pendingRate` + avisa.

**Tech Stack:** Node ESM, Express 4, Prisma 5 (PostgreSQL), Vitest + supertest, Astro 7 + React, express-validator.

**Spec:** `docs/superpowers/specs/2026-10-09-iva-automatico-design.md`

## Global Constraints

- Backend y frontend son paquetes npm independientes: correr cada comando desde `backend/` o `frontend/`.
- Comentarios, logs, mensajes de error de la API y textos de UI en **español**.
- Todo cambio en `schema.prisma` lleva su migración (CI hace `prisma migrate diff --exit-code`).
- Capas backend: `routes → validators → controllers (try/catch → next(err)) → services`. Logs con objeto + evento con puntos: `log.info({ ... }, 'tax.rate_changed')`.
- Errores de servicio: `Object.assign(new Error(msg), { status })` (patrón local `httpError`).
- Tasa general por defecto **19**. Precio final siempre **entero en pesos**. Tasa válida: 0–30.
- El job **nunca** modifica precios; sólo guarda `pendingRate` y avisa. Aplicar es acción manual del SUPER_ADMIN.
- `OrderItem.price` nunca se toca (histórico).
- Pruebas backend: Prisma mockeado por archivo (`vi.mock('../../src/config/prisma.js', ...)`); `tests/db/**` sólo con `TEST_DATABASE_URL` local (se limpia entre tests).
- Commits al final de cada tarea, con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Redondeo: $20.000 × 19 % = $23.800 exacto; $59.900 → $71.281; tasa 0 → mismo valor; nunca decimales en `price`.
- Producto exento (`taxRate` 0) no cambia cuando cambia la tasa general; sí cambian los demás y sus variantes con precio propio.
- ADMIN (no SUPER_ADMIN) recibe 403 en PUT/apply-pending/check, y en GET sólo ve `{ rate }`.
- Fuente oficial caída, con HTML distinto o con valor absurdo (p. ej. 190 %): no cambia nada y no lanza excepción (el job de mantenimiento no debe caerse).
- La alerta de cambio no se repite cada día para el mismo `pendingRate` detectado.
- Pedidos ya creados conservan `OrderItem.price` tras un cambio de tasa.
- La migración conserva `price` de todos los productos existentes (el cliente no ve cambio de precio el día del despliegue).

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/src/services/tax.service.js` | Crear | Funciones puras: `finalPrice`, `basePriceFromFinal`, `isValidRate`, `GENERAL_RATE` |
| `backend/prisma/schema.prisma` | Modificar | `basePrice`/`taxRate` en Product, `basePrice` en ProductVariant, modelo `TaxSetting` |
| `backend/prisma/migrations/20261009120000_iva_base_price/migration.sql` | Crear | Columnas + backfill + fila inicial de `tax_settings` |
| `backend/src/services/tax-settings.service.js` | Crear | `getTaxSetting`, `getCurrentRate`, `setRate`, `applyPendingRate` |
| `backend/src/services/tax-check.service.js` | Crear | `parseGeneralRate`, `checkTaxRate` |
| `backend/src/controllers/tax.controller.js` | Crear | Handlers `/admin/tax*` |
| `backend/src/validators/tax.validator.js` | Crear | Validación de `rate` |
| `backend/src/routes/admin.routes.js` | Modificar | Rutas `/tax` |
| `backend/src/services/admin-products.service.js` | Modificar | Crear/editar con `basePrice` y `taxRate` |
| `backend/src/validators/admin-products.validator.js` | Modificar | `basePrice` en vez de `price`; `taxRate` opcional |
| `backend/src/config/sentry.js` | Modificar | `captureMessage` |
| `backend/src/services/email.service.js` | Modificar | `sendTaxChangeAlert` |
| `backend/src/jobs/maintenance.js` | Modificar | Llamar `checkTaxRate` |
| `backend/prisma/seed.js`, `backend/tests/db/payments.db.test.js` | Modificar | Crear productos con `basePrice` |
| `backend/.env.example` | Modificar | `TAX_SOURCE_URL`, `TAX_ALERT_EMAIL` |
| `frontend/src/lib/tax.js` | Crear | `finalPrice` (misma fórmula que el backend) |
| `frontend/src/lib/api.js` | Modificar | Endpoints `admin.tax*` |
| `frontend/src/components/admin/ProductFormModal.jsx` | Modificar | "Precio sin IVA" + vista previa + exento |
| `frontend/src/components/admin/VariantEditor.jsx` | Modificar | Precio de variante sin IVA |
| `frontend/src/components/admin/TaxSettings.jsx`, `frontend/src/pages/admin/iva.astro` | Crear | Pantalla de IVA (SUPER_ADMIN) |
| `frontend/src/components/admin/DashboardOverview.jsx` | Modificar | Tarjeta "IVA" sólo para SUPER_ADMIN |

---

### Task 1: Cálculo de IVA (funciones puras)

**Files:**
- Create: `backend/src/services/tax.service.js`
- Test: `backend/tests/unit/tax.service.test.js`

**Interfaces:**
- Produces: `GENERAL_RATE = 19`; `isValidRate(rate): boolean` (número finito 0–30); `finalPrice(base: number, rate: number): number` (entero en pesos); `basePriceFromFinal(final: number, rate: number): number` (2 decimales).

- [ ] **Step 1: Escribir las pruebas que fallan**

`backend/tests/unit/tax.service.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { GENERAL_RATE, isValidRate, finalPrice, basePriceFromFinal } from '../../src/services/tax.service.js'

describe('finalPrice', () => {
  it('suma 19 % y redondea a peso entero', () => {
    expect(finalPrice(20000, 19)).toBe(23800)
    expect(finalPrice(59900, 19)).toBe(71281)
  })
  it('tasa 0 devuelve el mismo valor (exento)', () => {
    expect(finalPrice(45000, 0)).toBe(45000)
  })
  it('redondea medios hacia arriba', () => {
    expect(finalPrice(1010, 5)).toBe(1061)   // 1060.5 → 1061
  })
  it('nunca devuelve decimales', () => {
    expect(Number.isInteger(finalPrice(33333.33, 19))).toBe(true)
  })
})

describe('basePriceFromFinal', () => {
  it('invierte el cálculo con 2 decimales', () => {
    expect(basePriceFromFinal(23800, 19)).toBe(20000)
    expect(basePriceFromFinal(49900, 19)).toBe(41932.77)
  })
  it('round-trip: el precio final no cambia', () => {
    for (const final of [9900, 49900, 59900, 129900]) {
      expect(finalPrice(basePriceFromFinal(final, 19), 19)).toBe(final)
    }
  })
})

describe('isValidRate', () => {
  it.each([[0, true], [19, true], [30, true], [-1, false], [31, false], [NaN, false], ['x', false], [null, false]])(
    '%s → %s', (v, ok) => expect(isValidRate(v)).toBe(ok))
  it('la tasa general es 19', () => expect(GENERAL_RATE).toBe(19))
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && npx vitest run tests/unit/tax.service.test.js`
Expected: FAIL (`Cannot find module .../tax.service.js`).

- [ ] **Step 3: Implementar**

`backend/src/services/tax.service.js`:

```js
// Cálculo de IVA. Funciones puras: sin Prisma ni red.
// Aritmética en puntos básicos (tasa × 100) para evitar errores de coma flotante.

export const GENERAL_RATE = 19
export const MAX_RATE = 30

export const isValidRate = (rate) =>
  typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= MAX_RATE

const basisPoints = (rate) => Math.round(rate * 100)

/** Precio final con IVA, en pesos enteros. */
export const finalPrice = (base, rate) =>
  Math.round((Number(base) * (10000 + basisPoints(rate))) / 10000)

/** Precio base (sin IVA) a partir de un precio final. Dos decimales. */
export const basePriceFromFinal = (final, rate) =>
  Math.round((Number(final) * 10000 * 100) / (10000 + basisPoints(rate))) / 100
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd backend && npx vitest run tests/unit/tax.service.test.js`
Expected: PASS. (Si `1010 × 5 %` falla por coma flotante, es un bug de la implementación: corregirla, no la prueba.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tax.service.js backend/tests/unit/tax.service.test.js
git commit -m "feat(backend): cálculo puro de IVA (precio final y base)"
```

---

### Task 2: Esquema y migración

**Files:**
- Modify: `backend/prisma/schema.prisma` (modelos `Product` ~línea 102, `ProductVariant` ~línea 143; añadir `TaxSetting`)
- Create: `backend/prisma/migrations/20261009120000_iva_base_price/migration.sql`
- Modify: `backend/prisma/seed.js:118`, `backend/tests/db/payments.db.test.js:45`

**Interfaces:**
- Produces: columnas `products.basePrice` (NOT NULL), `products.taxRate` (default 19), `product_variants.basePrice` (nullable), tabla `tax_settings` (fila `id=1`, `rate=19`).

- [ ] **Step 1: Editar `schema.prisma`**

En `model Product`, justo después de `price Decimal @db.Decimal(10, 2)` añadir:

```prisma
  basePrice         Decimal  @db.Decimal(10, 2) // precio SIN IVA (lo que escribe el admin)
  taxRate           Decimal  @default(19) @db.Decimal(5, 2) // % de IVA con el que se calculó price
```

En `model ProductVariant`, después de `price Decimal? @db.Decimal(10, 2)` añadir:

```prisma
  basePrice         Decimal? @db.Decimal(10, 2) // sin IVA; null = usa el del producto
```

Al final del archivo añadir:

```prisma
/// Configuración global del IVA. Una sola fila (id = 1).
model TaxSetting {
  id              Int       @id @default(1)
  rate            Decimal   @default(19) @db.Decimal(5, 2)
  updatedAt       DateTime  @updatedAt
  updatedById     String?
  lastCheckAt     DateTime?
  lastCheckRate   Decimal?  @db.Decimal(5, 2)
  lastCheckSource String?
  pendingRate     Decimal?  @db.Decimal(5, 2)

  @@map("tax_settings")
}
```

- [ ] **Step 2: Escribir la migración a mano**

`backend/prisma/migrations/20261009120000_iva_base_price/migration.sql`:

```sql
-- AlterTable: precio base (sin IVA) y tasa por producto
ALTER TABLE "products" ADD COLUMN "basePrice" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19;
ALTER TABLE "product_variants" ADD COLUMN "basePrice" DECIMAL(10,2);

-- Backfill: el precio final actual se conserva; la base se calcula hacia atrás (final / 1.19)
UPDATE "products" SET "basePrice" = ROUND("price" * 100 / 119, 2);
UPDATE "product_variants" SET "basePrice" = ROUND("price" * 100 / 119, 2) WHERE "price" IS NOT NULL;

-- basePrice del producto es obligatorio y sin default (el backend siempre lo envía)
ALTER TABLE "products" ALTER COLUMN "basePrice" DROP DEFAULT;

-- CreateTable
CREATE TABLE "tax_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckRate" DECIMAL(5,2),
    "lastCheckSource" TEXT,
    "pendingRate" DECIMAL(5,2),

    CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "tax_settings" ("id", "rate", "updatedAt") VALUES (1, 19, NOW());
```

- [ ] **Step 3: Comprobar que no hay drift**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: `The schema ... is valid`.

Con una base local desechable (la misma de `test:db`):

```bash
cd backend
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ecommerce_test
DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL npx prisma migrate deploy
DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL npx prisma migrate diff \
  --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```
Expected: la última orden termina con código 0 ("No difference detected"). Si hay diferencias, ajustar `schema.prisma` o el SQL hasta que coincidan.

- [ ] **Step 4: Verificar el backfill con datos reales de la forma antigua**

```bash
psql "$TEST_DATABASE_URL" -c "SELECT price, \"basePrice\", ROUND(\"basePrice\" * 1.19) AS vuelve FROM products LIMIT 5;"
```
Expected: `vuelve` == `price` en cada fila (si la base de pruebas está vacía, insertar antes un producto con `price = 49900` y comprobar que `basePrice = 41932.77` y `vuelve = 49900`).

- [ ] **Step 5: Adaptar creadores de productos que ya existen**

`backend/tests/db/payments.db.test.js` (`makeProduct`): en el `data` añadir `basePrice: Math.round(price / 1.19)` junto a `price`.

```js
      name: `Producto ${++seq}`, slug: `producto-${seq}`, description: '', price, basePrice: Math.round(price / 1.19), stock, categoryId: category.id,
```

`backend/prisma/seed.js:118`: junto a `price:       49900,` añadir `basePrice:   41933,`.

- [ ] **Step 6: Correr las pruebas**

Run: `cd backend && npm test && TEST_DATABASE_URL=$TEST_DATABASE_URL npm run test:db`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/tests/db/payments.db.test.js
git commit -m "feat(db): precio base, tasa de IVA por producto y tabla tax_settings"
```

---

### Task 3: Servicio de configuración de IVA (tasa vigente y recálculo)

**Files:**
- Create: `backend/src/services/tax-settings.service.js`
- Test: `backend/tests/db/tax.db.test.js`

**Interfaces:**
- Consumes: `finalPrice`, `isValidRate`, `GENERAL_RATE` (Task 1); tabla `tax_settings` (Task 2).
- Produces:
  - `getCurrentRate(db = prisma): Promise<number>` — tasa vigente (19 si no hay fila).
  - `getTaxSetting(db = prisma): Promise<{ rate, pendingRate, lastCheckAt, lastCheckRate, lastCheckSource, updatedAt }>` — números planos (`null` si vacío).
  - `setRate(rate: number, userId: string | null): Promise<{ rate, changed, productsUpdated }>` — transacción: recalcula variantes y productos con `taxRate` igual a la tasa anterior, guarda la fila y limpia `pendingRate`.
  - `applyPendingRate(userId): Promise<{ rate, changed, productsUpdated }>` — error 409 si no hay `pendingRate`.

- [ ] **Step 1: Escribir la prueba contra Postgres real**

`backend/tests/db/tax.db.test.js`:

```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'

const { prisma } = await import('../../src/config/prisma.js')
const { setRate, applyPendingRate, getCurrentRate, getTaxSetting } = await import('../../src/services/tax-settings.service.js')

const TABLES = [
  'payment_events', 'payments', 'order_status_logs', 'order_items', 'orders', 'cart_items',
  'product_discounts', 'product_variants', 'product_images', 'product_available_sizes', 'products', 'categories', 'users',
]

let seq = 0
const makeProduct = async ({ basePrice, taxRate = 19, variants } = {}) => {
  const category = await prisma.category.upsert({
    where: { slug: 'camisetas' }, update: {}, create: { name: 'Camisetas', slug: 'camisetas' },
  })
  const price = Math.round(basePrice * (1 + taxRate / 100))
  return prisma.product.create({
    data: {
      name: `P${++seq}`, slug: `p-${seq}`, description: '', stock: 5, categoryId: category.id,
      basePrice, taxRate, price, variants: variants ? { create: variants } : undefined,
    },
    include: { variants: true },
  })
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`)
  await prisma.taxSetting.upsert({
    where: { id: 1 }, update: { rate: 19, pendingRate: null }, create: { id: 1, rate: 19 },
  })
})

afterAll(async () => { await prisma.$disconnect() })

describe('setRate', () => {
  it('recalcula productos y variantes con la tasa general; el exento no cambia', async () => {
    const normal = await makeProduct({
      basePrice: 20000,
      variants: [{ size: 'M', color: 'Azul', stock: 2, basePrice: 30000, price: 35700 }, { size: 'L', color: 'Azul', stock: 2 }],
    })
    const exento = await makeProduct({ basePrice: 10000, taxRate: 0 })

    const res = await setRate(5, 'u1')
    expect(res).toMatchObject({ rate: 5, changed: true })

    const p = await prisma.product.findUnique({ where: { id: normal.id }, include: { variants: true } })
    expect(Number(p.taxRate)).toBe(5)
    expect(Number(p.price)).toBe(21000)
    expect(Number(p.variants.find((v) => v.size === 'M').price)).toBe(31500)
    expect(p.variants.find((v) => v.size === 'L').price).toBeNull()

    const e = await prisma.product.findUnique({ where: { id: exento.id } })
    expect(Number(e.taxRate)).toBe(0)
    expect(Number(e.price)).toBe(10000)
    expect(await getCurrentRate()).toBe(5)
  })

  it('no altera el precio de pedidos ya creados', async () => {
    const product = await makeProduct({ basePrice: 20000 })
    const user = await prisma.user.create({ data: { email: 'a@a.co', password: 'x', name: 'A', emailVerified: true } })
    const order = await prisma.order.create({
      data: {
        userId: user.id, total: 23800, subtotal: 23800,
        items: { create: [{ productId: product.id, quantity: 1, price: 23800 }] },
      },
      include: { items: true },
    })
    await setRate(5, 'u1')
    const item = await prisma.orderItem.findUnique({ where: { id: order.items[0].id } })
    expect(Number(item.price)).toBe(23800)
  })

  it('misma tasa → changed:false y no toca nada', async () => {
    const p = await makeProduct({ basePrice: 20000 })
    const res = await setRate(19, 'u1')
    expect(res.changed).toBe(false)
    expect(Number((await prisma.product.findUnique({ where: { id: p.id } })).price)).toBe(23800)
  })

  it('rechaza tasas inválidas', async () => {
    await expect(setRate(45, 'u1')).rejects.toMatchObject({ status: 400 })
    await expect(setRate(-1, 'u1')).rejects.toMatchObject({ status: 400 })
  })
})

describe('applyPendingRate', () => {
  it('aplica la tasa detectada y limpia pendingRate', async () => {
    await makeProduct({ basePrice: 20000 })
    await prisma.taxSetting.update({ where: { id: 1 }, data: { pendingRate: 21 } })
    const res = await applyPendingRate('u1')
    expect(res.rate).toBe(21)
    const s = await getTaxSetting()
    expect(s.rate).toBe(21)
    expect(s.pendingRate).toBeNull()
  })

  it('409 si no hay tasa pendiente', async () => {
    await expect(applyPendingRate('u1')).rejects.toMatchObject({ status: 409 })
  })
})
```

> Nota: si `prisma.order.create` exige otros campos obligatorios, copiar los mínimos de `makeOrder`/`createOrder` en `tests/db/payments.db.test.js` (se vio que el modelo `Order` exige al menos `userId` y totales); ajustar sólo el `data` de esa prueba.

- [ ] **Step 2: Verificar que falla**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL npx vitest run -c vitest.db.config.js tests/db/tax.db.test.js`
Expected: FAIL (`Cannot find module .../tax-settings.service.js`).

- [ ] **Step 3: Implementar**

`backend/src/services/tax-settings.service.js`:

```js
import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'
import { GENERAL_RATE, isValidRate } from './tax.service.js'

const log = logger.child({ component: 'tax-settings' })

const httpError = (status, message) => Object.assign(new Error(message), { status })
const num = (v) => (v === null || v === undefined ? null : Number(v))

/** Tasa de IVA vigente (19 si todavía no existe la fila). */
export const getCurrentRate = async (db = prisma) => {
  const row = await db.taxSetting.findUnique({ where: { id: 1 } })
  return row ? Number(row.rate) : GENERAL_RATE
}

export const getTaxSetting = async (db = prisma) => {
  const row = await db.taxSetting.findUnique({ where: { id: 1 } })
  return {
    rate: row ? Number(row.rate) : GENERAL_RATE,
    pendingRate: num(row?.pendingRate),
    lastCheckAt: row?.lastCheckAt ?? null,
    lastCheckRate: num(row?.lastCheckRate),
    lastCheckSource: row?.lastCheckSource ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

/**
 * Cambia la tasa general y recalcula `price` de los productos (y de sus variantes
 * con precio propio) que seguían la tasa anterior. Los productos con otra tasa
 * (p. ej. exentos, 0 %) no se tocan. Todo en una transacción.
 */
export const setRate = async (rate, userId) => {
  if (!isValidRate(rate)) throw httpError(400, 'La tasa de IVA debe estar entre 0 y 30')

  return prisma.$transaction(async (tx) => {
    const oldRate = await getCurrentRate(tx)
    if (oldRate === rate) return { rate, changed: false, productsUpdated: 0 }

    const bp = Math.round(rate * 100)

    // Variantes primero: dependen de la tasa ANTERIOR del producto.
    await tx.$executeRaw`
      UPDATE "product_variants" v
      SET "price" = ROUND(v."basePrice" * (10000 + ${bp}::int) / 10000)
      FROM "products" p
      WHERE v."productId" = p."id" AND v."basePrice" IS NOT NULL AND p."taxRate" = ${oldRate}::numeric`

    const productsUpdated = await tx.$executeRaw`
      UPDATE "products"
      SET "taxRate" = ${rate}::numeric, "price" = ROUND("basePrice" * (10000 + ${bp}::int) / 10000)
      WHERE "taxRate" = ${oldRate}::numeric`

    await tx.taxSetting.upsert({
      where: { id: 1 },
      update: { rate, updatedById: userId ?? null, pendingRate: null },
      create: { id: 1, rate, updatedById: userId ?? null },
    })

    log.info({ userId, oldRate, newRate: rate, productsUpdated }, 'tax.rate_changed')
    return { rate, changed: true, productsUpdated: Number(productsUpdated) }
  })
}

/** Aplica la tasa detectada por el job de revisión (acción manual del SUPER_ADMIN). */
export const applyPendingRate = async (userId) => {
  const { pendingRate } = await getTaxSetting()
  if (pendingRate === null) throw httpError(409, 'No hay una tasa pendiente por aplicar')
  return setRate(pendingRate, userId)
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL npx vitest run -c vitest.db.config.js tests/db/tax.db.test.js`
Expected: PASS (6 pruebas).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tax-settings.service.js backend/tests/db/tax.db.test.js
git commit -m "feat(backend): tasa de IVA configurable con recálculo transaccional"
```

---

### Task 4: Crear y editar productos con precio base

**Files:**
- Modify: `backend/src/services/admin-products.service.js` (`normalizeVariant` ~línea 148, `createProduct` ~195, `updateProduct` ~255, `upsertVariants` ~467)
- Modify: `backend/src/validators/admin-products.validator.js` (líneas ~59 y ~115)
- Test: `backend/tests/integration/admin-products.routes.test.js`

**Interfaces:**
- Consumes: `finalPrice` (Task 1), `getCurrentRate` (Task 3).
- Produces: `POST/PUT /admin/products` aceptan `basePrice` (obligatorio al crear) y `taxRate` opcional (0–30); guardan `price = finalPrice(basePrice, taxRate)`. Variantes aceptan `basePrice` (la clave `price` de entrada se ignora).

- [ ] **Step 1: Actualizar las pruebas existentes y añadir las nuevas**

En `backend/tests/integration/admin-products.routes.test.js`:

1. En el `vi.mock` de prisma añadir `taxSetting: { findUnique: vi.fn() },` y `update: vi.fn()` dentro de `productVariant`.
2. En el `beforeEach`, después del `resetAllMocks`/mocks de cloudinary, añadir: `prisma.taxSetting.findUnique.mockResolvedValue({ id: 1, rate: 19 })`.
3. Cambiar en todos los `.send({...})` de `POST /products` `price: '59900'` por `basePrice: '59900'`, y `price: 100` / `price: -10` por `basePrice: 100` / `basePrice: -10` (líneas ~296, 318, 331, 347, 382, 391, 399, 407).
4. Añadir dentro del `describe` de creación (junto a `setupCreate`):

```js
  it('guarda price = base + IVA (19 %) y la tasa usada', async () => {
    setupCreate()
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Camiseta', basePrice: '20000', categorySlug: 'camisetas' })
    expect(res.status).toBe(201)
    const data = prisma.product.create.mock.calls[0][0].data
    expect(data.basePrice).toBe(20000)
    expect(data.taxRate).toBe(19)
    expect(data.price).toBe(23800)
  })

  it('producto exento: taxRate 0 → price = base', async () => {
    setupCreate()
    await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Libro', basePrice: '45000', taxRate: '0', categorySlug: 'camisetas' })
    const data = prisma.product.create.mock.calls[0][0].data
    expect(data.taxRate).toBe(0)
    expect(data.price).toBe(45000)
  })

  it('variante con precio propio: calcula su price con la tasa del producto', async () => {
    setupCreate()
    await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        name: 'Camiseta', basePrice: '20000', categorySlug: 'camisetas',
        variants: JSON.stringify([{ size: 'M', color: 'Azul', stock: 3, basePrice: 30000 }, { size: 'L', color: 'Azul', stock: 1 }]),
      })
    const v = prisma.product.create.mock.calls[0][0].data.variants.create
    expect(v[0]).toMatchObject({ basePrice: 30000, price: 35700 })
    expect(v[1]).toMatchObject({ basePrice: null, price: null })
  })

  it('rechaza la tasa fuera de 0–30', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'X', basePrice: 1000, taxRate: 45, categorySlug: 'camisetas' })
    expect(res.status).toBe(400)
  })
```

5. Añadir un `describe` para edición:

```js
describe('PUT /api/v1/admin/products/:id (IVA)', () => {
  const existing = { id: 'p1', name: 'X', slug: 'x', basePrice: 20000, taxRate: 19, price: 23800 }
  const setupUpdate = () => {
    prisma.product.findUnique.mockResolvedValueOnce(existing)
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', images: [], variants: [], availableSizes: [], discounts: [] })
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', images: [], variants: [], availableSizes: [], discounts: [] })
    prisma.$transaction.mockImplementation(async (cb) => cb(prisma))
    prisma.product.update.mockResolvedValue({})
    prisma.productVariant.findMany.mockResolvedValue([])
  }

  it('cambiar basePrice recalcula price', async () => {
    setupUpdate()
    await request(app).put('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ basePrice: 30000 })
    const data = prisma.product.update.mock.calls[0][0].data
    expect(data.basePrice).toBe(30000)
    expect(data.price).toBe(35700)
  })

  it('pasar a exento (taxRate 0) recalcula price desde la base existente', async () => {
    setupUpdate()
    await request(app).put('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ taxRate: 0 })
    const data = prisma.product.update.mock.calls[0][0].data
    expect(data.taxRate).toBe(0)
    expect(data.price).toBe(20000)
  })

  it('sin tocar precio ni tasa no escribe price', async () => {
    setupUpdate()
    await request(app).put('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ stock: 9 })
    const data = prisma.product.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('price')
    expect(data).not.toHaveProperty('basePrice')
  })
})
```

> Los `mockResolvedValue` de `getProductById` deben copiar la forma que ya usa el `describe` de edición existente en ese archivo (líneas ~150-200); si ahí se usa otro mock para el `findUnique`/`findFirst` final, reutilizarlo.

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && npx vitest run tests/integration/admin-products.routes.test.js`
Expected: FAIL (validator exige `price`; faltan `basePrice`/`taxRate`).

- [ ] **Step 3: Validadores**

En `backend/src/validators/admin-products.validator.js`, en `adminCreateProduct` reemplazar el bloque `body('price')...` por:

```js
  body('basePrice')
    .notEmpty().withMessage('El precio sin IVA es requerido')
    .isFloat({ min: 100, max: 50000000 }).withMessage('El precio debe estar entre $100 y $50.000.000 COP'),
  body('taxRate')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 30 }).withMessage('La tasa de IVA debe estar entre 0 y 30'),
```

En `adminUpdateProduct` reemplazar la línea `body('price').optional()...` por:

```js
  body('basePrice').optional().isFloat({ min: 100, max: 50000000 }).withMessage('El precio debe estar entre $100 y $50.000.000 COP'),
  body('taxRate').optional({ nullable: true }).isFloat({ min: 0, max: 30 }).withMessage('La tasa de IVA debe estar entre 0 y 30'),
```

- [ ] **Step 4: Servicio**

En `backend/src/services/admin-products.service.js`:

1. Imports (arriba):

```js
import { finalPrice } from './tax.service.js'
import { getCurrentRate } from './tax-settings.service.js'
```

2. Reemplazar `normalizeVariant` por:

```js
const normalizeVariant = (v, rate) => {
  const hasBase = v.basePrice !== undefined && v.basePrice !== null && v.basePrice !== ''
  const basePrice = hasBase ? Math.round(parseFloat(v.basePrice) * 100) / 100 : null
  return {
    size:              v.size ? String(v.size).trim() : null,
    color:             v.color ? String(v.color).trim() : null,
    colorHex:          v.colorHex || null,
    sku:               v.sku ? String(v.sku).trim() : null,
    stock:             Math.max(0, parseInt(v.stock) || 0),
    lowStockThreshold: v.lowStockThreshold !== undefined && v.lowStockThreshold !== null && v.lowStockThreshold !== '' ? parseInt(v.lowStockThreshold) : null,
    basePrice,
    price:             basePrice === null ? null : finalPrice(basePrice, rate),
  }
}

const parseTaxRate = (value) =>
  value === undefined || value === null || value === '' ? undefined : Number(value)
```

3. En `createProduct`, antes del `try` que parsea (justo después de resolver `categoryId`), calcular la tasa y usarla:

```js
  const taxRate = parseTaxRate(data.taxRate) ?? await getCurrentRate(prisma)
  const basePrice = Math.round(parseFloat(data.basePrice) * 100) / 100
```

cambiar `variants = parseJsonArray(data.variants, 'variants').map(normalizeVariant)` por `.map((v) => normalizeVariant(v, taxRate))`, y en el `tx.product.create` reemplazar `price: parseFloat(data.price),` por:

```js
          basePrice,
          taxRate,
          price:             finalPrice(basePrice, taxRate),
```

4. En `updateProduct`, después de comprobar que `existing` existe:

```js
  const taxRate = parseTaxRate(data.taxRate) ?? Number(existing.taxRate)
  const rateChanged = taxRate !== Number(existing.taxRate)
```

cambiar el `.map(normalizeVariant)` del bloque `variants = ...` por `.map((v) => normalizeVariant(v, taxRate))`, y reemplazar la línea `if (data.price !== undefined) updateData.price = parseFloat(data.price)` por:

```js
      if (data.basePrice !== undefined) {
        const base = Math.round(parseFloat(data.basePrice) * 100) / 100
        updateData.basePrice = base
        updateData.price = finalPrice(base, taxRate)
      } else if (rateChanged) {
        updateData.price = finalPrice(Number(existing.basePrice), taxRate)
      }
      if (rateChanged) updateData.taxRate = taxRate
```

y justo después de `await tx.product.update({ where: { id }, data: updateData })` añadir (variantes ya guardadas no se reenvían):

```js
      if (rateChanged && variants === undefined) {
        const own = await tx.productVariant.findMany({ where: { productId: id, basePrice: { not: null } } })
        for (const v of own) {
          await tx.productVariant.update({ where: { id: v.id }, data: { price: finalPrice(Number(v.basePrice), taxRate) } })
        }
      }
```

5. En `upsertVariants`, cambiar la consulta del producto a `select: { id: true, taxRate: true }` y el mapeo por `.map((v) => normalizeVariant(v, Number(product.taxRate)))`.

6. Actualizar el comentario de documentación de `createProduct` (línea ~193-195): `price` → `basePrice (sin IVA), taxRate?`.

- [ ] **Step 5: Verificar que pasan**

Run: `cd backend && npx vitest run tests/integration/admin-products.routes.test.js`
Expected: PASS. Luego `npm test` completo: todo verde.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(backend): crear y editar productos con precio sin IVA"
```

---

### Task 5: Endpoints `/admin/tax`

**Files:**
- Create: `backend/src/validators/tax.validator.js`, `backend/src/controllers/tax.controller.js`
- Modify: `backend/src/routes/admin.routes.js`
- Test: `backend/tests/integration/admin-tax.routes.test.js`

**Interfaces:**
- Consumes: `getTaxSetting`, `setRate`, `applyPendingRate` (Task 3); `checkTaxRate` (Task 7 — este endpoint se completa allí; en esta tarea `POST /tax/check` queda fuera).
- Produces: `GET /admin/tax` → admin: `{ rate }`; SUPER_ADMIN: `{ rate, pendingRate, lastCheckAt, lastCheckRate, lastCheckSource, updatedAt }`. `PUT /admin/tax` `{ rate }` y `POST /admin/tax/apply-pending` (sólo SUPER_ADMIN) → `{ rate, changed, productsUpdated }`.

- [ ] **Step 1: Escribir la prueba que falla**

`backend/tests/integration/admin-tax.routes.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    taxSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}))

import request from 'supertest'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'

const token = (role) =>
  jwt.sign({ id: 'u1', email: 'u@a.com', role }, process.env.JWT_SECRET, { expiresIn: '15m' })

const row = { id: 1, rate: 19, pendingRate: 21, lastCheckAt: new Date('2026-10-09'), lastCheckRate: 21, lastCheckSource: 'https://x', updatedAt: new Date('2026-10-01') }

beforeEach(() => {
  vi.resetAllMocks()
  prisma.user.findFirst.mockResolvedValue({ id: 'u1' })
  prisma.taxSetting.findUnique.mockResolvedValue(row)
  prisma.$transaction.mockImplementation(async (cb) => cb(prisma))
  prisma.$executeRaw.mockResolvedValue(3)
})

describe('GET /admin/tax', () => {
  it('ADMIN sólo ve la tasa', async () => {
    const res = await request(app).get('/api/v1/admin/tax').set('Authorization', `Bearer ${token('ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ rate: 19 })
  })
  it('SUPER_ADMIN ve también la tasa pendiente y la última revisión', async () => {
    const res = await request(app).get('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.body).toMatchObject({ rate: 19, pendingRate: 21, lastCheckRate: 21 })
  })
  it('sin sesión → 401', async () => {
    expect((await request(app).get('/api/v1/admin/tax')).status).toBe(401)
  })
})

describe('PUT /admin/tax', () => {
  it('ADMIN → 403', async () => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('ADMIN')}`).send({ rate: 5 })
    expect(res.status).toBe(403)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('SUPER_ADMIN cambia la tasa', async () => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate: 5 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ rate: 5, changed: true })
    expect(prisma.taxSetting.upsert).toHaveBeenCalled()
  })
  it.each([[45], [-1], ['abc']])('rechaza rate=%s', async (rate) => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate })
    expect(res.status).toBe(400)
  })
})

describe('POST /admin/tax/apply-pending', () => {
  it('ADMIN → 403', async () => {
    const res = await request(app).post('/api/v1/admin/tax/apply-pending').set('Authorization', `Bearer ${token('ADMIN')}`)
    expect(res.status).toBe(403)
  })
  it('aplica la pendiente', async () => {
    const res = await request(app).post('/api/v1/admin/tax/apply-pending').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body.rate).toBe(21)
  })
  it('409 si no hay pendiente', async () => {
    prisma.taxSetting.findUnique.mockResolvedValue({ ...row, pendingRate: null })
    const res = await request(app).post('/api/v1/admin/tax/apply-pending').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `cd backend && npx vitest run tests/integration/admin-tax.routes.test.js`
Expected: FAIL (404 en las rutas).

- [ ] **Step 3: Implementar**

`backend/src/validators/tax.validator.js`:

```js
import { body } from 'express-validator'

export const updateTaxRate = [
  body('rate')
    .exists({ checkNull: true }).withMessage('La tasa de IVA es requerida')
    .bail()
    .isFloat({ min: 0, max: 30 }).withMessage('La tasa de IVA debe estar entre 0 y 30')
    .toFloat(),
]
```

`backend/src/controllers/tax.controller.js`:

```js
import * as Tax from '../services/tax-settings.service.js'

export const getTax = async (req, res, next) => {
  try {
    const setting = await Tax.getTaxSetting()
    // Los ADMIN sólo necesitan la tasa (vista previa del precio); el detalle es del SUPER_ADMIN.
    if (req.user.role !== 'SUPER_ADMIN') return res.json({ rate: setting.rate })
    res.json(setting)
  } catch (err) { next(err) }
}

export const updateRate = async (req, res, next) => {
  try {
    res.json(await Tax.setRate(req.body.rate, req.user.id))
  } catch (err) { next(err) }
}

export const applyPending = async (req, res, next) => {
  try {
    res.json(await Tax.applyPendingRate(req.user.id))
  } catch (err) { next(err) }
}
```

En `backend/src/routes/admin.routes.js`:

- import: `import * as Tax from '../controllers/tax.controller.js'`, `import { updateTaxRate } from '../validators/tax.validator.js'` y ampliar el import existente de `authorization.middleware.js`: `import { canManageAdmins, authorizeRole } from '../middleware/authorization.middleware.js'`.
- Antes de la sección de Products añadir:

```js
// ─────────────────────────────────────────
// IVA — la tasa la gestiona sólo el SUPER_ADMIN
// ─────────────────────────────────────────
router.get ('/tax',               Tax.getTax)
router.put ('/tax',               authorizeRole('SUPER_ADMIN'), validate(updateTaxRate), Tax.updateRate)
router.post('/tax/apply-pending', authorizeRole('SUPER_ADMIN'), Tax.applyPending)
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd backend && npx vitest run tests/integration/admin-tax.routes.test.js && npm test`
Expected: PASS y suite completa en verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(backend): endpoints de IVA para el SUPER_ADMIN"
```

---

### Task 6: Lector de la fuente oficial (parser puro)

**Files:**
- Create: `backend/src/services/tax-check.service.js` (sólo `parseGeneralRate` en esta tarea)
- Test: `backend/tests/unit/tax-check.service.test.js`

**Interfaces:**
- Produces: `parseGeneralRate(html: string): number | null` — devuelve la tarifa general del art. 468 (p. ej. `19`) o `null` si no se puede leer con seguridad o el valor está fuera de 0–30.

- [ ] **Step 1: Escribir las pruebas que fallan**

`backend/tests/unit/tax-check.service.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseGeneralRate } from '../../src/services/tax-check.service.js'

const page = (art) => `<html><body><p>ARTICULO 467. otro texto 5%</p>${art}<p>ARTICULO 469. más texto 10%</p></body></html>`

describe('parseGeneralRate', () => {
  it('lee la tarifa del artículo 468', () => {
    const html = page('<p><b>ARTICULO 468. TARIFA GENERAL DEL IMPUESTO SOBRE LAS VENTAS.</b> La tarifa general del impuesto sobre las ventas es del diecinueve por ciento (19%).</p>')
    expect(parseGeneralRate(html)).toBe(19)
  })
  it('tolera tildes, mayúsculas, entidades y espacios', () => {
    const html = page('<p>Artículo&nbsp;468.  Tarifa   general del impuesto sobre las ventas.   La tarifa general del impuesto sobre las ventas es del veintiún por ciento (21 %).</p>')
    expect(parseGeneralRate(html)).toBe(21)
  })
  it('acepta decimal con coma', () => {
    const html = page('<p>ARTICULO 468. La tarifa general del impuesto sobre las ventas es del cinco punto cinco por ciento (5,5%).</p>')
    expect(parseGeneralRate(html)).toBe(5.5)
  })
  it('no toma porcentajes de otros artículos', () => {
    expect(parseGeneralRate(page('<p>ARTICULO 468. Texto sin porcentaje.</p>'))).toBeNull()
  })
  it('null si no existe el artículo 468', () => {
    expect(parseGeneralRate('<html>página de error</html>')).toBeNull()
    expect(parseGeneralRate('')).toBeNull()
    expect(parseGeneralRate(undefined)).toBeNull()
  })
  it('null si el valor es absurdo (fuera de 0–30)', () => {
    const html = page('<p>ARTICULO 468. La tarifa general del impuesto sobre las ventas es del ciento noventa por ciento (190%).</p>')
    expect(parseGeneralRate(html)).toBeNull()
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && npx vitest run tests/unit/tax-check.service.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar el parser**

`backend/src/services/tax-check.service.js`:

```js
import { isValidRate } from './tax.service.js'

const decodeEntities = (s) =>
  s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

const toPlainText = (html) =>
  decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()

/**
 * Extrae la tarifa general del IVA del texto del art. 468 del Estatuto Tributario.
 * Es deliberadamente estricto: ante cualquier duda devuelve null (el job no hace nada).
 */
export const parseGeneralRate = (html) => {
  const text = toPlainText(html)
  const start = text.search(/articulo 468\./)
  if (start === -1) return null
  // Sólo se mira el tramo del propio artículo (hasta el siguiente "articulo NNN.").
  const rest = text.slice(start + 12)
  const next = rest.search(/articulo \d+\./)
  const article = next === -1 ? rest.slice(0, 1500) : rest.slice(0, next)

  const m = article.match(/tarifa general del impuesto sobre las ventas es del [^()]{0,80}\(\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*%\s*\)/)
  if (!m) return null
  const rate = Number(m[1].replace(',', '.'))
  return isValidRate(rate) ? rate : null
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd backend && npx vitest run tests/unit/tax-check.service.test.js`
Expected: PASS (6 pruebas).

- [ ] **Step 5: Comprobar la fuente real (manual, requiere internet)**

```bash
curl -sL "https://www.secretariasenado.gov.co/senado/basedoc/estatuto_tributario_pr014.html" -o /tmp/et.html
cd backend && node -e "
import('./src/services/tax-check.service.js').then(async (m) => {
  const fs = await import('node:fs')
  const html = new TextDecoder('iso-8859-1').decode(fs.readFileSync('/tmp/et.html'))
  console.log('tarifa leída:', m.parseGeneralRate(html))
})"
```
Expected: `tarifa leída: 19`. Si imprime `null`, abrir el HTML, ver cómo está escrito el artículo 468 (o probar la página equivalente en el normograma de la DIAN), y ajustar `parseGeneralRate` + añadir un caso a la prueba con el texto real. **No seguir a la Task 7 con `null`.** La URL queda configurable en `TAX_SOURCE_URL`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tax-check.service.js backend/tests/unit/tax-check.service.test.js
git commit -m "feat(backend): lector de la tarifa general de IVA desde el Estatuto Tributario"
```

---

### Task 7: Revisión diaria, alertas y endpoint de revisión manual

**Files:**
- Modify: `backend/src/services/tax-check.service.js` (añadir `checkTaxRate`)
- Modify: `backend/src/config/sentry.js`, `backend/src/services/email.service.js`, `backend/src/jobs/maintenance.js`, `backend/src/controllers/tax.controller.js`, `backend/src/routes/admin.routes.js`, `backend/.env.example`
- Test: `backend/tests/unit/tax-check.service.test.js` (ampliar), `backend/tests/integration/admin-tax.routes.test.js` (ampliar)

**Interfaces:**
- Consumes: `parseGeneralRate` (Task 6), `getTaxSetting` (Task 3).
- Produces: `checkTaxRate({ fetchFn?, db?, now?, force? }): Promise<{ status: 'skipped'|'unchanged'|'pending'|'error', detected?: number }>` — **nunca lanza**. `captureMessage(message, context)` en `sentry.js`. `sendTaxChangeAlert({ currentRate, detectedRate, source }): Promise<boolean>`. `POST /admin/tax/check` (SUPER_ADMIN) → resultado de `checkTaxRate({ force: true })`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `backend/tests/unit/tax-check.service.test.js` (arriba, imports y mocks; abajo, el `describe`):

```js
import { vi, beforeEach } from 'vitest'

vi.mock('../../src/config/sentry.js', () => ({ captureError: vi.fn(), captureMessage: vi.fn() }))
vi.mock('../../src/services/email.service.js', () => ({ sendTaxChangeAlert: vi.fn().mockResolvedValue(true) }))

const { checkTaxRate } = await import('../../src/services/tax-check.service.js')
const { captureError, captureMessage } = await import('../../src/config/sentry.js')
const { sendTaxChangeAlert } = await import('../../src/services/email.service.js')

const html = (pct, word = 'diecinueve') =>
  `<p>ARTICULO 468. La tarifa general del impuesto sobre las ventas es del ${word} por ciento (${pct}%).</p>`
const okFetch = (body) => vi.fn().mockResolvedValue({ ok: true, text: async () => body })

const makeDb = (row) => ({
  taxSetting: {
    findUnique: vi.fn().mockResolvedValue(row),
    upsert: vi.fn().mockResolvedValue({}),
  },
})
const base = { id: 1, rate: 19, pendingRate: null, lastCheckAt: null }

describe('checkTaxRate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('misma tasa: sin alerta y sin pendiente', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch(html(19)), db })
    expect(r.status).toBe('unchanged')
    expect(sendTaxChangeAlert).not.toHaveBeenCalled()
    expect(db.taxSetting.upsert.mock.calls[0][0].update).toMatchObject({ pendingRate: null, lastCheckRate: 19 })
  })

  it('tasa distinta: guarda pendingRate, avisa a Sentry y por correo, NO cambia rate', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch(html(21, 'veintiuno')), db })
    expect(r).toEqual({ status: 'pending', detected: 21 })
    const update = db.taxSetting.upsert.mock.calls[0][0].update
    expect(update.pendingRate).toBe(21)
    expect(update).not.toHaveProperty('rate')
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(sendTaxChangeAlert).toHaveBeenCalledWith(expect.objectContaining({ currentRate: 19, detectedRate: 21 }))
  })

  it('no repite la alerta si el mismo pendingRate ya estaba guardado', async () => {
    const db = makeDb({ ...base, pendingRate: 21 })
    await checkTaxRate({ fetchFn: okFetch(html(21, 'veintiuno')), db, force: true })
    expect(sendTaxChangeAlert).not.toHaveBeenCalled()
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('se salta si ya se revisó hace menos de 23 h (sin force)', async () => {
    const now = new Date('2026-10-09T12:00:00Z')
    const db = makeDb({ ...base, lastCheckAt: new Date('2026-10-09T05:00:00Z') })
    const fetchFn = okFetch(html(19))
    const r = await checkTaxRate({ fetchFn, db, now })
    expect(r.status).toBe('skipped')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('force ignora el intervalo', async () => {
    const now = new Date('2026-10-09T12:00:00Z')
    const db = makeDb({ ...base, lastCheckAt: new Date('2026-10-09T11:00:00Z') })
    const r = await checkTaxRate({ fetchFn: okFetch(html(19)), db, now, force: true })
    expect(r.status).toBe('unchanged')
  })

  it('fuente caída: no lanza, no cambia precios, registra el error', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')), db })
    expect(r.status).toBe('error')
    expect(captureError).toHaveBeenCalled()
    expect(db.taxSetting.upsert.mock.calls[0][0].update).not.toHaveProperty('pendingRate')
  })

  it('HTTP 500: error sin excepción', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: vi.fn().mockResolvedValue({ ok: false, status: 500 }), db })
    expect(r.status).toBe('error')
  })

  it('HTML irreconocible: error, sin pendingRate', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch('<html>cambió el sitio</html>'), db })
    expect(r.status).toBe('error')
    expect(db.taxSetting.upsert.mock.calls[0][0].update).not.toHaveProperty('pendingRate')
  })

  it('valor absurdo (190 %): error, sin pendingRate', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch(html(190, 'ciento noventa')), db })
    expect(r.status).toBe('error')
  })
})
```

Añadir a `backend/tests/integration/admin-tax.routes.test.js` (y mockear `tax-check.service.js` arriba con `vi.mock('../../src/services/tax-check.service.js', () => ({ checkTaxRate: vi.fn().mockResolvedValue({ status: 'unchanged' }) }))`):

```js
describe('POST /admin/tax/check', () => {
  it('ADMIN → 403', async () => {
    expect((await request(app).post('/api/v1/admin/tax/check').set('Authorization', `Bearer ${token('ADMIN')}`)).status).toBe(403)
  })
  it('SUPER_ADMIN fuerza la revisión', async () => {
    const res = await request(app).post('/api/v1/admin/tax/check').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('unchanged')
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && npx vitest run tests/unit/tax-check.service.test.js tests/integration/admin-tax.routes.test.js`
Expected: FAIL (`checkTaxRate` no existe; `/tax/check` da 404).

- [ ] **Step 3: `captureMessage` en Sentry**

En `backend/src/config/sentry.js`, después de `captureError`:

```js
export const captureMessage = (message, context) => {
  if (!initialized) return
  Sentry.captureMessage(message, { level: 'warning', extra: context })
}
```

- [ ] **Step 4: Correo de alerta**

En `backend/src/services/email.service.js`, al final del archivo:

```js
/** Avisa al dueño de la tienda que la fuente oficial indica otra tasa de IVA. */
export const sendTaxChangeAlert = async ({ currentRate, detectedRate, source }) => {
  const to = process.env.TAX_ALERT_EMAIL || process.env.SMTP_FROM_EMAIL || FROM_EMAIL
  if (!to) return false
  try {
    await emailTransporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: `Posible cambio del IVA: ${detectedRate} % (tu tienda usa ${currentRate} %)`,
      html: `
        <p>La fuente oficial indica una tarifa general de IVA de <strong>${detectedRate} %</strong>,
        pero tu tienda usa <strong>${currentRate} %</strong>.</p>
        <p>Fuente: ${source}</p>
        <p>No se cambió ningún precio. Si el cambio es correcto, entra a
        <strong>Admin → IVA</strong> y pulsa "Aplicar". Confírmalo antes con tu contador.</p>`,
    })
    log.info({ to, currentRate, detectedRate }, 'email.tax_alert_sent')
    return true
  } catch (error) {
    log.error({ err: error }, 'email.tax_alert_failed')
    return false
  }
}
```

- [ ] **Step 5: Implementar `checkTaxRate`**

En `backend/src/services/tax-check.service.js`, añadir arriba los imports y abajo la función:

```js
import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'
import { captureError, captureMessage } from '../config/sentry.js'
import { sendTaxChangeAlert } from './email.service.js'
import { getTaxSetting } from './tax-settings.service.js'

const log = logger.child({ component: 'tax-check' })

const DEFAULT_SOURCE = 'https://www.secretariasenado.gov.co/senado/basedoc/estatuto_tributario_pr014.html'
const MIN_INTERVAL_MS = 23 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 15000

const decodeBody = async (res) => {
  // La página puede venir en ISO-8859-1; si el fetch entrega ArrayBuffer lo decodificamos.
  if (typeof res.arrayBuffer === 'function') return new TextDecoder('iso-8859-1').decode(await res.arrayBuffer())
  return res.text()
}

/**
 * Compara la tasa guardada con la de la fuente oficial. NUNCA cambia precios ni la tasa:
 * si difiere, deja `pendingRate` y avisa (Sentry + correo, una sola vez por valor).
 * No lanza excepciones: el job de mantenimiento no debe caerse por esto.
 */
export const checkTaxRate = async ({ fetchFn = fetch, db = prisma, now = new Date(), force = false } = {}) => {
  const source = process.env.TAX_SOURCE_URL || DEFAULT_SOURCE
  try {
    const current = await getTaxSetting(db)
    if (!force && current.lastCheckAt && now - new Date(current.lastCheckAt) < MIN_INTERVAL_MS) {
      return { status: 'skipped' }
    }

    const touch = (extra = {}) => db.taxSetting.upsert({
      where: { id: 1 },
      update: { lastCheckAt: now, lastCheckSource: source, ...extra },
      create: { id: 1, lastCheckAt: now, lastCheckSource: source, ...extra },
    })

    let detected = null
    try {
      const res = await fetchFn(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      detected = parseGeneralRate(await decodeBody(res))
    } catch (err) {
      log.error({ err, source }, 'tax.check_failed')
      captureError(err, { job: 'tax-check', source })
      await touch()
      return { status: 'error' }
    }

    if (detected === null) {
      const err = new Error('No se pudo leer la tarifa de IVA en la fuente oficial')
      log.error({ source }, 'tax.check_unparseable')
      captureError(err, { job: 'tax-check', source })
      await touch()
      return { status: 'error' }
    }

    if (detected === current.rate) {
      await touch({ lastCheckRate: detected, pendingRate: null })
      return { status: 'unchanged', detected }
    }

    await touch({ lastCheckRate: detected, pendingRate: detected })
    if (current.pendingRate !== detected) {
      log.warn({ currentRate: current.rate, detected, source }, 'tax.rate_change_detected')
      captureMessage('La fuente oficial indica otra tarifa de IVA', { currentRate: current.rate, detected, source })
      await sendTaxChangeAlert({ currentRate: current.rate, detectedRate: detected, source })
    }
    return { status: 'pending', detected }
  } catch (err) {
    log.error({ err }, 'tax.check_crashed')
    captureError(err, { job: 'tax-check' })
    return { status: 'error' }
  }
}
```

- [ ] **Step 6: Conectar al mantenimiento y al endpoint manual**

`backend/src/jobs/maintenance.js`: importar `import { checkTaxRate } from '../services/tax-check.service.js'` y, dentro de `runMaintenance`, después del `log.info(... 'maintenance.done')`, antes del `catch`:

```js
    await checkTaxRate() // se auto-limita a 1 vez cada 23 h y no lanza
```

`backend/src/controllers/tax.controller.js`: importar `import { checkTaxRate } from '../services/tax-check.service.js'` y añadir:

```js
export const checkNow = async (req, res, next) => {
  try {
    res.json(await checkTaxRate({ force: true }))
  } catch (err) { next(err) }
}
```

`backend/src/routes/admin.routes.js`, junto a las rutas de `/tax`:

```js
router.post('/tax/check',         authorizeRole('SUPER_ADMIN'), Tax.checkNow)
```

`backend/.env.example`, al final:

```
# IVA: fuente oficial que revisa el job diario (opcional; hay un valor por defecto)
# TAX_SOURCE_URL=https://www.secretariasenado.gov.co/senado/basedoc/estatuto_tributario_pr014.html
# Correo que recibe el aviso si cambia el IVA (por defecto SMTP_FROM_EMAIL)
# TAX_ALERT_EMAIL=
```

- [ ] **Step 7: Verificar**

Run: `cd backend && npm test`
Expected: PASS, suite completa en verde.

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(backend): revisión diaria de la tarifa de IVA con aviso (sin cambiar precios)"
```

---

### Task 8: Frontend — cálculo, API y formulario de producto

**Files:**
- Create: `frontend/src/lib/tax.js`
- Modify: `frontend/src/lib/api.js` (bloque `admin`, tras `lowStock`), `frontend/src/components/admin/ProductFormModal.jsx`, `frontend/src/components/admin/VariantEditor.jsx`
- Test: `frontend/tests/tax.test.js`, `frontend/tests/admin/VariantEditor.test.jsx` (revisar)

**Interfaces:**
- Consumes: `GET /admin/tax` → `{ rate }` (Task 5); `POST/PUT /admin/products` con `basePrice`/`taxRate` (Task 4).
- Produces: `finalPrice(base, rate)` y `formatCOP(n)` en `frontend/src/lib/tax.js`; `api.admin.tax()`, `api.admin.setTaxRate(rate)`, `api.admin.applyPendingTax()`, `api.admin.checkTax()`.

- [ ] **Step 1: Escribir la prueba que falla**

`frontend/tests/tax.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { finalPrice, formatCOP } from '../src/lib/tax.js'

describe('finalPrice (debe coincidir con el backend)', () => {
  it('suma el IVA y redondea a peso', () => {
    expect(finalPrice(20000, 19)).toBe(23800)
    expect(finalPrice(59900, 19)).toBe(71281)
    expect(finalPrice(1010, 5)).toBe(1061)
  })
  it('exento: igual', () => expect(finalPrice(45000, 0)).toBe(45000))
  it('entrada vacía o inválida → 0', () => {
    expect(finalPrice('', 19)).toBe(0)
    expect(finalPrice('abc', 19)).toBe(0)
  })
})

describe('formatCOP', () => {
  it('formatea con separador de miles', () => expect(formatCOP(23800)).toBe('$23.800'))
})
```

- [ ] **Step 2: Verificar que falla**

Run: `cd frontend && npx vitest run tests/tax.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `tax.js` y los endpoints**

`frontend/src/lib/tax.js`:

```js
// Misma fórmula que backend/src/services/tax.service.js (aritmética en puntos básicos).
export const finalPrice = (base, rate) => {
  const b = Number(base)
  if (!Number.isFinite(b) || b <= 0) return 0
  return Math.round((b * (10000 + Math.round(Number(rate) * 100))) / 10000)
}

export const formatCOP = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
```

En `frontend/src/lib/api.js`, dentro de `admin: {`, después de la línea de `lowStock`:

```js
    tax:             ()     => request('/admin/tax'),
    setTaxRate:      (rate) => request('/admin/tax', { method: 'PUT', body: JSON.stringify({ rate }) }),
    applyPendingTax: ()     => request('/admin/tax/apply-pending', { method: 'POST' }),
    checkTax:        ()     => request('/admin/tax/check', { method: 'POST' }),
```

- [ ] **Step 4: Formulario de producto**

En `frontend/src/components/admin/ProductFormModal.jsx`:

1. Imports: `import { finalPrice, formatCOP } from '../../lib/tax.js'`.
2. Estado (reemplaza `price`):

```js
  const [price, setPrice] = useState(product?.basePrice != null ? String(Math.round(Number(product.basePrice) * 100) / 100) : '')
  const [exempt, setExempt] = useState(product ? Number(product.taxRate) === 0 : false)
  const [generalRate, setGeneralRate] = useState(19)
  useEffect(() => {
    api.admin.tax().then((t) => setGeneralRate(Number(t.rate))).catch(() => {})
  }, [])
  // Un producto existente conserva su tasa propia; uno nuevo usa la vigente (o 0 si es exento).
  const rate = exempt ? 0 : (product && Number(product.taxRate) !== 0 ? Number(product.taxRate) : generalRate)
```

(`useEffect` ya está importado en el archivo.)

3. `initialCells`: cambiar `price: v.price != null ? Number(v.price) : ''` por `basePrice: v.basePrice != null ? Number(v.basePrice) : ''`.
4. `buildVariants`: cambiar la línea `price: cell.price ...` por `basePrice: cell.basePrice !== '' && cell.basePrice != null ? Number(cell.basePrice) : null,`.
5. `submit`: reemplazar `form.append('price', ...)` por:

```js
      form.append('basePrice', String(Math.round(Number(price) * 100) / 100))
      form.append('taxRate', String(rate))
```

6. Reemplazar el `<label>` del precio (líneas ~222-227) por:

```jsx
              <label className={`pf-field ${fieldErrors.price ? 'invalid' : ''}`}>
                <span>Precio sin IVA (COP) *</span>
                <input type="number" inputMode="numeric" min="100" step="100" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="50000" />
                {Number(price) > 0 && (
                  <small>
                    IVA ({rate} %): {formatCOP(finalPrice(price, rate) - Number(price))} · <strong>Precio final: {formatCOP(finalPrice(price, rate))}</strong>
                  </small>
                )}
                <label className="pf-check">
                  <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} /> Producto exento de IVA
                </label>
                {fieldErrors.price && <em>{fieldErrors.price}</em>}
              </label>
```

(No anidar `<label>` si el CSS existente lo rompe: sustituir el `<label className="pf-check">` interno por un `<div className="pf-check">` con el mismo contenido. Revisar visualmente en el paso 7.)

- [ ] **Step 5: Editor de variantes**

En `frontend/src/components/admin/VariantEditor.jsx`: en el comentario de props y en `get`/`update` cambiar la clave de celda `price` → `basePrice` (líneas 15, 37, 56 y el `input` de la línea ~140):

```jsx
<input type="number" min="0" step="100" placeholder="Precio sin IVA (vacío = el del producto)" value={cell.basePrice ?? ''} onChange={(e) => update(c.size, c.color, 'basePrice', e.target.value)} />
```

y `{ stock: 0, sku: '', basePrice: '' }` / `{ sku: '', basePrice: '' }` en los valores por defecto. Luego `grep -n "price" frontend/tests/admin/VariantEditor.test.jsx` y actualizar cualquier aserción que use la clave `price` de las celdas.

- [ ] **Step 6: Verificar**

Run: `cd frontend && npm test && PUBLIC_API_URL=https://api.example.com/api/v1 npm run build`
Expected: pruebas en verde y build `Complete!`.

- [ ] **Step 7: Revisión visual**

Run: `cd frontend && npm run dev` (con `PUBLIC_API_URL` apuntando al backend local) → Admin → Productos → "+ Nuevo producto": escribir 20000 y ver "IVA (19 %): $3.800 · Precio final: $23.800"; marcar exento y ver "Precio final: $20.000". Revisar también en ancho móvil (≈375 px).

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): formulario de producto con precio sin IVA y vista previa del precio final"
```

---

### Task 9: Frontend — pantalla de IVA para el SUPER_ADMIN

**Files:**
- Create: `frontend/src/components/admin/TaxSettings.jsx`, `frontend/src/pages/admin/iva.astro`
- Modify: `frontend/src/components/admin/DashboardOverview.jsx` (grilla de acciones ~línea 118-137)
- Test: `frontend/tests/admin/TaxSettings.test.jsx`

**Interfaces:**
- Consumes: `api.admin.tax/setTaxRate/applyPendingTax/checkTax` (Task 8); `bootstrapAuth` de `lib/api.js`.
- Produces: ruta `/admin/iva`; tarjeta "IVA" en el panel sólo si `user.role === 'SUPER_ADMIN'`.

- [ ] **Step 1: Escribir la prueba que falla**

`frontend/tests/admin/TaxSettings.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/lib/api.js', () => ({
  api: { admin: { tax: vi.fn(), setTaxRate: vi.fn(), applyPendingTax: vi.fn(), checkTax: vi.fn() } },
  bootstrapAuth: vi.fn(),
}))

import { api, bootstrapAuth } from '../../src/lib/api.js'
import TaxSettings from '../../src/components/admin/TaxSettings.jsx'

afterEach(cleanup)
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('confirm', vi.fn(() => true)) })

const superAdmin = { role: 'SUPER_ADMIN' }

describe('TaxSettings', () => {
  it('bloquea a un ADMIN que no es SUPER_ADMIN', async () => {
    bootstrapAuth.mockResolvedValue({ role: 'ADMIN' })
    render(<TaxSettings />)
    expect(await screen.findByText(/solo el super administrador/i)).toBeTruthy()
    expect(api.admin.tax).not.toHaveBeenCalled()
  })

  it('muestra la tasa vigente', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax.mockResolvedValue({ rate: 19, pendingRate: null, lastCheckAt: null })
    render(<TaxSettings />)
    expect(await screen.findByDisplayValue('19')).toBeTruthy()
  })

  it('con tasa pendiente muestra el banner y permite aplicarla', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax
      .mockResolvedValueOnce({ rate: 19, pendingRate: 21, lastCheckAt: '2026-10-09T00:00:00Z' })
      .mockResolvedValueOnce({ rate: 21, pendingRate: null })
    api.admin.applyPendingTax.mockResolvedValue({ rate: 21, changed: true, productsUpdated: 4 })
    render(<TaxSettings />)
    expect(await screen.findByText(/indica 21 %/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /aplicar 21 %/i }))
    await waitFor(() => expect(api.admin.applyPendingTax).toHaveBeenCalled())
  })

  it('cambia la tasa manualmente tras confirmar', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax.mockResolvedValue({ rate: 19, pendingRate: null })
    api.admin.setTaxRate.mockResolvedValue({ rate: 5, changed: true, productsUpdated: 2 })
    render(<TaxSettings />)
    const input = await screen.findByDisplayValue('19')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar tasa/i }))
    await waitFor(() => expect(api.admin.setTaxRate).toHaveBeenCalledWith(5))
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `cd frontend && npx vitest run tests/admin/TaxSettings.test.jsx`
Expected: FAIL (componente inexistente).

- [ ] **Step 3: Componente**

`frontend/src/components/admin/TaxSettings.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react'
import { api, bootstrapAuth } from '../../lib/api.js'

/**
 * Pantalla de IVA (sólo SUPER_ADMIN): tasa vigente, última revisión de la fuente
 * oficial y, si la fuente indica otra tasa, banner para aplicarla.
 */
export default function TaxSettings() {
  const [state, setState] = useState('loading') // loading | denied | ready
  const [setting, setSetting] = useState(null)
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'error', text }

  const load = useCallback(async () => {
    const s = await api.admin.tax()
    setSetting(s)
    setRate(String(s.rate))
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const user = await bootstrapAuth()
      if (!mounted) return
      if (!user || user.role !== 'SUPER_ADMIN') { setState('denied'); return }
      try { await load(); if (mounted) setState('ready') }
      catch (err) { if (mounted) { setMsg({ type: 'error', text: err.message }); setState('ready') } }
    })()
    return () => { mounted = false }
  }, [load])

  const run = async (fn, okText) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fn()
      await load()
      setMsg({ type: 'ok', text: okText(r) })
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'No se pudo completar la acción' })
    } finally { setBusy(false) }
  }

  const save = () => {
    const next = Number(rate)
    if (!Number.isFinite(next) || next < 0 || next > 30) { setMsg({ type: 'error', text: 'La tasa debe estar entre 0 y 30' }); return }
    if (!confirm(`¿Cambiar el IVA a ${next} %?\n\nSe recalcularán los precios de todos los productos con IVA general. Los pedidos ya hechos no cambian.`)) return
    run(() => api.admin.setTaxRate(next), (r) => r.changed ? `IVA actualizado a ${r.rate} %: ${r.productsUpdated} producto(s) recalculados` : 'La tasa ya era esa; no hubo cambios')
  }

  const apply = () => {
    if (!confirm(`¿Aplicar ${setting.pendingRate} %?\n\nConfírmalo antes con tu contador. Se recalcularán los precios de los productos con IVA general.`)) return
    run(() => api.admin.applyPendingTax(), (r) => `IVA actualizado a ${r.rate} %: ${r.productsUpdated} producto(s) recalculados`)
  }

  const checkNow = () =>
    run(() => api.admin.checkTax(), (r) => ({
      unchanged: 'La fuente oficial coincide con tu tasa',
      pending: `La fuente oficial indica ${r.detected} %`,
      error: 'No se pudo leer la fuente oficial (revisa los logs)',
      skipped: 'Revisada hace poco',
    }[r.status] || 'Revisión terminada'))

  if (state === 'loading') return <div className="container" style={{ padding: '6rem 0' }}>Cargando…</div>
  if (state === 'denied') {
    return <div className="container" style={{ padding: '6rem 0' }}><p>Solo el super administrador puede gestionar el IVA.</p></div>
  }

  return (
    <div className="container" style={{ padding: 'calc(60px + 2rem) 0 4rem', maxWidth: 640 }}>
      <a href="/admin">← Panel</a>
      <h1>IVA</h1>
      <p>El precio que escribes al crear un producto es <strong>sin IVA</strong>; la tienda suma esta tasa y muestra el precio final.</p>

      {setting?.pendingRate != null && (
        <div role="alert" style={{ background: '#fef3c7', padding: '1rem', borderRadius: 6, margin: '1rem 0' }}>
          La fuente oficial indica {setting.pendingRate} %, tu tienda usa {setting.rate} %. No se ha cambiado ningún precio.
          <div style={{ marginTop: '.5rem' }}>
            <button className="btn btn-primary" onClick={apply} disabled={busy}>Aplicar {setting.pendingRate} %</button>
          </div>
        </div>
      )}

      <label style={{ display: 'block', margin: '1.5rem 0 .25rem' }}>Tasa vigente (%)</label>
      <input type="number" min="0" max="30" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} disabled={busy} />
      <button className="btn btn-primary" onClick={save} disabled={busy} style={{ marginLeft: '.5rem' }}>Guardar tasa</button>

      <p style={{ marginTop: '1.5rem', fontSize: '.875rem' }}>
        Última revisión de la fuente oficial: {setting?.lastCheckAt ? new Date(setting.lastCheckAt).toLocaleString('es-CO') : 'nunca'}
        {setting?.lastCheckRate != null && ` (indicó ${setting.lastCheckRate} %)`}
        {' '}<button className="btn" onClick={checkNow} disabled={busy}>Revisar ahora</button>
      </p>

      {msg && <p role="status" style={{ color: msg.type === 'error' ? '#991b1b' : '#166534' }}>{msg.text}</p>}
    </div>
  )
}
```

`frontend/src/pages/admin/iva.astro`:

```astro
---
import ShopLayout from '../../layouts/ShopLayout.astro'
import TaxSettings from '../../components/admin/TaxSettings.jsx'
---

<ShopLayout title="Admin - IVA">
  <TaxSettings client:only="react" />
</ShopLayout>
```

- [ ] **Step 4: Tarjeta en el panel (sólo SUPER_ADMIN)**

En `frontend/src/components/admin/DashboardOverview.jsx`: el componente ya llama a `bootstrapAuth()` (línea ~33). Guardar el rol: añadir estado `const [isSuper, setIsSuper] = useState(false)` y, donde se obtiene `user`, `setIsSuper(user?.role === 'SUPER_ADMIN')`. Después de la tarjeta `Usuarios` añadir:

```jsx
          {isSuper && (
            <a href="/admin/iva" className="action-card">
              <span className="action-icon">🧾</span>
              <h3>IVA</h3>
              <p>Tasa e impuestos</p>
            </a>
          )}
```

- [ ] **Step 5: Verificar**

Run: `cd frontend && npm test && PUBLIC_API_URL=https://api.example.com/api/v1 npm run build`
Expected: pruebas en verde y build `Complete!`.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): pantalla de IVA para el SUPER_ADMIN"
```

---

### Task 10: Verificación final y notas de despliegue

**Files:**
- Modify: `docs/LANZAMIENTO.md` (sección 7), `CLAUDE.md` (una línea en "Money flow")

- [ ] **Step 1: Documentar**

`docs/LANZAMIENTO.md`, en la sección **7. Legal (Colombia)**, sustituir la casilla "Define si tus precios incluyen IVA…" por:

```
- [ ] **IVA:** al crear un producto se escribe el precio **sin IVA**; la tienda suma la tasa (19 %) y muestra el precio final. La tasa se cambia en Admin → IVA (sólo SUPER_ADMIN). Un job diario compara con el Estatuto Tributario y avisa por correo/Sentry si difiere (configura `TAX_ALERT_EMAIL` si quieres otro correo). Confirma la tasa con tu contador antes de aplicar cualquier cambio.
```

`CLAUDE.md`, en el bullet "Prices, discounts, coupons and shipping…" añadir al final: ` \`Product.price\` is the final price **with IVA**, derived as \`finalPrice(basePrice, taxRate)\` (\`services/tax.service.js\`); admins enter \`basePrice\`, and the global rate lives in \`tax_settings\` (\`services/tax-settings.service.js\`).`

- [ ] **Step 2: Suite completa**

```bash
cd backend && npm test && TEST_DATABASE_URL=$TEST_DATABASE_URL npm run test:db && npx prisma validate
cd ../frontend && npm test && PUBLIC_API_URL=https://api.example.com/api/v1 npm run build
```
Expected: todo en verde. Repetir el chequeo de drift de la Task 2 Step 3.

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: IVA automático (runbook y arquitectura)"
```

- [ ] **Step 4: Despliegue (en este orden, con aprobación del usuario)**

1. Hacer un respaldo/branch de Neon de producción antes de la migración.
2. Subir a `main`: Railway despliega el backend y corre la migración sola (`prisma migrate deploy`). Verificar `GET /api/health` y que `SELECT price, "basePrice" FROM products LIMIT 5` conserve `price`.
3. **Sólo después**, dejar que Vercel despliegue el frontend (la API nueva ya acepta `basePrice`; el frontend viejo enviaría `price` y recibiría 400 al crear productos, así que el backend debe estar arriba primero).
4. Humo en producción: ver un producto existente en la tienda (mismo precio), crear un producto de prueba con base 20.000 → 23.800, archivarlo; entrar a Admin → IVA con SUPER_ADMIN y pulsar "Revisar ahora": debe decir que la fuente coincide (o mostrar error si la lectura falla; en ese caso el sistema sigue funcionando con la tasa guardada).
