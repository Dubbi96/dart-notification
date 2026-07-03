// Engine5 — RiskGuardService: 공용 진입 게이트 오케스트레이션 (M11 견고화 W2·P18, DAR-496)
//
// AI 금지영역: 판정은 순수 게이트(risk-guard-gate.ts). 이 서비스는 영속·알림만 담당한다.
//   AI/LLM/engine2 import 절대 0 (risk-guard 훅이 차단).
//
// 역할(진입 확정 직전 1줄 호출로 소비):
//   1) 트랙 모드 해석(resolveRiskGuardMode — 환경변수 오버라이드 지원, 기본 측정 SHADOW/코어 ENFORCE)
//   2) 순수 게이트 판정(evaluateRiskGuardEntry)
//   3) RiskDecisionLog 영속(fire-and-forget·graceful — 판정/차단 로직에 영향 0)
//   4) 위반 시 OPS_ALERT(SHADOW=일 1회 dedupe 요약, ENFORCE BLOCK=즉시)
//   5) 판정(Decision) 반환 — 호출측은 action==='BLOCK' 일 때만 진입을 건너뛴다.
//
// ★SHADOW 트랙은 게이트가 절대 BLOCK 을 반환하지 않으므로(순수 함수 불변식) 진입 흐름 무변경.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import {
  evaluateRiskGuardEntry,
  evaluateDrawdownCut,
  resolveRiskGuardMode,
  RiskGuardDecision,
  RiskGuardTrack,
} from '../domain/risk-guard-gate';
// DAR-502(견고화 W2·P20): 자동 킬스위치 발동 조건 SHADOW 계측 — 순수 판정(checkAutoKill) +
//   입력 산출 순수 함수(auto-kill-inputs). activate() 절대 미호출(이 서비스는 KillSwitchManager
//   참조 자체가 없다 = 구조적으로 발동 불가능). 30일 계측 후 ENFORCE 전환은 P23 소관.
import {
  checkAutoKill,
  AutoKillCheckInput,
  AutoKillResult,
} from '../domain/kill-switch';
import {
  countConsecutiveLosses,
  computeMarketDropPct,
  SHADOW_AUTO_KILL_CONDITIONS,
} from '../domain/auto-kill-inputs';
import { DEFAULT_AUTO_KILL_CONDITIONS } from '../domain/risk-check.types';

/** 호출측이 넘기는 진입 컨텍스트(모드는 서비스가 트랙에서 해석). */
export interface RiskGuardEvaluateInput {
  track: RiskGuardTrack;
  tradeDate: string; // 판정 거래일 YYYYMMDD (dedupe 버킷)
  totalCapital: number;
  dailyRealizedPnl: number;
  /** 당월(KST 캘린더 월) 실현손익 합계 — 월간 손실 한도(MONTHLY_LOSS) 판정용(P21·DAR-501). 미제공 시 룰 스킵. */
  monthlyRealizedPnl?: number;
  availableCash: number;
  entryBudget: number;
  killSwitchActive?: boolean;
  corpCode?: string;
  stockCode?: string;
}

/** 드로다운 컷 평가 컨텍스트(DAR-497 [견고화 W2·P19]) — 일일 사이클 총자산 산출 직후 호출. */
export interface RiskGuardDrawdownEvaluateInput {
  track: RiskGuardTrack;
  /** 트랙 하위 포트폴리오 ID — HWM 영속 자연키(철학/전략 forward 는 4종 각각). */
  portfolioId: string;
  tradeDate: string; // 관측 거래일 YYYYMMDD
  /** 현재 총자산(현금 + 평가). HWM 갱신·드로다운 판정 기준. */
  currentEquity: number;
  killSwitchActive?: boolean;
}

/** 드로다운 컷 판정 결과 — 게이트 판정 + 갱신된 고점·드로다운%. */
export interface RiskGuardDrawdownResult extends RiskGuardDecision {
  /** 갱신 후 계좌 고점(총자산). */
  highWaterMark: number;
  /** 고점 대비 드로다운(음수%, 신고점이면 0). */
  drawdownPct: number;
}

