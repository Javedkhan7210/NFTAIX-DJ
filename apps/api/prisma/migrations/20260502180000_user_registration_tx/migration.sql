-- AlterTable
ALTER TABLE "User" ADD COLUMN "registrationTxHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_registrationTxHash_key" ON "User"("registrationTxHash");
