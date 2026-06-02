-- CreateTable
CREATE TABLE "saved_disclosures" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "disclosureRcpNo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_disclosures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_disclosures_userId_createdAt_idx" ON "saved_disclosures"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_disclosures_userId_disclosureRcpNo_key" ON "saved_disclosures"("userId", "disclosureRcpNo");

-- AddForeignKey
ALTER TABLE "saved_disclosures" ADD CONSTRAINT "saved_disclosures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_disclosures" ADD CONSTRAINT "saved_disclosures_disclosureRcpNo_fkey" FOREIGN KEY ("disclosureRcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE CASCADE ON UPDATE CASCADE;
