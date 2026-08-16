-- AirdropRun / AirdropTransfer audit trail for on-chain admin airdrops

CREATE TABLE "AirdropRun" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "totalAmountWei" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirdropRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AirdropTransfer" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirdropTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AirdropTransfer_runId_idx" ON "AirdropTransfer"("runId");

ALTER TABLE "AirdropRun" ADD CONSTRAINT "AirdropRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AirdropTransfer" ADD CONSTRAINT "AirdropTransfer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AirdropRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