/** 자동 킬스위치 SHADOW 계측 컨텍스트 (DAR-502 [견고화 W2·P20]) — 사이클/장중 훅이 넘긴다. */
export interface RiskGuardAutoKillInput {
  track: RiskGuardTrack;
  tradeDate: string; // 판정 거래일 YYYYMMDD (일 1회 dedupe·멱등 버킷)
  /**
   * 연속손실 산출 소스:
   *   - 'paper-trade': PaperTrade 청산(SELL·FILLED) 시계열(단일 시뮬=styleTag null).
   *   - 'intraday-scalp': IntradayScalpTrade 청산(exitTs 존재) 시계열.
   */
  lossSource: 'paper-trade' | 'intraday-scalp';
  /** paper-trade 소스에서 트랙 하위 styleTag 필터(단일 시뮬=null). */
  styleTag?: string | null;
  /** 킬스위치 현재 상태(관측용 meta — 판정에는 미사용). */
  killSwitchActive?: boolean;
}

/** 자동 킬스위치 SHADOW 계측 결과 — 순수 권고 + 산출된 raw 입력(관측용). */
export interface RiskGuardAutoKillResult {
  /** checkAutoKill 권고(발동 여부·트리거·사유). ★SHADOW: 기록/알림만 — activate() 미호출. */
  advice: AutoKillResult;
  /** 산출된 raw 입력(연속손실·시장급락·API오류) — P23 사후 임계 결정용으로 전량 기록. */
  inputs: AutoKillCheckInput;
}

@Injectable()
export class RiskGuardService {
  private readonly logger = new Logger(RiskGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Optional — 큐/모듈 미주입(단위 테스트)에서도 안전. 위반 통지용.
    @Optional() private readonly notifyProducer?: NotificationProducerService,
  ) {}

  /**
   * evaluateEntry — 진입 확정 직전 1줄 호출. 순수 게이트 판정 후 영속·알림을 수행하고 판정을 반환.
   *   호출측은 `if (decision.action === 'BLOCK') { 진입 스킵 }` 만 하면 된다.
   *   ★SHADOW 트랙은 BLOCK 이 나오지 않으므로 매매 행동 무변경(M10 클록 보호).
   */
  async evaluateEntry(input: RiskGuardEvaluateInput): Promise<RiskGuardDecision> {
    const mode = resolveRiskGuardMode(input.track);
    const decision = evaluateRiskGuardEntry({
      track: input.track,
      mode,
      totalCapital: input.totalCapital,
      dailyRealizedPnl: input.dailyRealizedPnl,
      monthlyRealizedPnl: input.monthlyRealizedPnl,
      availableCash: input.availableCash,
      entryBudget: input.entryBudget,
      killSwitchActive: input.killSwitchActive,
      corpCode: input.corpCode,
      stockCode: input.stockCode,
    });

    // 영속·알림은 부수효과 — 실패해도 판정/진입 흐름에 영향 0(graceful).
    await this.persist(input, decision);
    if (!decision.allowed) {
      await this.alert(input, decision);
    }

    return decision;
  }

