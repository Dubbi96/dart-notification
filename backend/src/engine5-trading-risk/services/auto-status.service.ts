/**
 * AutoTradingStatusService — 자동매매 실행상태 read-only 투명성 조회 (DAR-361)
 *
 * 배경(신뢰=가시성): 자동매매(M11) 가동 시 사용자는 '내 신호가 체결됐나? 왜 차단됐나?'를
 * 알 수 있어야 신뢰하고 맡길 수 있다. 그러나 킬스위치 상태·리스크게이트 차단여부·최근 주문은
 * HTTP 로 노출된 적이 없었다(포트폴리오 화면은 읽기전용 보유만 노출). 이 서비스는 그
 * **실행상태**를 read-only 로 집계해 노출한다.
 *
 * ★범위 정직: M11 주문 실행 루프는 미인가 — 이 서비스는 상태 가시화만 한다. 주문 발주/승인/취소
 * 같은 실행 액션·쓰기·판정 로직은 일절 없다(`executionEnabled`는 항상 false).
 *
 * AI 금지영역 미접촉: KillSwitchManager(순수 Rule 영속 상태) + 기존 OrderRequest 모델을 읽기만 한다.
 * Risk/주문/AI 판정 0. 스키마 변경 없음.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KillSwitchManager } from '../domain/kill-switch';

/** 최근 주문 조회 기본/최대 건수(과도한 적재 차단). */
export const DEFAULT_RECENT_ORDER_LIMIT = 3;
export const MAX_RECENT_ORDER_LIMIT = 20;

export interface AutoStatusKillSwitch {
  /** 킬스위치 발동 여부. true = 발동(모든 주문 차단), false = 정상 대기(안전망 정상). */
  isActive: boolean;
  /** 발동 사유(미발동 시 null). */
  reason: string | null;
  /** 발동 주체(SYSTEM 자동 | USER 수동). */
  triggeredBy: 'SYSTEM' | 'USER';
  /** 발동 시각 ISO(미발동 시 null). */
  activatedAt: string | null;
}

export interface AutoStatusRiskGate {
  /** 신규 주문이 차단되는 상태인지. 현재 표준 차단원은 킬스위치 발동(유일한 standing veto). */
  blocked: boolean;
  /** 'NORMAL' = 정상 | 'BLOCKED' = 주문 차단중. */
  status: 'NORMAL' | 'BLOCKED';
  /** 차단 사유(정상 시 null). */
  blockedReason: string | null;
}

export interface AutoStatusOrderItem {
  id: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  requestedShares: number;
  /** PENDING | APPROVED | REJECTED | KILLED | EXECUTED | CANCELLED. */
  status: string;
  /** 거부/차단 사유(트리거 사유). 없으면 null. */
  reason: string | null;
  createdAt: string;
}

export interface AutoTradingStatusResult {
  killSwitch: AutoStatusKillSwitch;
  riskGate: AutoStatusRiskGate;
  /** 최근 주문(최신순). 자동 실행 미가동이면 빈 배열(graceful). */
  recentOrders: AutoStatusOrderItem[];
  /** 자동 주문 실행 가동 여부 — M11 미인가이므로 항상 false(정직 고지). */
  executionEnabled: boolean;
  /** 사용자 정직 고지 1줄. */
  notice: string;
  /** 집계 시각 ISO. */
  asOf: string;
}

const EXECUTION_NOTICE =
  '자동 실행은 준비중 — 현재는 상태 모니터링만 제공합니다.';

@Injectable()
export class AutoTradingStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly killSwitch: KillSwitchManager,
  ) {}

  /**
   * getStatus — 킬스위치 + 리스크게이트 + 최근 주문을 한 번에 집계(read-only).
   * @param recentLimit 최근 주문 건수(컨트롤러가 정규화해 전달; 기본 3, 상한 20).
   */
  async getStatus(
    recentLimit: number = DEFAULT_RECENT_ORDER_LIMIT,
  ): Promise<AutoTradingStatusResult> {
    const ks = this.killSwitch.getState();

    const killSwitch: AutoStatusKillSwitch = {
      isActive: ks.isActive,
      reason: ks.reason ?? null,
      triggeredBy: ks.triggeredBy,
      activatedAt: ks.activatedAt ? ks.activatedAt.toISOString() : null,
    };

    // 표준 standing 차단원은 킬스위치 발동(유일). 그 외 하드룰(손실/비중 한도 등)은
    // 주문 시점 포트폴리오 스냅샷으로 건별 평가되며 standing 게이트가 아니다(정직).
    const riskGate: AutoStatusRiskGate = killSwitch.isActive
      ? {
          blocked: true,
          status: 'BLOCKED',
          blockedReason:
            killSwitch.reason ?? 'Kill Switch 발동 — 모든 주문이 차단됩니다.',
        }
      : { blocked: false, status: 'NORMAL', blockedReason: null };

    const recentOrders = await this.loadRecentOrders(recentLimit);

    return {
      killSwitch,
      riskGate,
      recentOrders,
      executionEnabled: false,
      notice: EXECUTION_NOTICE,
      asOf: new Date().toISOString(),
    };
  }

  private async loadRecentOrders(
    limit: number,
  ): Promise<AutoStatusOrderItem[]> {
    const rows = await this.prisma.orderRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        stockCode: true,
        side: true,
        requestedShares: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      stockCode: r.stockCode,
      side: r.side as 'BUY' | 'SELL',
      requestedShares: r.requestedShares,
      status: r.status,
      reason: r.rejectionReason ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
