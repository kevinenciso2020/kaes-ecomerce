-- CreateEnum
CREATE TYPE "ElectronicDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "ElectronicDocumentStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'ERROR');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "taxRate" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "buyerDocNumber" VARCHAR(20),
ADD COLUMN     "buyerDocType" VARCHAR(2),
ADD COLUMN     "buyerDv" VARCHAR(1),
ADD COLUMN     "buyerName" VARCHAR(450),
ADD COLUMN     "buyerPersonType" VARCHAR(1);

-- CreateTable
CREATE TABLE "electronic_documents" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "ElectronicDocumentType" NOT NULL,
    "status" "ElectronicDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "prefix" TEXT,
    "number" INTEGER,
    "fullNumber" TEXT,
    "cufe" TEXT,
    "environment" VARCHAR(1),
    "issuedAt" TIMESTAMP(3),
    "xmlSigned" TEXT,
    "fileName" TEXT,
    "trackId" TEXT,
    "dianResponse" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "reason" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "electronic_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "prefix" TEXT NOT NULL,
    "next" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("prefix")
);

-- CreateIndex
CREATE INDEX "electronic_documents_status_nextAttemptAt_idx" ON "electronic_documents"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_documents_orderId_type_key" ON "electronic_documents"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_documents_prefix_number_key" ON "electronic_documents"("prefix", "number");

-- AddForeignKey
ALTER TABLE "electronic_documents" ADD CONSTRAINT "electronic_documents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_documents" ADD CONSTRAINT "electronic_documents_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "electronic_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

