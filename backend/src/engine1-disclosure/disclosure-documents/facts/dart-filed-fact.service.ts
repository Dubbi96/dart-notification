// backend/src/engine1-disclosure/disclosure-documents/facts/dart-filed-fact.service.ts
// DAR-95: 표준화된 공시 정량 fact 영구 적재 (순수 Rule, AI/외부호출 0)
//
// DisclosureDocument.parsedJson(이미 받은 XML 파싱 산출물)을 normalizeFiledFacts로
// 표준 factKey 변환 후 DartFiledFact에 멱등 적재한다.
// 멱등: (rcpNo, factKey) 유니크 — 재적재 시 rcpNo 단위 replace(중복·잔재 0).

import { Injectable, Logger } from '@nestjs/common';
import { DartFiledFact, ParseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ParsedJson } from '../types/parsed-json.type';
import {
  normalizeFiledFacts,
  FiledFactInput,
} from './dart-filed-fact.normalizer';

const DEFAULT_BACKFILL_LIMIT = 100;
const MAX_BACKFILL_LIMIT = 1000;

@Injectable()
export class DartFiledFactService {
  private readonly logger = new Logger(DartFiledFactService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * parsedJson을 표준 fact로 정규화해 rcpNo 단위로 멱등 적재.
   *
   * - 정규화 결과가 0건이면 기존 fact만 정리(replace) — 누락된 값 잔재 방지.
   * - rcpNo 단위 deleteMany + createMany를 단일 트랜잭션으로 수행(원자적 replace).
   *
   * @returns 적재된 fact 건수
   */
  async persistFromParsedJson(
    rcpNo: string,
    corpCode: string,
    parsedJson: ParsedJson | null | undefined,
  ): Promise<number> {
    const inputs = normalizeFiledFacts(parsedJson);
    const docType =
      parsedJson && typeof parsedJson.docType === 'string'
        ? parsedJson.docType
        : null;

    const rows: Prisma.DartFiledFactCreateManyInput[] = inputs.map(
      (f: FiledFactInput) => ({
        rcpNo,
        corpCode,
        factKey: f.factKey,
        value: f.value,
        numericValue: f.numericValue ?? null,
        unit: f.unit ?? null,
        period: f.period ?? null,
        sectionPath: f.sectionPath ?? null,
        docType,
      }),
    );

    await this.prisma.$transaction([
      this.prisma.dartFiledFact.deleteMany({ where: { rcpNo } }),
      ...(rows.length > 0
        ? [this.prisma.dartFiledFact.createMany({ data: rows })]
        : []),
    ]);

    this.logger.log(
      `DartFiledFact 적재: rcpNo=${rcpNo}, facts=${rows.length}, docType=${docType ?? 'none'}`,
    );

    return rows.length;
  }

  /**
   * 단건 rcpNo의 DisclosureDocument를 읽어 fact 적재(수동 트리거·재처리용).
   *
   * - 문서 미존재/미완료(parseStatus != DONE)/parsedJson 결측이면 graceful skip(0 반환).
   */
  async persistForRcpNo(rcpNo: string): Promise<number> {
    const doc = await this.prisma.disclosureDocument.findUnique({
      where: { rcpNo },
      select: {
        rcpNo: true,
        corpCode: true,
        parseStatus: true,
        parsedJson: true,
      },
    });

    if (!doc) {
      this.logger.warn(`DartFiledFact skip: 문서 없음 rcpNo=${rcpNo}`);
      return 0;
    }
    if (doc.parseStatus !== ParseStatus.DONE || !doc.parsedJson) {
      this.logger.warn(
        `DartFiledFact skip: 미완료/parsedJson 결측 rcpNo=${rcpNo} status=${doc.parseStatus}`,
      );
      return 0;
    }

    return this.persistFromParsedJson(
      doc.rcpNo,
      doc.corpCode,
      doc.parsedJson as unknown as ParsedJson,
    );
  }

  /**
   * 파싱 완료(DONE) 문서 일괄 backfill — 기존 자산 소급 적재(수동 트리거).
   *
   * @returns 처리 문서 수와 적재 fact 총합
   */
  async backfill(
    limit = DEFAULT_BACKFILL_LIMIT,
  ): Promise<{ processed: number; facts: number }> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_BACKFILL_LIMIT);

    const docs = await this.prisma.disclosureDocument.findMany({
      where: { parseStatus: ParseStatus.DONE, parsedJson: { not: Prisma.DbNull } },
      take: safeLimit,
      orderBy: { parsedAt: 'asc' },
      select: { rcpNo: true, corpCode: true, parsedJson: true },
    });

    let facts = 0;
    for (const doc of docs) {
      facts += await this.persistFromParsedJson(
        doc.rcpNo,
        doc.corpCode,
        doc.parsedJson as unknown as ParsedJson,
      );
    }

    this.logger.log(
      `DartFiledFact backfill 완료: 문서=${docs.length}, fact=${facts}`,
    );

    return { processed: docs.length, facts };
  }

  /** 단건 rcpNo의 적재 fact 조회(factKey 정렬) */
  async findByRcpNo(rcpNo: string): Promise<DartFiledFact[]> {
    return this.prisma.dartFiledFact.findMany({
      where: { rcpNo },
      orderBy: { factKey: 'asc' },
    });
  }
}
