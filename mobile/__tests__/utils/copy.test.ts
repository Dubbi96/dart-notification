import {
  EXIT_SCORE_ONE_LINER,
  RISK_CONTEXT_NOTE,
  SCORE_ONE_LINER,
} from '@utils/copy';

// 해석 카피 컴플라이언스 가드(기획 §3-3) — 모든 점수/극성 파생 문구는 '(참고)' 꼬리표 필수.
describe('utils/copy — (참고) 꼬리표 컴플라이언스', () => {
  it("점수·청산·리스크 해석 카피 전수가 '(참고)' 를 포함한다", () => {
    const tables = { SCORE_ONE_LINER, EXIT_SCORE_ONE_LINER, RISK_CONTEXT_NOTE };
    for (const [tableName, table] of Object.entries(tables)) {
      for (const [key, value] of Object.entries(table)) {
        // 실패 메시지에 위치를 남기기 위해 커스텀 매처 대신 문자열 조립로 검증.
        expect(`${tableName}.${key}:${value.includes('(참고)')}`).toBe(
          `${tableName}.${key}:true`,
        );
      }
    }
  });

  it('Buy Score 등급 구간(STRONG_BUY~BLOCKED)과 숫자 폴백 구간이 모두 정의돼 있다', () => {
    for (const grade of ['STRONG_BUY', 'BUY', 'WATCH', 'NEUTRAL', 'AVOID', 'BLOCKED']) {
      expect(SCORE_ONE_LINER[grade]).toBeDefined();
    }
    for (const range of ['SCORE_80_PLUS', 'SCORE_60_79', 'SCORE_30_59', 'SCORE_0_29']) {
      expect(SCORE_ONE_LINER[range]).toBeDefined();
    }
  });
});
