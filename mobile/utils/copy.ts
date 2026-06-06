// utils/copy.ts — 단일 평문 결론 상수 파일 (기획 §3-3)
// ⚠️ 이 파일의 모든 해석 문구는 컴플라이언스/법무 검토 대상입니다.
// 규칙: 점수·극성·등급에서 파생된 모든 "해석" 문구는 반드시 '(참고)' 꼬리표를 포함한다.
//       '(참고)' 미포함 문구 추가 시 PR 리뷰에서 차단(아래 assertParenthetical 가드로 런타임 __DEV__ 검증).
// 금지: 과신/FOMO 연출, 단정적 매수/매도 권유, 면책 약화.

// Buy Score 구간별 1줄 평문 — 항상 '(참고)' 포함
export const SCORE_ONE_LINER: Record<string, string> = {
  STRONG_BUY: '여러 조건이 두루 맞는 구간 (참고)',
  BUY: '관심을 가져볼 만한 수준 (참고)',
  WATCH: '아직 일부 조건이 부족한 구간 (참고)',
  NEUTRAL: '뚜렷한 방향성이 보이지 않는 구간 (참고)',
  AVOID: '현재로선 부정적 요인이 우세한 구간 (참고)',
  BLOCKED: '필수 조건 미충족으로 진입 부적합 (참고)',
  // 숫자 범위 기준 (grade 미지정 시 폴백)
  SCORE_80_PLUS: '여러 조건이 두루 맞는 구간 (참고)',
  SCORE_60_79: '관심을 가져볼 만한 수준 (참고)',
  SCORE_30_59: '아직 근거가 충분하지 않은 구간 (참고)',
  SCORE_0_29: '진입 근거가 약한 구간 (참고)',
};

// Exit Score 구간별 평문 — 항상 '(참고)' 포함
export const EXIT_SCORE_ONE_LINER: Record<string, string> = {
  EXIT: '청산 조건이 여럿 충족된 구간 (참고)',
  REDUCE: '일부 청산 검토 구간 (참고)',
  WATCH: '추이를 주의 깊게 볼 필요가 있는 구간 (참고)',
  HOLD: '현재 청산 사유가 뚜렷하지 않은 구간 (참고)',
};

// riskFlags → contextNote 변환 (위험 맥락 고지). 사실 고지이지만 '(참고)' 강제 대상.
export const RISK_CONTEXT_NOTE: Record<string, string> = {
  RECENT_SURGE: '이 신호는 최근 5거래일 급등 구간에서 생성됨 (참고)',
  LOW_SAMPLE: '과거 통계 표본이 적어 신뢰도가 제한적임 (참고)',
  EXPIRY_SOON: '신호 유효 기간이 얼마 남지 않음 (참고)',
  MARKET_VOLATILITY: '시장 변동성이 높은 구간에서 생성됨 (참고)',
  TRADING_HALT: '거래정지 이력이 있는 종목임 (참고)',
};

// '(참고)' 강제 가드 — __DEV__에서 모든 해석 카피가 꼬리표를 포함하는지 검증.
// eslint 커스텀 룰 도입 전, 회귀 시 즉시 드러나도록 런타임 자기검증.
if (__DEV__) {
  const tables: Record<string, Record<string, string>> = {
    SCORE_ONE_LINER,
    EXIT_SCORE_ONE_LINER,
    RISK_CONTEXT_NOTE,
  };
  for (const [tableName, table] of Object.entries(tables)) {
    for (const [key, value] of Object.entries(table)) {
      // 정밀도 강화(DAR-33): 단순 '참고'가 아닌 정확한 '(참고)' 꼬리표 형태를 검증.
      if (!value.includes('(참고)')) {
        // eslint-disable-next-line no-console
        console.warn(
          `[copy.ts] 해석 카피 '${tableName}.${key}'에 '(참고)' 꼬리표 누락: "${value}"`,
        );
      }
    }
  }
}