  /**
   * evaluateDrawdownCut — 일일 사이클 총자산 산출 직후 1줄 호출(DAR-497 [견고화 W2·P19]).
   *   ① 계좌 고점(HWM) forward-only 갱신(최초 관측=현재 총자산, 과거 소급 금지) →
   *   ② 순수 드로다운 컷 판정(고점 대비 −15% 이하 = DRAWDOWN_CUT) →
   *   ③ RiskDecisionLog 영속(graceful) →
   *   ④ 위반 시 알림: **SHADOW=OPS_ALERT(일 1회 dedupe·차단 0)** · **ENFORCE BLOCK=알림 없음**
   *      (킬스위치 발동이 P02 RISK_ALERT 를 단독 발행 — 중복 발송 방지) →
   *   ⑤ 판정 + 고점·드로다운% 반환.
   *
   * ★코어(ENFORCE) BLOCK 시 실제 킬스위치 REDUCE_ONLY 발동은 **호출측(코어 forward 서비스)** 소관이다
   *   (KillSwitchManager 를 주입받은 트랙이 소유 — 서비스 결합 최소화). SHADOW 트랙은 BLOCK 이 나오지
   *   않으므로(순수 함수 불변식) 매매 행동 무변경(M10 클록 보호).
   */
  async evaluateDrawdownCut(
    input: RiskGuardDrawdownEvaluateInput,
  ): Promise<RiskGuardDrawdownResult> {
    // ① 고점 forward-only 갱신(graceful — 실패 시 현재 총자산을 고점으로 폴백해 판정 자체는 진행).
    const highWaterMark = await this.upsertHighWaterMark(input);

    // ② 순수 판정.
    const mode = resolveRiskGuardMode(input.track);
    const decision = evaluateDrawdownCut({
      track: input.track,
      mode,
      highWaterMark,
      currentEquity: input.currentEquity,
      killSwitchActive: input.killSwitchActive,
    });
    const dd = decision.violations[0]?.details?.drawdownPct;
    const drawdownPct =
      typeof dd === 'number'
        ? dd
        : highWaterMark > 0
          ? Math.min(0, ((input.currentEquity - highWaterMark) / highWaterMark) * 100)
          : 0;

    // ③ 영속(graceful) + ④ 알림 라우팅.
    await this.persistDrawdown(input, decision, highWaterMark, drawdownPct);
    if (!decision.allowed) {
      await this.alertDrawdown(input, decision);
    }

    return { ...decision, highWaterMark, drawdownPct };
  }

  /**
   * evaluateAutoKillShadow — 자동 킬스위치 발동 조건 SHADOW 계측(DAR-502 [견고화 W2·P20]).
   *   일일 사이클(측정 트랙)·장중 모니터에서 스냅샷 직후 1줄 호출(P19 관측 삽입 패턴 준용).
   *
   *   ① 입력 산출(graceful — 개별 조회 실패는 0 폴백해 판정 진행):
   *      연속손실(청산 시계열)·시장급락(MarketIndex)·API오류(CronRunLog FAILED 집계).
   *   ② 순수 판정 checkAutoKill(입력, **frozen DEFAULT 조건** — 임계 무변경) →
   *   ③ 멱등 기록: RiskDecisionLog(meta.kind='AUTO_KILL_ADVICE', track+tradeDate 1행,
   *      당일 에스컬레이션 시만 갱신) — raw 입력 전량 보존(P23 사후 임계 결정용) →
   *   ④ 발동 권고 시 OPS_ALERT(일 1회 dedupe) →
   *   ⑤ 결과 반환.
   *
   * ★핵심 불변식(요건2·DoD 항목5 — SHADOW 중립성): **activate() 를 절대 호출하지 않는다.**
   *   본 서비스는 KillSwitchManager 참조 자체가 없어 구조적으로 발동이 불가능하다(측정 기간 중
   *   발동 금지 — 오탐률 검증 전). 코어 forward 도 이 이슈에서는 SHADOW 기록만(P19 드로다운 컷이
   *   이미 ENFORCE 이므로 자동킬 조건의 오탐률 검증 전까지 자동킬 발동은 보류). 권고는 사이클 산출·
   *   매매 행동에 영향 0(관측 부수효과·graceful). 30일 계측 후 ENFORCE 전환=P23(졸업 후 사용자 승인).
   */
  async evaluateAutoKillShadow(
    input: RiskGuardAutoKillInput,
  ): Promise<RiskGuardAutoKillResult> {
    // ① 입력 산출.
    const consecutiveLossCount = await this.deriveConsecutiveLosses(input);
    const marketDropPct = await this.deriveMarketDropPct();
    const apiErrorCount = await this.deriveApiErrorCount();
    const inputs: AutoKillCheckInput = {
      consecutiveLossCount,
      marketDropPct,
      apiErrorCount,
    };

    // ② 순수 판정 — frozen DEFAULT 조건(=SHADOW_AUTO_KILL_CONDITIONS). 임계 무변경.
    const advice = checkAutoKill(inputs, SHADOW_AUTO_KILL_CONDITIONS);

    // ③ 멱등 기록 + ④ 알림 — 부수효과(graceful). activate() 미호출(구조적).
    await this.persistAutoKillAdvice(input, inputs, advice);
    if (advice.shouldKill) {
      await this.alertAutoKill(input, advice);
    }

    return { advice, inputs };
  }

