/**
 * PrismaKillSwitchStateRepository — 킬스위치 상태 영속화 어댑터 (DAR-350)
 *
 * IKillSwitchStateRepository를 Prisma(`kill_switch_states` 테이블, 모델 KillSwitchState)로
 * 구현한다. 활성/해제마다 1행을 append 하고, 부팅 시 createdAt 최신 행을 복원한다.
 *
 * 왜 append-only 인가: 킬스위치는 안전 임계 자원이므로 상태 전이 이력을 남겨야 한다
 *   (감사로그 TradingAuditLog 패턴과 동일). 복원은 항상 "가장 최근 전이"가 진실.
 *
 * AI 금지영역: 킬스위치 판정은 순수 Rule. 이 어댑터는 상태 read/write만 한다. AI 개입 0,
 * engine2/AI import 없음(risk-guard 통과). 스키마 변경 없음 — 기존 KillSwitchState 모델 사용.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IKillSwitchStateRepository,
  PersistedKillSwitchState,
  KillSwitchTriggeredBy,
} from './kill-switch-state.repository';

// Prisma row 형태 — schema.prisma KillSwitchState 모델과 1:1
type KillSwitchStateRow = {
  id: string;
  isActive: boolean;
  reason: string | null;
  triggeredBy: string;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaKillSwitchStateRepository
  implements IKillSwitchStateRepository
{
  constructor(private readonly prisma: PrismaService) {}

  /** createdAt 내림차순 최신 1행을 복원. 기록 없으면 null. */
  async loadLatest(): Promise<PersistedKillSwitchState | null> {
    const row = await this.prisma.killSwitchState.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  /** 상태 전이 1행 append. id/createdAt/updatedAt은 DB 기본값에 위임. */
  async append(state: PersistedKillSwitchState): Promise<void> {
    await this.prisma.killSwitchState.create({
      data: {
        isActive: state.isActive,
        reason: state.reason,
        triggeredBy: state.triggeredBy,
        activatedAt: state.activatedAt,
        deactivatedAt: state.deactivatedAt,
      },
    });
  }

  private toDomain(row: KillSwitchStateRow): PersistedKillSwitchState {
    return {
      isActive: row.isActive,
      reason: row.reason,
      triggeredBy: this.normalizeTriggeredBy(row.triggeredBy),
      activatedAt: row.activatedAt,
      deactivatedAt: row.deactivatedAt,
    };
  }

  // triggeredBy는 schema에서 String 컬럼 — 알 수 없는 값은 보수적으로 SYSTEM 처리.
  private normalizeTriggeredBy(value: string): KillSwitchTriggeredBy {
    return value === 'USER' ? 'USER' : 'SYSTEM';
  }
}
