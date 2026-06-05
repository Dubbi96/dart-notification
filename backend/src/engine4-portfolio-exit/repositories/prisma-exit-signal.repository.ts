/**
 * PrismaExitSignalRepository — Exit Signal 영속화 어댑터 (M8, DAR-34)
 *
 * IExitSignalRepository를 Prisma(`exit_signals` 테이블)로 구현한다.
 * 인메모리 어댑터는 폴백·테스트용으로 유지.
 *
 * AI 금지영역: Exit Score·트리거는 순수 Rule 결과만 저장. aiUsed=false 강제(AI 개입 0).
 * 자연키: positionId FK(Position), triggerRcpNo FK(Disclosure, optional).
 *
 * 스키마 변경 없음 — schema.prisma의 ExitSignal 모델(마이그레이션 m8) 그대로 사용.
 */

import { Injectable } from '@nestjs/common';
import {
  ExitAction as PrismaExitAction,
  ExitTriggerType as PrismaExitTriggerType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IExitSignalRepository,
  CreateExitSignalParams,
} from './exit-signal.repository';

@Injectable()
export class PrismaExitSignalRepository implements IExitSignalRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Exit Signal 저장. ExitScoreComponents의 7개 점수를 개별 컬럼으로,
   * triggerTypes(enum 배열)은 String[]로, primaryTrigger는 triggerType(enum?)로 매핑.
   * aiUsed=false 명시 — Exit Score는 순수 Rule, AI 개입 없음을 필드로 보장.
   */
  async save(params: CreateExitSignalParams): Promise<{ id: string }> {
    const c = params.components;
    const row = await this.prisma.exitSignal.create({
      data: {
        positionId: params.positionId,
        checkTime: params.checkTime,
        lossRiskScore: c.lossRiskScore,
        thesisBreakScore: c.thesisBreakScore,
        chartBreakScore: c.chartBreakScore,
        disclosureRiskScore: c.disclosureRiskScore,
        overweightScore: c.overweightScore,
        timeExceededScore: c.timeExceededScore,
        positiveMomentumBonus: c.positiveMomentumBonus,
        exitScore: params.exitScore,
        exitAction: params.exitAction as PrismaExitAction,
        triggerType: params.primaryTrigger
          ? (params.primaryTrigger as PrismaExitTriggerType)
          : null,
        triggerTypes: params.triggerTypes,
        scoreDetail: params.scoreDetail as unknown as Prisma.InputJsonValue,
        triggerRcpNo: params.triggerRcpNo ?? null,
        aiUsed: false,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findLatestByPositionId(
    positionId: string,
  ): Promise<{ exitScore: number; exitAction: string } | null> {
    const row = await this.prisma.exitSignal.findFirst({
      where: { positionId },
      orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }],
      select: { exitScore: true, exitAction: true },
    });
    if (!row) return null;
    return { exitScore: row.exitScore, exitAction: row.exitAction };
  }
}
