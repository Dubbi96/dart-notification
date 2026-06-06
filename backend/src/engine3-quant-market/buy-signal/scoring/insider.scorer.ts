/**
 * C8. 내부자·대량보유 동향 점수 (InsiderScore) — DAR-88
 *
 * 적재만 되고 소비처가 0이던 InsiderHoldingChange 를 매수신호에 종단 연결한다.
 *   - 내부자(임원·주요주주) 순매수 → 가점 (자기회사 저평가 확신 신호).
 *   - 대량매도(특히 5%·주요주주 처분) → 감점.
 *   - 방향 불명(MIXED/UNKNOWN)·결측 → 0 안전 처리(무가점).
 *
 * AI 금지영역: 순수 Rule 함수. AI/LLM 개입 절대 금지.
 */

/** 최근 윈도우 내 단일 지분변동 보고(스코어 입력용 정규화 형태). */
export interface InsiderTradeInput {
  /** 'EXECUTIVE'(임원·주요주주) | 'MAJOR_STOCK'(5% 대량보유) */
  source: 'EXECUTIVE' | 'MAJOR_STOCK';
  /** 'BUY'(취득) | 'SELL'(처분) | 'MIXED' | 'UNKNOWN' */
  tradeType: 'BUY' | 'SELL' | 'MIXED' | 'UNKNOWN';
  /** 지분율 증감(%p, 부호 포함, 결측 가능) — 매매 규모 가늠. */
  ratioChange: number | null;
  /** 주요주주 보고 여부(대량매도 가중 판단). */
  isMajorShareholder?: boolean | null;
}

export interface InsiderInput {
  /** 최근 윈도우(예: 90일) 내 지분변동 보고 목록. 빈 배열이면 결측(0점·재정규화 제외). */
  trades: InsiderTradeInput[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 내부자 순매수 가점·대량매도 감점 합산 점수(-100..100).
 * 보고 단위로 가산하되, 임원(EXECUTIVE) 매매에 더 큰 가중을 주고,
 * 유의미한 지분율 규모(|Δ%p|≥1)와 주요주주 처분에 추가 가중을 준다.
 */
export function scoreInsider(input: InsiderInput): number {
  const trades = input?.trades ?? [];
  if (trades.length === 0) return 0; // 결측 → 중립(재정규화에서 제외됨)

  let score = 0;
  for (const t of trades) {
    const ratioMag = t.ratioChange != null ? Math.abs(t.ratioChange) : null;
    const sizable = ratioMag != null && ratioMag >= 1; // 지분율 1%p 이상 변동 = 유의 규모

    if (t.tradeType === 'BUY') {
      // 임원 매수가 가장 강한 긍정 신호. 5% 대량보유 매수는 그보다 약하게.
      let pts = t.source === 'EXECUTIVE' ? 25 : 15;
      if (sizable) pts += 10;
      score += pts;
    } else if (t.tradeType === 'SELL') {
      // 처분은 부정 신호. 임원 처분 > 5% 처분, 대량·주요주주 처분에 가중 감점.
      let pts = t.source === 'EXECUTIVE' ? 30 : 20;
      if (sizable) pts += 15;
      if (t.isMajorShareholder) pts += 10;
      score -= pts;
    }
    // MIXED/UNKNOWN: 방향 불명 → 무가점(안전 처리).
  }

  return clamp(score, -100, 100);
}
