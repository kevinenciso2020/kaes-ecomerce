-- Pagos idempotentes, control de stock descontado, revisión manual y
-- consentimiento Habeas Data (Ley 1581 de 2012).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "privacyPolicyVersion" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentProvider" "PaymentProvider",
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "stockDeducted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "orderId" TEXT,
    "providerPaymentId" TEXT,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(10,2),
    "outcome" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_eventKey_key" ON "payment_events"("eventKey");
CREATE INDEX "payment_events_orderId_idx" ON "payment_events"("orderId");
CREATE INDEX "payment_events_createdAt_idx" ON "payment_events"("createdAt");
CREATE INDEX "orders_needsReview_idx" ON "orders"("needsReview");

-- Backfill: las órdenes con paidAt fueron confirmadas por webhook, que
-- descontaba stock en ese momento.
UPDATE "orders" SET "stockDeducted" = true WHERE "paidAt" IS NOT NULL;

-- Stock nunca negativo (defensa en BD contra carreras).
UPDATE "products"         SET "stock" = 0 WHERE "stock" < 0;
UPDATE "product_variants" SET "stock" = 0 WHERE "stock" < 0;
ALTER TABLE "products"         ADD CONSTRAINT "products_stock_non_negative"         CHECK ("stock" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_non_negative" CHECK ("stock" >= 0);

-- Emails en minúsculas (el login ahora normaliza). Si existe un duplicado que
-- sólo difiere en mayúsculas, se deja intacto para revisión manual.
UPDATE "users" u SET "email" = lower(trim(u."email"))
WHERE u."email" <> lower(trim(u."email"))
  AND NOT EXISTS (SELECT 1 FROM "users" u2 WHERE u2."email" = lower(trim(u."email")));

-- Los refresh tokens ahora se guardan hasheados (SHA-256): los existentes en
-- texto plano dejan de ser válidos. Los usuarios deberán iniciar sesión otra vez.
DELETE FROM "refresh_tokens";

-- Paleta de colores básicos de ropa (no pisa colores ya existentes).
INSERT INTO "colors" ("id", "name", "slug", "hex", "order") VALUES
  ('col_negro', 'Negro', 'negro', '#000000', 1),
  ('col_blanco', 'Blanco', 'blanco', '#FFFFFF', 2),
  ('col_gris', 'Gris', 'gris', '#808080', 3),
  ('col_gris_claro', 'Gris claro', 'gris-claro', '#D1D5DB', 4),
  ('col_gris_oscuro', 'Gris oscuro', 'gris-oscuro', '#374151', 5),
  ('col_azul', 'Azul', 'azul', '#1E40FF', 6),
  ('col_azul_marino', 'Azul marino', 'azul-marino', '#1E3A8A', 7),
  ('col_azul_cielo', 'Azul cielo', 'azul-cielo', '#7DD3FC', 8),
  ('col_azul_rey', 'Azul rey', 'azul-rey', '#1D4ED8', 9),
  ('col_azul_jean', 'Azul jean', 'azul-jean', '#3B5B8C', 10),
  ('col_turquesa', 'Turquesa', 'turquesa', '#14B8A6', 11),
  ('col_verde', 'Verde', 'verde', '#15803D', 12),
  ('col_verde_militar', 'Verde militar', 'verde-militar', '#4B5320', 13),
  ('col_verde_oliva', 'Verde oliva', 'verde-oliva', '#708238', 14),
  ('col_verde_menta', 'Verde menta', 'verde-menta', '#A7F3D0', 15),
  ('col_verde_esmeralda', 'Verde esmeralda', 'verde-esmeralda', '#047857', 16),
  ('col_amarillo', 'Amarillo', 'amarillo', '#FACC15', 17),
  ('col_mostaza', 'Mostaza', 'mostaza', '#D4A017', 18),
  ('col_naranja', 'Naranja', 'naranja', '#F97316', 19),
  ('col_coral', 'Coral', 'coral', '#FF7F50', 20),
  ('col_salmon', 'Salmón', 'salmon', '#FA8072', 21),
  ('col_rojo', 'Rojo', 'rojo', '#DC2626', 22),
  ('col_vinotinto', 'Vinotinto', 'vinotinto', '#722F37', 23),
  ('col_rosado', 'Rosado', 'rosado', '#F472B6', 24),
  ('col_rosa_pastel', 'Rosa pastel', 'rosa-pastel', '#FBCFE8', 25),
  ('col_fucsia', 'Fucsia', 'fucsia', '#C026D3', 26),
  ('col_lila', 'Lila', 'lila', '#C4B5FD', 27),
  ('col_morado', 'Morado', 'morado', '#7C3AED', 28),
  ('col_cafe', 'Café', 'cafe', '#78350F', 29),
  ('col_camel', 'Camel', 'camel', '#C19A6B', 30),
  ('col_caqui', 'Caqui', 'caqui', '#C3B091', 31),
  ('col_beige', 'Beige', 'beige', '#E7D7B7', 32),
  ('col_crema', 'Crema', 'crema', '#FFFDD0', 33),
  ('col_hueso', 'Hueso', 'hueso', '#F5F0E1', 34),
  ('col_dorado', 'Dorado', 'dorado', '#D4AF37', 35),
  ('col_plateado', 'Plateado', 'plateado', '#C0C0C0', 36)
ON CONFLICT DO NOTHING;
