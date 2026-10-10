-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('HOMBRE', 'MUJER');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "gender" "Gender";

-- CreateIndex
CREATE INDEX "products_gender_idx" ON "products"("gender");
