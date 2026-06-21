-- DAR-402: EventStudy 평균 이상치 오염 — robust 통계(median/winsorized) 컬럼 추가.
--
-- 배경(실측, 2026-06-21): event_study_results 의 산술평균(avgArD20)이 유동성 낮은 KOSDAQ
--    소형주의 극단 양 이상치에 지배돼 거짓 매수신호를 만든다. 예) SUPPLY_CONTRACT __ALL__ ALL:
--    avgArD20=+24.91% 인데 tStatistic=-2.23(D+1 기준·음수)·avgArD5=-0.51. 백테스트(point-in-time)는
--    SUPPLY_CONTRACT avgReturn=-4.2% 로 현실 확인. 중앙값/winsorized 평균은 음수로 남아 오염을 표면화한다.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): nullable Float 컬럼 4개만 추가한다. 기존 행은 재계산(POST /event-study/calculate)
--    전까지 NULL 로 남고, 신호 스코어러는 NULL 일 때 산술평균(avgArD5)으로 폴백한다(회귀 0).
--    재계산 후 winsorized 평균이 event edge 입력으로 쓰인다.

-- D+5 누적 AR 중앙값.
ALTER TABLE "event_study_results" ADD COLUMN "medianArD5" DOUBLE PRECISION;
-- D+20 누적 AR 중앙값.
ALTER TABLE "event_study_results" ADD COLUMN "medianArD20" DOUBLE PRECISION;
-- D+5 누적 AR winsorized 평균(5%/95% clip).
ALTER TABLE "event_study_results" ADD COLUMN "winsorizedMeanArD5" DOUBLE PRECISION;
-- D+20 누적 AR winsorized 평균(5%/95% clip).
ALTER TABLE "event_study_results" ADD COLUMN "winsorizedMeanArD20" DOUBLE PRECISION;
