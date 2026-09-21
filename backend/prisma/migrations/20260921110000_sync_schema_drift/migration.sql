-- Sincroniza diferencias entre schema.prisma y el historial de migraciones.
-- Estos objetos existen en el schema pero ninguna migración los creaba (la BD
-- de producción probablemente se creó/actualizó con `prisma db push`).
-- Todo es idempotente (IF NOT EXISTS) para que funcione en ambas situaciones.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "order_items_orderId_idx" ON "order_items"("orderId");
CREATE INDEX IF NOT EXISTS "order_items_productId_idx" ON "order_items"("productId");
CREATE INDEX IF NOT EXISTS "product_images_productId_idx" ON "product_images"("productId");
CREATE INDEX IF NOT EXISTS "product_variants_productId_idx" ON "product_variants"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_productId_size_color_key" ON "product_variants"("productId", "size", "color");
