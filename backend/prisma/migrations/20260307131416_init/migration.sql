-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "corpName" TEXT NOT NULL,
    "stockCode" TEXT,
    "market" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_lists" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "corpName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "disclosureTypes" TEXT[],
    "keywords" TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disclosures" (
    "id" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "corpName" TEXT NOT NULL,
    "reportName" TEXT NOT NULL,
    "rcpDt" TEXT NOT NULL,
    "flrName" TEXT NOT NULL,
    "rmk" TEXT NOT NULL,
    "disclosureType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disclosures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "disclosureId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notification_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_deviceToken_key" ON "user_devices"("deviceToken");

-- CreateIndex
CREATE INDEX "user_devices_userId_idx" ON "user_devices"("userId");

-- CreateIndex
CREATE INDEX "user_devices_deviceToken_idx" ON "user_devices"("deviceToken");

-- CreateIndex
CREATE UNIQUE INDEX "companies_corpCode_key" ON "companies"("corpCode");

-- CreateIndex
CREATE INDEX "companies_corpName_idx" ON "companies"("corpName");

-- CreateIndex
CREATE INDEX "companies_stockCode_idx" ON "companies"("stockCode");

-- CreateIndex
CREATE INDEX "watch_lists_userId_idx" ON "watch_lists"("userId");

-- CreateIndex
CREATE INDEX "watch_lists_corpCode_idx" ON "watch_lists"("corpCode");

-- CreateIndex
CREATE UNIQUE INDEX "watch_lists_userId_corpCode_key" ON "watch_lists"("userId", "corpCode");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_userId_key" ON "notification_settings"("userId");

-- CreateIndex
CREATE INDEX "notification_settings_userId_idx" ON "notification_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "disclosures_rcpNo_key" ON "disclosures"("rcpNo");

-- CreateIndex
CREATE INDEX "disclosures_corpCode_idx" ON "disclosures"("corpCode");

-- CreateIndex
CREATE INDEX "disclosures_rcpDt_idx" ON "disclosures"("rcpDt");

-- CreateIndex
CREATE INDEX "disclosures_disclosureType_idx" ON "disclosures"("disclosureType");

-- CreateIndex
CREATE INDEX "disclosures_createdAt_idx" ON "disclosures"("createdAt");

-- CreateIndex
CREATE INDEX "notification_history_userId_isRead_idx" ON "notification_history"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notification_history_userId_sentAt_idx" ON "notification_history"("userId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_history_userId_disclosureId_key" ON "notification_history"("userId", "disclosureId");

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_lists" ADD CONSTRAINT "watch_lists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_history" ADD CONSTRAINT "notification_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_history" ADD CONSTRAINT "notification_history_disclosureId_fkey" FOREIGN KEY ("disclosureId") REFERENCES "disclosures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
