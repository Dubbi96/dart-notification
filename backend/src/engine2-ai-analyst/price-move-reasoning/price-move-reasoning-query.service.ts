import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceMoveReasoningRepository } from './price-move-reasoning.repository';
import { PriceMoveReasoningStatus } from './price-move-reasoning.constants';

/**
 * GET /price-move-reasonings/:refId 응답 data — price_move_reasonings 행 1건(FE 계약 1:1).
 * 정본: mobile `types/priceMove.types.ts`(DAR-524). 백엔드 레코드에서 내부 전용 `level`은
 * 제외하고(비용 등급은 FE 미소비), 표시용 `corpName`(Company 조인)을 추가한다.
 * `createdAt`은 계약(`createdAt: string`)에 맞춰 ISO 문자열로 직렬화한다.
 */
export interface PriceMoveReasoningView {
  refId: string;
  stockCode: string;
  corpCode: string;
  /** 표시용 기업명(Company 조인) — 미존재 시 null(FE 는 stockCode 로 폴백 표기). */
  corpName: string | null;
  tradeDate: string;
  changePct: number;
  rcpNo: string | null;
  status: PriceMoveReasoningStatus;
  resultJson: unknown;
  createdAt: string;
}

/**
 * DAR-526 (Wave C/C2·P0) — '왜 움직였나' 카드 조회 서비스(읽기 전용).
 *
 * C1(DAR-522)이 큐(`price-move-reason`)로만 적재한 `price_move_reasonings` 행을 FE 카드가
 * 조회 소비할 수 있도록 refId(등락 이벤트 자연키)로 1건을 반환한다. AI 오케스트레이터
 * (`PriceMoveReasoningService`)와 분리된 순수 조회 경로 — AI 호출·비용게이트·AIUsageLog 무접점.
 * ★AI 금지영역 무침범: 저장된 설명층 결과를 가공 없이 노출할 뿐 어떤 판단도 생성하지 않는다.
 */
@Injectable()
export class PriceMoveReasoningQueryService {
  constructor(
    private readonly repo: PriceMoveReasoningRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 등락 이벤트(refId) 리즈닝 1건 조회 + 표시용 corpName 조인.
   * @throws NotFoundException 미존재 refId → 404(FE 는 '로딩실패' 상태로 정직 degrade).
   */
  async getByRefId(refId: string): Promise<PriceMoveReasoningView> {
    const record = await this.repo.find(refId);
    if (!record) {
      throw new NotFoundException({
        error: 'PRICE_MOVE_REASONING_NOT_FOUND',
        message: `등락 이벤트(refId=${refId}) 리즈닝을 찾을 수 없습니다.`,
      });
    }

    const company = await this.prisma.company.findUnique({
      where: { corpCode: record.corpCode },
      select: { corpName: true },
    });

    return {
      refId: record.refId,
      stockCode: record.stockCode,
      corpCode: record.corpCode,
      corpName: company?.corpName ?? null,
      tradeDate: record.tradeDate,
      changePct: record.changePct,
      rcpNo: record.rcpNo,
      status: record.status,
      resultJson: record.resultJson,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
