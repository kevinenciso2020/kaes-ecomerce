-- AlterTable
ALTER TABLE "electronic_documents" ADD COLUMN     "applicationResponse" TEXT,
ADD COLUMN     "buyerSnapshot" JSONB,
ADD COLUMN     "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

