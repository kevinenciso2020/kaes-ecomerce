-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "guestEmail" VARCHAR(254),
ADD COLUMN     "guestName" VARCHAR(200),
ADD COLUMN     "guestPhone" VARCHAR(30),
ADD COLUMN     "guestShipping" JSONB,
ALTER COLUMN "userId" DROP NOT NULL;

