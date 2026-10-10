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
