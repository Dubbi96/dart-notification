-- Phase 1: Drop dependent tables (empty) and their constraints
-- notification_history, disclosures, notification_settings are empty

DROP TABLE IF EXISTS "notification_history";
DROP TABLE IF EXISTS "disclosures";
DROP TABLE IF EXISTS "notification_settings";

-- Phase 2: Modify companies PK (115k data preserved)
-- Drop watch_lists FK to companies first
ALTER TABLE "watch_lists" DROP CONSTRAINT IF EXISTS "watch_lists_corpCode_fkey";

-- Drop old PK and id column, promote corpCode to PK
ALTER TABLE "companies" DROP CONSTRAINT "companies_pkey";
ALTER TABLE "companies" DROP COLUMN "id";
DROP INDEX IF EXISTS "companies_corpCode_key";
ALTER TABLE "companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("corpCode");

-- Restore watch_lists FK to companies (now referencing corpCode PK)
ALTER TABLE "watch_lists" ADD CONSTRAINT "watch_lists_corpCode_fkey"
  FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 3: Recreate disclosures with rcpNo as PK
CREATE TABLE "disclosures" (
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "corpName" TEXT NOT NULL,
    "reportName" TEXT NOT NULL,
    "rcpDt" TEXT NOT NULL,
    "flrName" TEXT NOT NULL,
    "rmk" TEXT NOT NULL,
    "disclosureType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disclosures_pkey" PRIMARY KEY ("rcpNo")
);

CREATE INDEX "disclosures_corpCode_idx" ON "disclosures"("corpCode");
CREATE INDEX "disclosures_rcpDt_idx" ON "disclosures"("rcpDt");
CREATE INDEX "disclosures_disclosureType_idx" ON "disclosures"("disclosureType");
CREATE INDEX "disclosures_createdAt_idx" ON "disclosures"("createdAt");

ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_corpCode_fkey"
  FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 4: Recreate notification_settings with userId as PK
CREATE TABLE "notification_settings" (
    "userId" TEXT NOT NULL,
    "disclosureTypes" TEXT[],
    "keywords" TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 5: Recreate notification_history with disclosureRcpNo FK
CREATE TABLE "notification_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "disclosureRcpNo" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notification_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_history_userId_disclosureRcpNo_key"
  ON "notification_history"("userId", "disclosureRcpNo");
CREATE INDEX "notification_history_userId_isRead_idx"
  ON "notification_history"("userId", "isRead");
CREATE INDEX "notification_history_userId_sentAt_idx"
  ON "notification_history"("userId", "sentAt");

ALTER TABLE "notification_history" ADD CONSTRAINT "notification_history_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_history" ADD CONSTRAINT "notification_history_disclosureRcpNo_fkey"
  FOREIGN KEY ("disclosureRcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE CASCADE ON UPDATE CASCADE;