  /**
   * deriveConsecutiveLosses — 트랙별 최근 청산 시계열에서 연속 손실 횟수 산출.
   *   조회 실패 시 0 폴백(안전 측 — 오탐 방지). 순수 카운트는 countConsecutiveLosses 위임.
   */
  private async deriveConsecutiveLosses(
    input: RiskGuardAutoKillInput,
  ): Promise<number> {
    try {
      if (input.lossSource === 'intraday-scalp') {
        const rows = await this.prisma.intradayScalpTrade.findMany({
          where: { exitTs: { not: null }, netPnl: { not: null } },
          orderBy: { exitTs: 'desc' },
          take: 30,
          select: { netPnl: true },
        });
        return countConsecutiveLosses(rows.map((r) => Number(r.netPnl)));
      }
      // paper-trade: 청산(SELL) 체결 시계열. styleTag null=단일 시뮬(측정 트랙).
      const rows = await this.prisma.paperTrade.findMany({
        where: {
          direction: 'SELL',
          status: 'FILLED',
          styleTag: input.styleTag ?? null,
          netPnl: { not: null },
        },
        orderBy: { filledAt: 'desc' },
        take: 30,
        select: { netPnl: true },
      });
      return countConsecutiveLosses(rows.map((r) => Number(r.netPnl)));
    } catch (e) {
      this.logger.error(
        `[AutoKill] 연속손실 산출 실패(0 폴백): ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * deriveMarketDropPct — 대표 지수(KOSPI '0001') 최근 2행으로 변동율 산출.
   *   조회 실패 시 0 폴백(급락 미감지). 순수 산정은 computeMarketDropPct 위임.
   */
  private async deriveMarketDropPct(): Promise<number> {
    try {
      const rows = await this.prisma.marketIndex.findMany({
        where: { indexCode: '0001' }, // KOSPI
        orderBy: { tradeDate: 'desc' },
        take: 2,
        select: { closeIndex: true, openIndex: true },
      });
      return computeMarketDropPct(rows);
    } catch (e) {
      this.logger.error(
        `[AutoKill] 시장급락율 산출 실패(0 폴백): ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * deriveApiErrorCount — 최근 24h CronRunLog FAILED 건수(API/수집 오류 대체 지표).
   *
   * ★소스 택1 근거(이슈 요건1-③): P08 하드닝 KIS 클라이언트에 **노출된 실패 카운터가 없다**(확인:
   *   kis-api.service.ts 에 failureCount/getFailure 부재 — axios-retry 내부 로깅만). 이에 CronRunLog
   *   FAILED 집계로 대체한다. 근거: (a) 영속 — 인메모리 카운터와 달리 재시작에도 생존, (b) 크로스엔진
   *   결합 없음 — engine3 KIS 클라이언트를 engine5 에 주입하지 않아 경계 유지, (c) 데이터수집 잡 실패가
   *   곧 운영 위험 신호(수집 실패 시 조용한 데이터 소실 — KNOWN_FAILURES 참조)라 의미 정합.
   *   조회 실패 시 0 폴백.
   */
  private async deriveApiErrorCount(): Promise<number> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return await this.prisma.cronRunLog.count({
        where: { status: 'FAILED', startedAt: { gte: since } },
      });
    } catch (e) {
      this.logger.error(
        `[AutoKill] API오류 집계 실패(0 폴백): ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * persistAutoKillAdvice — AUTO_KILL_ADVICE RiskDecisionLog 멱등 기록(track+tradeDate 1행).
   *   장중 모니터가 매 10분 재호출해도 당일 1행만 유지(측정 노이즈 억제). 당일 에스컬레이션
   *   (ALLOW→SHADOW_VIOLATION)만 갱신해 '그날 최악' 권고를 반영한다. money 컬럼은 자동킬 컨텍스트에
   *   부적합 → 0 고정하고 meta 가 권위(raw 입력 전량 보존 — P23 사후 임계 결정용). graceful.
   */
  private async persistAutoKillAdvice(
    input: RiskGuardAutoKillInput,
    inputs: AutoKillCheckInput,
    advice: AutoKillResult,
  ): Promise<void> {
    try {
      const action = advice.shouldKill ? 'SHADOW_VIOLATION' : 'ALLOW';
      const meta = {
        kind: 'AUTO_KILL_ADVICE',
        shouldKill: advice.shouldKill,
        triggerCode: advice.triggerCode ?? null,
        reason: advice.reason ?? null,
        inputs,
        lossSource: input.lossSource,
        styleTag: input.styleTag ?? null,
        // 판정에 쓴 조건(frozen DEFAULT) 스냅샷 — 사후 임계 재해석 근거.
        conditions: DEFAULT_AUTO_KILL_CONDITIONS,
        killSwitchActive: input.killSwitchActive ?? false,
      } as unknown as Prisma.InputJsonValue;

      const existing = await this.prisma.riskDecisionLog.findFirst({
        where: {
          track: input.track,
          tradeDate: input.tradeDate,
          meta: { path: ['kind'], equals: 'AUTO_KILL_ADVICE' },
        },
        select: { id: true, action: true },
      });

      if (!existing) {
        await this.prisma.riskDecisionLog.create({
          data: {
            track: input.track,
            mode: 'SHADOW',
            action,
            tradeDate: input.tradeDate,
            totalCapital: 0,
            dailyRealizedPnl: 0,
            availableCash: 0,
            entryBudget: 0,
            violationCodes: advice.triggerCode ?? '',
            corpCode: null,
            stockCode: null,
            meta,
          },
        });
        return;
      }
      // 에스컬레이션(비발동→발동)만 갱신 — 멱등·당일 worst 반영.
      if (existing.action === 'ALLOW' && advice.shouldKill) {
        await this.prisma.riskDecisionLog.update({
          where: { id: existing.id },
          data: { action, violationCodes: advice.triggerCode ?? '', meta },
        });
      }
    } catch (e) {
      this.logger.error(
        `[AutoKill] AUTO_KILL_ADVICE 영속 실패(무시): ${(e as Error).message}`,
      );
    }
  }

  /**
   * alertAutoKill — 발동 권고 시 OPS_ALERT(WARNING, 일 1회 dedupe). ★킬스위치 실제 발동이 아니므로
   *   RISK_ALERT(발동 통지) 가 아니라 OPS_ALERT(운영 관측)로 보낸다 — SHADOW 측정임을 문구에 명기.
   *   notifyProducer 미주입(단위 테스트)이면 no-op.
   */
  private async alertAutoKill(
    input: RiskGuardAutoKillInput,
    advice: AutoKillResult,
  ): Promise<void> {
    if (!this.notifyProducer) return;
    try {
      await this.notifyProducer.enqueueOpsAlert(
        'WARNING',
        `auto-kill:${input.track}`,
        `[AutoKill/SHADOW] ${input.track} 자동 킬스위치 발동 권고 감지(${input.tradeDate}) — ${
          advice.reason ?? advice.triggerCode ?? 'AUTO_KILL'
        }. (측정 모드: 실제 발동 없음)`,
        {
          dedupeKey: `auto-kill:shadow:${input.track}:${input.tradeDate}`,
          deepLink: '/portfolio',
          data: {
            track: input.track,
            tradeDate: input.tradeDate,
            triggerCode: advice.triggerCode ?? null,
            reason: advice.reason ?? null,
          },
        },
      );
    } catch (e) {
      this.logger.error(
        `[AutoKill] OPS_ALERT 발행 실패(무시): ${(e as Error).message}`,
      );
    }
  }

  /**
   * upsertHighWaterMark — 포트폴리오 단위 고점 forward-only 갱신. 최초 관측이면 현재 총자산으로
   *   생성(초기값=현재 총자산·과거 소급 산정 금지 — 룩어헤드·리셋 정합). 이후 max(고점, 현재)만 반영.
   *   실패 시 현재 총자산을 고점으로 폴백(판정 진행 보장). 반환=갱신 후 고점.
   */
  private async upsertHighWaterMark(input: RiskGuardDrawdownEvaluateInput): Promise<number> {
    try {
      const existing = await this.prisma.accountHighWaterMark.findUnique({
        where: { portfolioId: input.portfolioId },
        select: { highWaterMark: true, peakDate: true },
      });
      if (!existing) {
        await this.prisma.accountHighWaterMark.create({
          data: {
            portfolioId: input.portfolioId,
            track: input.track,
            highWaterMark: input.currentEquity,
            peakDate: input.tradeDate,
            lastEquity: input.currentEquity,
            lastDate: input.tradeDate,
          },
        });
        return input.currentEquity;
      }
      const prevHwm = Number(existing.highWaterMark);
      const isNewPeak = input.currentEquity > prevHwm;
      const nextHwm = isNewPeak ? input.currentEquity : prevHwm;
      await this.prisma.accountHighWaterMark.update({
        where: { portfolioId: input.portfolioId },
        data: {
          highWaterMark: nextHwm,
          ...(isNewPeak ? { peakDate: input.tradeDate } : {}),
          lastEquity: input.currentEquity,
          lastDate: input.tradeDate,
          track: input.track,
        },
      });
      return nextHwm;
    } catch (e) {
      this.logger.error(`[RiskGuard] HWM 갱신 실패(현재 총자산 폴백): ${(e as Error).message}`);
      // 폴백: 고점=현재 총자산 → 드로다운 0 → 오탐 BLOCK/알림 없음(안전 측 오류).
      return input.currentEquity;
    }
  }

  /** RiskDecisionLog 영속(드로다운 컷) — 진입 컬럼을 계좌 컨텍스트로 매핑(meta 가 권위). graceful. */
  private async persistDrawdown(
    input: RiskGuardDrawdownEvaluateInput,
    decision: RiskGuardDecision,
    highWaterMark: number,
    drawdownPct: number,
  ): Promise<void> {
    try {
      await this.prisma.riskDecisionLog.create({
        data: {
          track: decision.track,
          mode: decision.mode,
          action: decision.action,
          tradeDate: input.tradeDate,
          // 계좌 레벨 컨텍스트 매핑: 고점=totalCapital, 현재총자산=availableCash,
          //   드로다운금액(음수)=dailyRealizedPnl, entryBudget=0(진입 무관). meta 가 권위.
          totalCapital: highWaterMark,
          dailyRealizedPnl: input.currentEquity - highWaterMark,
          availableCash: input.currentEquity,
          entryBudget: 0,
          violationCodes: decision.violations.map((v) => v.code).join(','),
          corpCode: null,
          stockCode: null,
          meta: {
            kind: 'DRAWDOWN_CUT',
            portfolioId: input.portfolioId,
            highWaterMark,
            currentEquity: input.currentEquity,
            drawdownPct,
            killSwitchActive: input.killSwitchActive ?? false,
            violations: decision.violations,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.error(
        `[RiskGuard] 드로다운 RiskDecisionLog 영속 실패(무시): ${(e as Error).message}`,
      );
    }
  }

  /**
   * 드로다운 컷 알림 — **SHADOW 만** OPS_ALERT(일 1회 dedupe·측정 관측용). ENFORCE BLOCK 은 알림하지
   *   않는다: 호출측 킬스위치 발동이 P02 RISK_ALERT 를 단독 발행하므로 중복 발송을 방지한다.
   *   notifyProducer 미주입(단위 테스트)이면 no-op.
   */
  private async alertDrawdown(
    input: RiskGuardDrawdownEvaluateInput,
    decision: RiskGuardDecision,
  ): Promise<void> {
    if (!this.notifyProducer) return;
    if (decision.action !== 'SHADOW_VIOLATION') return; // ENFORCE BLOCK → 킬스위치 RISK_ALERT 가 담당
    try {
      await this.notifyProducer.enqueueOpsAlert(
        'WARNING',
        `risk-guard:${decision.track}`,
        `[RiskGuard/SHADOW] ${decision.track} 드로다운 컷 임계 감지(${input.tradeDate}) — ${decision.violations[0]?.message ?? 'DRAWDOWN_CUT'}. (측정 모드: 차단 없음)`,
        {
          // 포트폴리오+거래일 dedupe(철학/전략 forward 4종 각각 가시화, 반복 위반은 일 1회 요약).
          dedupeKey: `risk-guard:drawdown:shadow:${decision.track}:${input.portfolioId}:${input.tradeDate}`,
          deepLink: '/portfolio',
          data: {
            track: decision.track,
            portfolioId: input.portfolioId,
            tradeDate: input.tradeDate,
            violations: decision.violations,
          },
        },
      );
    } catch (e) {
      this.logger.error(`[RiskGuard] 드로다운 OPS_ALERT 발행 실패(무시): ${(e as Error).message}`);
    }
  }

  /** RiskDecisionLog 영속 — 판정 로그(SHADOW 위반 포함 전량). 실패는 삼켜서 매매 흐름 보호. */
  private async persist(input: RiskGuardEvaluateInput, decision: RiskGuardDecision): Promise<void> {
    try {
      await this.prisma.riskDecisionLog.create({
        data: {
          track: decision.track,
          mode: decision.mode,
          action: decision.action,
          tradeDate: input.tradeDate,
          totalCapital: input.totalCapital,
          dailyRealizedPnl: input.dailyRealizedPnl,
          availableCash: input.availableCash,
          entryBudget: input.entryBudget,
          violationCodes: decision.violations.map((v) => v.code).join(','),
          corpCode: input.corpCode ?? null,
          stockCode: input.stockCode ?? null,
          meta: {
            killSwitchActive: input.killSwitchActive ?? false,
            monthlyRealizedPnl: input.monthlyRealizedPnl ?? null,
            violations: decision.violations,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.error(`[RiskGuard] RiskDecisionLog 영속 실패(무시): ${(e as Error).message}`);
    }
  }

  /**
   * OPS_ALERT 발행 — 위반 시.
   *   - SHADOW_VIOLATION: dedupeKey 에 트랙+거래일 → 일 1회 요약(반복 위반 스팸 방지).
   *   - BLOCK(ENFORCE): dedupeKey 에 트랙+거래일+종목 → 즉시(차단은 실제 매매 영향이라 개별 통지).
   *   notifyProducer 미주입(단위 테스트)이면 no-op.
   */
  private async alert(input: RiskGuardEvaluateInput, decision: RiskGuardDecision): Promise<void> {
    if (!this.notifyProducer) return;
    const codes = decision.violations.map((v) => v.code).join(', ');
    try {
      if (decision.action === 'BLOCK') {
        await this.notifyProducer.enqueueOpsAlert(
          'ERROR',
          `risk-guard:${decision.track}`,
          `[RiskGuard/ENFORCE] ${decision.track} 진입 차단(${input.tradeDate}) — ${codes}. 종목=${input.corpCode ?? '-'}.`,
          {
            dedupeKey: `risk-guard:block:${decision.track}:${input.tradeDate}:${input.corpCode ?? '-'}`,
            deepLink: '/portfolio',
            data: {
              track: decision.track,
              tradeDate: input.tradeDate,
              violations: decision.violations,
            },
          },
        );
      } else {
        // SHADOW_VIOLATION — 일 1회 dedupe 요약.
        await this.notifyProducer.enqueueOpsAlert(
          'WARNING',
          `risk-guard:${decision.track}`,
          `[RiskGuard/SHADOW] ${decision.track} 게이트 위반 감지(${input.tradeDate}) — ${codes}. (측정 모드: 차단 없음)`,
          {
            dedupeKey: `risk-guard:shadow:${decision.track}:${input.tradeDate}`,
            deepLink: '/portfolio',
            data: {
              track: decision.track,
              tradeDate: input.tradeDate,
              violations: decision.violations,
            },
          },
        );
      }
    } catch (e) {
      this.logger.error(`[RiskGuard] OPS_ALERT 발행 실패(무시): ${(e as Error).message}`);
    }
  }
}
