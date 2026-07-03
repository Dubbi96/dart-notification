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
  async evaluateEntry(
    input: RiskGuardEvaluateInput,
  ): Promise<RiskGuardDecision> {
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

  /** RiskDecisionLog 영속 — 판정 로그(SHADOW 위반 포함 전량). 실패는 삼켜서 매매 흐름 보호. */
  private async persist(
    input: RiskGuardEvaluateInput,
    decision: RiskGuardDecision,
  ): Promise<void> {
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
      this.logger.error(
        `[RiskGuard] RiskDecisionLog 영속 실패(무시): ${(e as Error).message}`,
      );
    }
  }

  /**
   * OPS_ALERT 발행 — 위반 시.
   *   - SHADOW_VIOLATION: dedupeKey 에 트랙+거래일 → 일 1회 요약(반복 위반 스팸 방지).
   *   - BLOCK(ENFORCE): dedupeKey 에 트랙+거래일+종목 → 즉시(차단은 실제 매매 영향이라 개별 통지).
   *   notifyProducer 미주입(단위 테스트)이면 no-op.
   */
  private async alert(
    input: RiskGuardEvaluateInput,
    decision: RiskGuardDecision,
  ): Promise<void> {
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
      this.logger.error(
        `[RiskGuard] OPS_ALERT 발행 실패(무시): ${(e as Error).message}`,
      );
    }
  }
}
