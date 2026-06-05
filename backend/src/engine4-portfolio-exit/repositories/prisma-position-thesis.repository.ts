/**
 * PrismaPositionThesisRepository — Position Thesis 영속화 어댑터 (M8, DAR-34)
 *
 * IPositionThesisRepository를 Prisma(`position_theses` 테이블)로 구현한다.
 * M7에서 인메모리 어댑터로 시작 → M8에서 Prisma로 교체(인메모리는 폴백·테스트용 유지).
 *
 * AI 금지영역: PositionThesis 생성·평가는 순수 Rule 기반. 이 어댑터는 저장/조회만 담당,
 * 점수·논리 평가에 AI 개입 0. 자연키: tradingSignalId UNIQUE, rcpNo/corpCode FK.
 *
 * 스키마 변경 없음 — schema.prisma의 PositionThesis 모델(마이그레이션 m8) 그대로 사용.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, ThesisStatus as PrismaThesisStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PositionThesisRecord,
  ThesisStatus,
} from '../domain/position-thesis.types';
import { InvalidCondition, ExitRule } from '../domain/invalid-condition.types';
import { IPositionThesisRepository } from './position-thesis.repository';

// Prisma row 형태 — Json 필드는 JsonValue로 반환되므로 매핑 시 도메인 타입으로 캐스팅
type PositionThesisRow = {
  id: string;
  tradingSignalId: string;
  rcpNo: string;
  corpCode: string;
  entryReason: string;
  initialThesis: Prisma.JsonValue;
  invalidConditions: Prisma.JsonValue;
  exitRules: Prisma.JsonValue;
  maxWeight: number;
  status: PrismaThesisStatus;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaPositionThesisRepository
  implements IPositionThesisRepository
{
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Thesis 저장. 도메인이 id(randomUUID)를 미리 생성하므로 upsert로
   * 인메모리 어댑터의 set(덮어쓰기) 시맨틱을 그대로 보존한다.
   */
  async save(thesis: PositionThesisRecord): Promise<PositionThesisRecord> {
    const data = {
      tradingSignalId: thesis.tradingSignalId,
      rcpNo: thesis.rcpNo,
      corpCode: thesis.corpCode,
      entryReason: thesis.entryReason,
      initialThesis: thesis.initialThesis as unknown as Prisma.InputJsonValue,
      invalidConditions:
        thesis.invalidConditions as unknown as Prisma.InputJsonValue,
      exitRules: thesis.exitRules as unknown as Prisma.InputJsonValue,
      maxWeight: thesis.maxWeight,
      status: thesis.status as PrismaThesisStatus,
    };

    const row = await this.prisma.positionThesis.upsert({
      where: { id: thesis.id },
      create: {
        id: thesis.id,
        createdAt: thesis.createdAt,
        updatedAt: thesis.updatedAt,
        ...data,
      },
      update: data,
    });

    return this.toDomain(row);
  }

  async findById(id: string): Promise<PositionThesisRecord | null> {
    const row = await this.prisma.positionThesis.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findBySignalId(
    tradingSignalId: string,
  ): Promise<PositionThesisRecord | null> {
    const row = await this.prisma.positionThesis.findUnique({
      where: { tradingSignalId },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByCorpCode(corpCode: string): Promise<PositionThesisRecord[]> {
    const rows = await this.prisma.positionThesis.findMany({
      where: { corpCode },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findByStatus(status: ThesisStatus): Promise<PositionThesisRecord[]> {
    const rows = await this.prisma.positionThesis.findMany({
      where: { status: status as PrismaThesisStatus },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async updateStatus(
    id: string,
    status: ThesisStatus,
  ): Promise<PositionThesisRecord> {
    const row = await this.prisma.positionThesis.update({
      where: { id },
      data: { status: status as PrismaThesisStatus },
    });
    return this.toDomain(row);
  }

  async findAll(): Promise<PositionThesisRecord[]> {
    const rows = await this.prisma.positionThesis.findMany();
    return rows.map((r) => this.toDomain(r));
  }

  // ─── Prisma row → 도메인 레코드 매핑 (Json 역직렬화) ──────────────
  private toDomain(row: PositionThesisRow): PositionThesisRecord {
    return {
      id: row.id,
      tradingSignalId: row.tradingSignalId,
      rcpNo: row.rcpNo,
      corpCode: row.corpCode,
      entryReason: row.entryReason,
      initialThesis: (row.initialThesis as unknown as string[]) ?? [],
      invalidConditions:
        (row.invalidConditions as unknown as InvalidCondition[]) ?? [],
      exitRules: (row.exitRules as unknown as ExitRule[]) ?? [],
      maxWeight: row.maxWeight,
      status: row.status as ThesisStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
