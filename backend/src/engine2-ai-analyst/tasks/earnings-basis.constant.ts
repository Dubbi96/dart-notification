// backend/src/engine2-ai-analyst/tasks/earnings-basis.constant.ts
// W9 정직 라벨링 SSOT — 실적 판정 기준 명시 지시문 (4개 Task system prompt 공통 첨부).
//
// 배경: EARNINGS_SURPRISE/EARNINGS_SHOCK 산출(engine1 extractors/earnings.ts)은
//   전년동기(YoY) 대비 기준(±20% 임계)이고, EARNINGS_GUIDANCE 는 회사가 스스로
//   공시한 전망(자사 가이던스)이다. 우리 데이터에는 애널리스트 추정 집계 축이
//   없으므로, AI 산출 카피가 '시장 기대치 대비 서프라이즈'로 오인시키면
//   대형주 실적시즌에 시장 판정과 부호가 어긋날 때 알림 신뢰가 직접 훼손된다.
//   → 모든 실적 관련 서술에 기준을 명시하고, 시장 기대치 대비 표현을 금지한다.
export const EARNINGS_BASIS_GUIDE =
  '실적 판정 기준(필수 준수): EARNINGS_SURPRISE(실적 서프라이즈)·EARNINGS_SHOCK(실적 쇼크)의 판정과 증감률 수치는 전년동기(YoY) 대비 기준이다. ' +
  'EARNINGS_GUIDANCE(실적 가이던스)는 회사가 스스로 공시한 전망(자사 전망)이다. ' +
  '실적 관련 서술에는 이 기준(전년동기 대비/자사 전망)을 명시하고, 시장 기대치·증권가 추정치·애널리스트 전망 대비인 것처럼 서술하지 마라.';
