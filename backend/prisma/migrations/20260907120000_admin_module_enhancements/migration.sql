-- Admin module enhancements:
-- - Color / Size / ProductAvailableSize tables (canonical catalog)
-- - Product.lowStockThreshold
-- - ProductVariant.sku, lowStockThreshold, colorHex
-- - OrderItem.variantId + variantSnapshot JSON
-- - OrderStatusLog audit trail

-- 1. Enum for size scale
CREATE TYPE "SizeScale" AS ENUM ('LETTER', 'NUMERIC', 'SHOE');

-- 2. colors table
CREATE TABLE "colors" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "slug"      TEXT NOT NULL,
    "hex"       TEXT NOT NULL,
    "order"     INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "colors_name_key" ON "colors"("name");
CREATE UNIQUE INDEX "colors_slug_key" ON "colors"("slug");

-- 3. sizes table
CREATE TABLE "sizes" (
    "id"        TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "scale"     "SizeScale" NOT NULL,
    "order"     INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sizes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sizes_value_key" ON "sizes"("value");
CREATE INDEX "sizes_scale_order_idx" ON "sizes"("scale", "order");

-- 4. product_available_sizes pivot
CREATE TABLE "product_available_sizes" (
    "productId" TEXT NOT NULL,
    "sizeId"    TEXT NOT NULL,
    CONSTRAINT "product_available_sizes_pkey" PRIMARY KEY ("productId","sizeId")
);
CREATE INDEX "product_available_sizes_sizeId_idx" ON "product_available_sizes"("sizeId");

-- 5. Add lowStockThreshold to products
ALTER TABLE "products"
    ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;

-- 6. ProductVariant enhancements
ALTER TABLE "product_variants"
    ADD COLUMN "sku"                TEXT,
    ADD COLUMN "lowStockThreshold"  INTEGER,
    ADD COLUMN "colorHex"           TEXT;

-- The @@unique([productId, size, color]) in Prisma translates to a UNIQUE constraint
-- that already handles NULL semantics in PostgreSQL (NULLs are distinct),
-- which gives us the "partial unique" behavior we want for variants with size or color = NULL.
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE INDEX "product_variants_stock_idx" ON "product_variants"("stock");

-- 7. OrderItem.variantId + variantSnapshot
ALTER TABLE "order_items"
    ADD COLUMN "variantId"       TEXT,
    ADD COLUMN "variantSnapshot" JSONB;

CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- 8. OrderStatusLog table
CREATE TABLE "order_status_logs" (
    "id"          TEXT NOT NULL,
    "orderId"     TEXT NOT NULL,
    "fromStatus"  "OrderStatus",
    "toStatus"    "OrderStatus" NOT NULL,
    "changedById" TEXT,
    "note"        TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_status_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_status_logs_orderId_createdAt_idx" ON "order_status_logs"("orderId", "createdAt");

-- 9. Foreign keys (added after tables exist to keep ordering explicit)
ALTER TABLE "product_available_sizes"
    ADD CONSTRAINT "product_available_sizes_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_available_sizes"
    ADD CONSTRAINT "product_available_sizes_sizeId_fkey"
    FOREIGN KEY ("sizeId") REFERENCES "sizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_status_logs"
    ADD CONSTRAINT "order_status_logs_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_status_logs"
    ADD CONSTRAINT "order_status_logs_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 10. Helpful indexes on orders for dashboard queries
CREATE INDEX IF NOT EXISTS "orders_status_idx"     ON "orders"("status");
CREATE INDEX IF NOT EXISTS "orders_userId_idx"     ON "orders"("userId");
CREATE INDEX IF NOT EXISTS "orders_createdAt_idx"  ON "orders"("createdAt");
