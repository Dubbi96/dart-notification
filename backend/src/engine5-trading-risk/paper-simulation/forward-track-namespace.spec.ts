/**
 * forward-track-namespace.spec.ts — forward 트랙 네임스페이스 순수 Rule 검증 (개장 체결 정렬)
 *
 * 고정 항목:
 *  - 이름 규약 파서(styleTagForForwardPortfolioName): 시스템/철학/전략 화이트리스트 + 미상 스킵(null)
 *  - 트랙별 초기원금·exit 파라미터 오버라이드(전략=프리셋 정본, 그 외 null)
 *  - 체결 알림 메타(strategyKey=styleTag 그대로 · 라벨/딥링크 트랙별 · 시스템 상수 동치 봉인)
 *  - PAPER_SIM_STYLE_TAG/STYLE_PORTFOLIO_PREFIX 가 서비스 정본 상수와 동치(드리프트 차단)
 * ★순수 함수 — I/O·AI 0.
 */
import {
  PAPER_SIM_STYLE_TAG,
  STRATEGY_TAG_PREFIX,
  FORWARD_TRACK_INITIAL_CAPITAL,
  strategyStyleTag,
  strategyForwardPortfolioName,
  styleTagForForwardPortfolioName,
  initialCapitalForStyleTag,
  exitParamsForStyleTag,
  trackNotificationMeta,
  kstMidnightOf,
} from './forward-track-namespace';
import { PaperSimulationService } from './paper-simulation.service';
import { STYLE_PORTFOLIO_PREFIX, stylePortfolioName } from './philosophy-style';
import { STRATEGY_INITIAL_CAPITAL } from '../../engine3-quant-market/backtest/strategies/strategy-presets';

