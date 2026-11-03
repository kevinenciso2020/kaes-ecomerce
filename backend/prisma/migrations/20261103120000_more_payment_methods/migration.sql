-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'ADDI';
ALTER TYPE "PaymentProvider" ADD VALUE 'BANK_TRANSFER';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentProofAt" TIMESTAMP(3),
ADD COLUMN     "paymentProofPublicId" TEXT,
ADD COLUMN     "transferReviewedAt" TIMESTAMP(3);
