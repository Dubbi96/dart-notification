-- DAR-95: 공시 본문 정량표 구조화 추출 (engine1)
-- ★Main Thesis A: 가장 풍부한 1차 정보원(document.xml 본문)의 자산화.
-- 기존 표 파싱 결과(parsedJson)를 표준 factKey로 정규화해 영구 적재하는 분석 자산.
-- AI 미개입(순수 Rule 정규화). 신규 외부 호출 0(이미 받은 XML 재활용).
-- 자연키 rcpNo 정합 (FK → disclosures). 멱등키 (rcpNo, factKey).
-- DisclosureDocument.rawText/tables 원본 보존 → 재처리 가능.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- CreateTable
CREATE TABLE "dart_filed_facts" (
    "id" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT,
    "sectionPath" TEXT,
    "docType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dart_filed_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dart_filed_facts_corpCode_idx" ON "dart_filed_facts"("corpCode");

-- CreateIndex
CREATE INDEX "dart_filed_facts_factKey_idx" ON "dart_filed_facts"("factKey");

-- CreateIndex
CREATE UNIQUE INDEX "dart_filed_facts_rcpNo_factKey_key" ON "dart_filed_facts"("rcpNo", "factKey");

-- AddForeignKey
ALTER TABLE "dart_filed_facts" ADD CONSTRAINT "dart_filed_facts_rcpNo_fkey" FOREIGN KEY ("rcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dart_filed_facts" ADD CONSTRAINT "dart_filed_facts_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
