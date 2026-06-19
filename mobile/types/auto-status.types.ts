// 자동매매 실행상태(읽기전용 투명성) 타입 — DAR-361.
// 백엔드 AutoTradingStatusResult(GET /trading/auto-status) 1:1. 읽기 전용.

export interface AutoStatusKillSwitch {
  /** 킬스위치 발동 여부. true = 발동(모든 주문 차단), false = 정상 대기. */
  isActive: boolean;
  /** 발동 사유(미발동 시 null). */
  reason: string | null;
  /** 발동 주체(SYSTEM 자동 | USER 수동). */
  triggeredBy: 'SYSTEM' | 'USER';
  /** 발동 시각 ISO(미발동 시 null). */
  activatedAt: string | null;
}

export interface AutoStatusRiskGate {
  /** 신규 주문 차단 여부. */
  blocked: boolean;
  status: 'NORMAL' | 'BLOCKED';
  /** 차단 사유(정상 시 null). */
  blockedReason: string | null;
}

export type AutoStatusOrderStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'KILLED'
  | 'EXECUTED'
  | 'CANCELLED';

export interface AutoStatusOrderItem {
  id: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  requestedShares: number;
  /** 백엔드 OrderRequestStatus(문자열). 미래 enum 확장 안전을 위해 string. */
  status: string;
  /** 거부/차단 사유(트리거 사유). 없으면 null. */
  reason: string | null;
  createdAt: string;
}

export interface AutoTradingStatus {
  killSwitch: AutoStatusKillSwitch;
  riskGate: AutoStatusRiskGate;
  /** 최근 주문(최신순). 자동 실행 미가동이면 빈 배열. */
  recentOrders: AutoStatusOrderItem[];
  /** 자동 주문 실행 가동 여부 — M11 미인가이므로 항상 false. */
  executionEnabled: boolean;
  /** 정직 고지 1줄. */
  notice: string;
  /** 집계 시각 ISO. */
  asOf: string;
}
