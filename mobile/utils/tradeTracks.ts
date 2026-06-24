// DAR-431: 체결 알림 5+1 트랙 SSOT(순수 모듈, RN 비의존 — 결정론 체크 대상).
//
// 사용자 피드백: 체결 알림이 단타·시스템 모의·전략(4종) 중 어느 트랙인지 분리 확인이 안 됐다.
// 각 트랙의 식별키(strategyKey)·표시 라벨·딥링크를 한곳에서 정의해 BE 발행 상수
// (IntradayScalpService / PaperSimulationService / STRATEGY_PRESETS)와 개념적으로 정렬한다.
//
//   - 단타(intraday-scalp): 라이브 forward 모의 — `/portfolio/strategy/intraday-scalp`
//   - 4전략(event-edge 등): 격리 백테스트 트랙 — `/portfolio/strategy/<key>`
//       (★백테스트라 실시간 체결 알림은 발행되지 않는다. 드릴다운 조회용 경로만 정의.)
//   - 시스템 모의(paper-simulation): 엔진 일일 사이클 가상 운용 — `/portfolio?tab=sim`
//
// 딥링크는 모두 @utils/deeplink 화이트리스트(`/portfolio` prefix)를 통과한다.

export type TradeTrackKey =
  | 'intraday-scalp'
  | 'event-edge'
  | 'short-momentum'
  | 'conservative-value'
  | 'aggressive-diversified'
  | 'paper-simulation';

export interface TradeTrackDef {
  key: TradeTrackKey;
  /** 알림 제목 prefix·필터 칩에 쓰는 표시 라벨(예: '분봉 단타'). */
  label: string;
  /** 인앱 딥링크(해당 트랙 화면). 화이트리스트 통과 경로. */
  deepLink: string;
  /** true = 라이브 체결 알림을 발행(단타·시스템 모의) / false = 백테스트 전용(4전략). */
  emitsTradeNotifications: boolean;
}

export const TRADE_TRACKS: readonly TradeTrackDef[] = [
  {
    key: 'intraday-scalp',
    label: '분봉 단타',
    deepLink: '/portfolio/strategy/intraday-scalp',
    emitsTradeNotifications: true,
  },
  {
    key: 'paper-simulation',
    label: '시스템 모의',
    deepLink: '/portfolio?tab=sim',
    emitsTradeNotifications: true,
  },
  {
    key: 'event-edge',
    label: '이벤트 엣지',
    deepLink: '/portfolio/strategy/event-edge',
    emitsTradeNotifications: false,
  },
  {
    key: 'short-momentum',
    label: '단기 모멘텀',
    deepLink: '/portfolio/strategy/short-momentum',
    emitsTradeNotifications: false,
  },
  {
    key: 'conservative-value',
    label: '보수 가치',
    deepLink: '/portfolio/strategy/conservative-value',
    emitsTradeNotifications: false,
  },
  {
    key: 'aggressive-diversified',
    label: '공격 분산',
    deepLink: '/portfolio/strategy/aggressive-diversified',
    emitsTradeNotifications: false,
  },
];

const BY_KEY: Record<string, TradeTrackDef> = Object.fromEntries(
  TRADE_TRACKS.map((t) => [t.key, t]),
);

/** strategyKey(체결 알림 push data) → 트랙 정의. 미지정/미지원은 null. */
export function trackByKey(key: unknown): TradeTrackDef | null {
  return typeof key === 'string' ? (BY_KEY[key] ?? null) : null;
}

/**
 * deepLink → 트랙 정의 도출(DAR-431). 인박스 알림은 strategyKey 가 없을 수 있어
 * deepLink 로도 트랙을 식별한다. 매칭 실패 시 null(트랙 라벨 미표시).
 *   - `/portfolio?tab=sim`        → paper-simulation
 *   - `/portfolio/strategy/<key>` → 해당 key 트랙
 */
export function trackByDeepLink(deepLink: unknown): TradeTrackDef | null {
  if (typeof deepLink !== 'string' || deepLink.length === 0) return null;
  const [path, query = ''] = deepLink.split('?');
  if (path === '/portfolio') {
    const tab = new URLSearchParams(query).get('tab');
    return tab === 'sim' ? BY_KEY['paper-simulation'] : null;
  }
  const m = /^\/portfolio\/strategy\/([^/?]+)/.exec(path);
  return m ? (BY_KEY[m[1]] ?? null) : null;
}
