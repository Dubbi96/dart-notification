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

/** 호출측이 넘기는 진입 컨텍스트(모드는 서비스가 트랙에서 해석). */
export interface RiskGuardEvaluateInput {
  track: RiskGuardTrack;
  tradeDate: string; // 판정 거래일 YYYYMMDD (dedupe 버킷)
  totalCapital: number;
  dailyRealizedPnl: number;
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
