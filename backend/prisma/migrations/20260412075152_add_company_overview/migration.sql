-- CreateTable
CREATE TABLE "company_overviews" (
    "corpCode" TEXT NOT NULL,
    "corpName" TEXT NOT NULL,
    "corpNameEng" TEXT,
    "stockName" TEXT,
    "ceoName" TEXT,
    "corpCls" TEXT,
    "address" TEXT,
    "homepageUrl" TEXT,
    "industryCode" TEXT,
    "estDate" TEXT,
    "accMonth" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_overviews_pkey" PRIMARY KEY ("corpCode")
);
