/**
 * DAR-218 결정론적 검증: 'YYYYMMDD' → 'YYYY.MM.DD' 포맷 헬퍼 단일화.
 *
 * 종전엔 collection-status(formatTradeDate)·company 상세(formatEstDate)·
 * EventStudy 드릴다운(formatYmd)이 각자 slice(0,4)/slice(4,6)/slice(6,8)로 같은
 * 포맷을 재구현했고, 8자리 미만·null 폴백이 제각각('기록 없음' vs '-' vs 원문)이었다.
 * utils/filedFacts.formatDate 도 별도 regex 구현이었다.
 *
 * 해결: utils/datetime.formatYmdDots 단일 헬퍼(8자리 숫자 검증 + 일관 '-' 폴백)로 통일.
 *  - 정상 8자리 → 'YYYY.MM.DD'
 *  - null/undefined/빈문자열/8자리 미만/8자리 초과/비숫자 → 일관 '-'
 *  - filedFacts.formatFiledFactValue 는 구분자(YYYY-MM-DD)·비날짜 passthrough 를
 *    유지해야 하므로(회귀 방지), period 경로가 헬퍼 위임 후에도 동일 출력인지 확인.
 *
 * 실행: npx tsx scripts/check-format-ymd-dots.ts  (실패 시 exit 1)
 */
import { formatYmdDots } from '../utils/datetime.ts';
import { formatFiledFactValue } from '../utils/filedFacts.ts';
import type { FiledFact } from '../types/disclosure.types.ts';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// 1) formatYmdDots 진리표 — 정상/폴백 일관성
check('정상 8자리', formatYmdDots('20240115'), '2024.01.15');
check('정상 8자리(연말)', formatYmdDots('19991231'), '1999.12.31');
check('null → -', formatYmdDots(null), '-');
check('undefined → -', formatYmdDots(undefined), '-');
check('빈문자열 → -', formatYmdDots(''), '-');
check('8자리 미만 → -', formatYmdDots('2024011'), '-');
check('8자리 초과 → -', formatYmdDots('202401150'), '-');
check('비숫자 8자(이전엔 garbage) → -', formatYmdDots('2024-1-1'), '-');
check('구분자 포함(헬퍼는 거부) → -', formatYmdDots('2024.01.15'), '-');

// 2) filedFacts 회귀 방지 — period 경로가 헬퍼 위임 후에도 동일 출력 유지
function fact(over: Partial<FiledFact>): FiledFact {
  return {
    rcpNo: '0', corpCode: '0', factKey: 'X', value: '', numericValue: null,
    unit: null, period: null, sectionPath: null, docType: null, ...over,
  };
}
// period 8자리 → 점 포맷(헬퍼 경유)
check('fact period 8자리', formatFiledFactValue(fact({ period: '20240115' })), '2024.01.15');
// period 구분자 포함 → 정규화 후 점 포맷(회귀 없음: 여전히 포맷됨)
check('fact period YYYY-MM-DD', formatFiledFactValue(fact({ period: '2024-01-15' })), '2024.01.15');
check('fact period YYYY.MM.DD', formatFiledFactValue(fact({ period: '2024.01.15' })), '2024.01.15');
// period 비날짜 텍스트 → 원문 passthrough(회귀 없음)
check('fact period 비날짜 passthrough', formatFiledFactValue(fact({ period: '2024년 1분기' })), '2024년 1분기');
// 텍스트형(period 없음, value) → value 원문
check('fact value 텍스트 passthrough', formatFiledFactValue(fact({ value: '미공시' })), '미공시');

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
