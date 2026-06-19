// DAR-353: 현재가 헤더(QuoteHeader) + 폴링 게이팅 보조 순수 로직.
// RN 의존 없음·부수효과 없음 — tsc/진리표로 검증한다(check-quote-header.ts).
// 색 단독 의미 금지 규칙에 따라 출처/등락은 호출부에서 부호·라벨을 병행한다.

import type { StockQuote } from '@app-types/market-quote.types';

const KST_OFFSET_MIN = 9 * 60; // 한국 표준시 = UTC+9
const MARKET_OPEN_MIN = 9 * 60; // 09:00 KST
const MARKET_CLOSE_MIN = 15 * 60 + 30; // 15:30 KST(정규장 종료)

/**
 * 디바이스 TZ 와 무관하게 KST 벽시계(요일·자정 이후 분)를 산출한다(결정론).
 * epoch ms(now.getTime())는 TZ 독립이므로 +9h 후 getUTC* 로 읽으면 KST 가 된다.
 */
export function kstWallClock(now: Date): { day: number; minutes: number } {
  const kst = new Date(now.getTime() + KST_OFFSET_MIN * 60000);
  return {
    day: kst.getUTCDay(), // 0=일 … 6=토
    minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

/**
 * KRX 정규장(평일 09:00–15:30 KST) 개장 여부 — 폴링 on/off 게이트(배터리·비용 배려).
 * 공휴일 달력은 반영하지 않는다(베스트에포트). 휴장일 오폴링은 백엔드가 종가를 반환하므로
 * 데이터 정확성에는 영향이 없고, 낭비되는 호출 수만 소폭 증가한다.
 * ★정직: 디바이스 시계가 어긋나면 게이트도 어긋난다 — 출처 라벨이 이를 별도 고지한다.
 */
export function isKstMarketOpen(now: Date): boolean {
  const { day, minutes } = kstWallClock(now);
  if (day === 0 || day === 6) return false; // 주말 휴장
  return minutes >= MARKET_OPEN_MIN && minutes < MARKET_CLOSE_MIN;
}

/**
 * 마지막 갱신 경과를 초 단위로 평문화한다(현재가 헤더 '방금 / N초 전' 표기).
 * - updatedAt 미상/0(미갱신) → '' (표기 생략)
 * - 미래값(now 이전) → 0 으로 클램프(시계 괴리 시 음수 경과 방지)
 * - <5초 → '방금', <60초 → 'N초 전', <60분 → 'N분 전', 그 이상 → 'N시간 전'
 */
export function formatUpdatedAgo(updatedAt: number | null | undefined, now: number): string {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return '';
  const sec = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (sec < 5) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  return `${hr}시간 전`;
}

/**
 * 현재가 폴링 간격 게이트(DAR-353) — 화면 포커스 + 앱 활성 + 장중일 때만 폴링 간격을,
 * 그 외(포커스 이탈·백그라운드·장 마감·주말)엔 false(폴링 없음)를 돌려준다.
 * 배터리·비용 배려: 사용자가 보지 않거나 시세가 안 변하는 시간엔 자동갱신을 끈다.
 * useStockQuotes 의 refetchInterval 옵션에 그대로 넘긴다.
 */
export function resolveQuotePollInterval(opts: {
  isFocused: boolean;
  appActive: boolean;
  now: Date;
  intervalMs: number;
}): number | false {
  if (!opts.isFocused || !opts.appActive) return false;
  if (!isKstMarketOpen(opts.now)) return false;
  return opts.intervalMs;
}

/**
 * formatUpdatedAgo 의 현재시각 래퍼 — 렌더에서 Date.now 직접 호출을 피한다
 * (staleData.offlineStaleLabel·datetime.relativeTime 과 동일 idiom, react-hooks/purity).
 * 순수 검증은 formatUpdatedAgo(updatedAt, now) 로 한다.
 */
export function quoteUpdatedAgo(updatedAt: number | null | undefined): string {
  return formatUpdatedAgo(updatedAt, Date.now());
}

export interface QuoteSourceMeta {
  /** 배지 라벨 — '실시간'(REALTIME) | '종가'(DAILY). */
  label: string;
  isRealtime: boolean;
  /** ★정직: REALTIME 일 때 환경 시계 괴리 고지 문구. DAILY 면 null. */
  disclosure: string | null;
}

/**
 * 가격 출처 배지/고지 메타(DAR-353).
 * REALTIME 은 '실시간 시장가'로 표기하되, 환경(디바이스/서버) 시계가 어긋날 수 있음을
 * 함께 고지해 '실시간'을 절대시점으로 오인하지 않게 한다(정직 계약).
 */
export function quoteSourceMeta(source: StockQuote['source']): QuoteSourceMeta {
  if (source === 'REALTIME') {
    return {
      label: '실시간',
      isRealtime: true,
      disclosure: '실시간 시장가 · 환경 시계와 차이가 있을 수 있어요',
    };
  }
  return { label: '종가', isRealtime: false, disclosure: null };
}