describe('forward-track-namespace (개장 체결 정렬, 2026-07-06)', () => {
  it('상수 동치 봉인 — 서비스 정본과 드리프트 없음', () => {
    expect(PAPER_SIM_STYLE_TAG).toBe(PaperSimulationService.TRADE_STRATEGY_KEY);
    expect(STYLE_PORTFOLIO_PREFIX).toBe(PaperSimulationService.SIM_PORTFOLIO_NAME);
    expect(FORWARD_TRACK_INITIAL_CAPITAL).toBe(PaperSimulationService.INITIAL_CAPITAL);
    expect(STRATEGY_TAG_PREFIX).toBe('strategy:');
  });

  describe('styleTagForForwardPortfolioName — 이름 규약 파서(화이트리스트)', () => {
    it('시스템 모의 → paper-simulation', () => {
      expect(styleTagForForwardPortfolioName('모의운용 포트폴리오')).toBe('paper-simulation');
    });

    it('철학 4종 — [BUFFETT] 등 화이트리스트만', () => {
      expect(styleTagForForwardPortfolioName(stylePortfolioName('BUFFETT'))).toBe('BUFFETT');
      expect(styleTagForForwardPortfolioName('모의운용 포트폴리오 [LYNCH]')).toBe('LYNCH');
      expect(styleTagForForwardPortfolioName('모의운용 포트폴리오 [GREENBLATT]')).toBe(
        'GREENBLATT',
      );
      expect(styleTagForForwardPortfolioName('모의운용 포트폴리오 [DRUCKENMILLER]')).toBe(
        'DRUCKENMILLER',
      );
    });

    it('전략 forward — 프리셋 키 존재 검증 후 strategy:<key>', () => {
      expect(styleTagForForwardPortfolioName(strategyForwardPortfolioName('event-edge'))).toBe(
        'strategy:event-edge',
      );
      expect(
        styleTagForForwardPortfolioName('모의운용 포트폴리오 [strategy:short-momentum]'),
      ).toBe('strategy:short-momentum');
    });

    it('도출 불가한 이름은 null(스킵·안전) — 코어 alloc:*·미상 스타일·미상 프리셋·무관 이름', () => {
      expect(
        styleTagForForwardPortfolioName('모의운용 포트폴리오 [alloc:dual-momentum]'),
      ).toBeNull();
      expect(styleTagForForwardPortfolioName('모의운용 포트폴리오 [SOROS]')).toBeNull();
      expect(styleTagForForwardPortfolioName('모의운용 포트폴리오 [strategy:nope]')).toBeNull();
      expect(styleTagForForwardPortfolioName('내 포트폴리오')).toBeNull();
      expect(styleTagForForwardPortfolioName('다른 접두사 [BUFFETT]')).toBeNull();
    });
  });

  describe('initialCapitalForStyleTag — 트랙별 초기원금', () => {
    it('시스템·철학 = 공통 10M, 전략 = STRATEGY_INITIAL_CAPITAL', () => {
      expect(initialCapitalForStyleTag('paper-simulation')).toBe(
        PaperSimulationService.INITIAL_CAPITAL,
      );
      expect(initialCapitalForStyleTag('BUFFETT')).toBe(PaperSimulationService.INITIAL_CAPITAL);
      expect(initialCapitalForStyleTag('strategy:event-edge')).toBe(STRATEGY_INITIAL_CAPITAL);
    });
  });

  describe('exitParamsForStyleTag — 전략만 프리셋 exitRules 정본', () => {
    it('전략 트랙 = 프리셋 대입값(부호 정규화)', () => {
      expect(exitParamsForStyleTag('strategy:short-momentum')).toEqual({
        stopLossPct: 5,
        takeProfitPct: 10,
        maxHoldDays: 5,
      });
      expect(exitParamsForStyleTag('strategy:event-edge')).toEqual({
        stopLossPct: 10,
        takeProfitPct: 20,
        maxHoldDays: 20,
      });
    });

    it('시스템·철학·미상 전략 키 = null(체결기 thesis 파생 폴백)', () => {
      expect(exitParamsForStyleTag('paper-simulation')).toBeNull();
      expect(exitParamsForStyleTag('BUFFETT')).toBeNull();
      expect(exitParamsForStyleTag('strategy:nope')).toBeNull();
    });
  });

  describe('trackNotificationMeta — strategyKey=styleTag 그대로 + 트랙별 라벨/딥링크', () => {
    it('시스템 모의 = 기존 상수와 완전 동치(M10 무변경 봉인)', () => {
      expect(trackNotificationMeta('paper-simulation')).toEqual({
        strategyKey: PaperSimulationService.TRADE_STRATEGY_KEY,
        strategyLabel: PaperSimulationService.TRADE_STRATEGY_LABEL,
        deepLink: PaperSimulationService.TRADE_DEEP_LINK,
      });
    });

    it('철학 스타일 = 한글 라벨 + style 서브탭 딥링크', () => {
      expect(trackNotificationMeta('BUFFETT')).toEqual({
        strategyKey: 'BUFFETT',
        strategyLabel: '버핏',
        deepLink: '/portfolio?tab=style',
      });
      expect(trackNotificationMeta('DRUCKENMILLER').strategyLabel).toBe('드러켄밀러');
    });

    it('전략 forward = 프리셋 라벨 + strategy 서브탭 딥링크(strategyKey 는 styleTag 그대로)', () => {
      expect(trackNotificationMeta('strategy:event-edge')).toEqual({
        strategyKey: 'strategy:event-edge',
        strategyLabel: '이벤트엣지',
        deepLink: '/portfolio?tab=strategy',
      });
    });

    it('미상 styleTag = 정직 폴백(styleTag 라벨 + 포트폴리오 루트)', () => {
      expect(trackNotificationMeta('alloc:dual-momentum')).toEqual({
        strategyKey: 'alloc:dual-momentum',
        strategyLabel: 'alloc:dual-momentum',
        deepLink: '/portfolio',
      });
    });
  });

  it('strategyStyleTag/strategyForwardPortfolioName — 네임스페이스 규약 유지(기존 계약)', () => {
    expect(strategyStyleTag('event-edge')).toBe('strategy:event-edge');
    expect(strategyForwardPortfolioName('event-edge')).toBe(
      '모의운용 포트폴리오 [strategy:event-edge]',
    );
  });

  it('kstMidnightOf — YYYYMMDD → KST 자정 절대시각(예약 entryDate 규약)', () => {
    expect(kstMidnightOf('20260706').toISOString()).toBe('2026-07-05T15:00:00.000Z');
  });
});
