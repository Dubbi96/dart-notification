import type { MarketIndexQuote } from '@app-types/market.types';

import { formatYmdDots } from './datetime';

/**
 * 시장지수 배지 신선도 라벨 (DAR-371, 순수 함수).
 *
 * 배경: 홈 '시장 한눈에' 배지가 EOD(일봉 종가) 값을 날짜 라벨 없이 표시해 사용자가 stale
 *   (예: 6/5 종가 8160)을 '현재'로 오인했다('정확한 정보 아니면 신뢰성 문제'). 출처별로
 *   정직한 기준 라벨을 만든다.
 *
 * - REALTIME(KIS 실시간 지수): '실시간' — 현재 시장 실가.
 * - EOD(KRX 일봉 종가) 또는 출처 미상(구버전 응답): 'YYYY.MM.DD 종가' — 기준 거래일 명시로
 *   '현재' 오인을 차단(앱 공통 날짜 포맷 formatYmdDots 사용).
 */
export interface IndexBasis {
  /** 배지에 표시할 짧은 라벨. */
  label: string;
  /** 실시간 출처 여부(라벨 색/아이콘 분기용). */
  isRealtime: boolean;
  /** 스크린리더용 풀 라벨('… 종가 기준' / '실시간 지수'). */
  a11y: string;
}

export function indexBasisLabel(
  quote: Pick<MarketIndexQuote, 'source' | 'tradeDate'>,
): IndexBasis {
  if (quote.source === 'REALTIME') {
    return { label: '실시간', isRealtime: true, a11y: '실시간 지수' };
  }
  // EOD 또는 출처 미상(구버전) → 종가 기준일 명시(정직 폴백).
  const dotted = formatYmdDots(quote.tradeDate);
  return { label: `${dotted} 종가`, isRealtime: false, a11y: `${dotted} 종가 기준` };
}
