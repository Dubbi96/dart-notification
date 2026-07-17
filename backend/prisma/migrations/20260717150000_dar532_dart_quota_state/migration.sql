-- DAR-532: DART 일일 콜 예산 상태 영속화(재기동 시 당일 소비/소진 복원 → 라이브 예약분 하드 보장).
-- 1행/KST일. callsToday 는 스로틀 flush(항상 실소비 이하), quotaExhausted 는 실제 020/021 관측 플래그.
CREATE TABLE "dart_quota_state" (
    "day" TEXT NOT NULL,
    "callsToday" INTEGER NOT NULL DEFAULT 0,
    "quotaExhausted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dart_quota_state_pkey" PRIMARY KEY ("day")
);
