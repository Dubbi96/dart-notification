// backend/src/engine1-disclosure/upcoming-events/upcoming-events.service.ts
// DAR-538: 관심기업 기준 공시발 예정 이벤트 조회 (읽기 전용 — 스키마·M10 무접촉)

import { Injectable } from '@nestjs/common';
import { EventType, ExtractionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UPCOMING_EVENT_TYPES,
  UpcomingEventKind,
  addDaysYmd,
  deriveUpcomingEventsFromRows,
  diffDaysYmd,
} from './upcoming-event.deriver';

export const DEFAULT_WINDOW_DAYS = 90;
export const MAX_WINDOW_DAYS = 365;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface UpcomingEventItemDto {
  kind: UpcomingEventKind;
  label: string;
  /** 이벤트 날짜 YYYY-MM-DD */
  date: string;
  /** baseDate 기준 D-day (0 = 오늘, 3 = D-3) */
  dDay: number;
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  /** 근거 공시 접수번호 — FE에서 원문 공시로 딥링크 */
  rcpNo: string;
  eventType: EventType;
}

export interface UpcomingEventsResultDto {
  /** KST 기준 오늘 YYYY-MM-DD (D-day 산정 기준일) */
  baseDate: string;
  /** 조회 윈도 일수 [baseDate, baseDate+days] */
  days: number;
  items: UpcomingEventItemDto[];
}

@Injectable()
export class UpcomingEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 사용자 관심기업의 [오늘, 오늘+days] 예정 이벤트 목록.
   * now 주입은 테스트 결정론용 (기본 실시각). 날짜 기준은 KST(naive +9h — 저장소 정본 패턴).
   */
  async findForUser(
    userId: string,
    options?: { days?: number; now?: Date },
  ): Promise<UpcomingEventsResultDto> {
    const days = Math.min(
      Math.max(options?.days ?? DEFAULT_WINDOW_DAYS, 1),
      MAX_WINDOW_DAYS,
    );
    const now = options?.now ?? new Date();
    const baseDate = new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
    const toDate = addDaysYmd(baseDate, days);

    const watchlist = await this.prisma.watchList.findMany({
      where: { userId },
      select: { corpCode: true },
    });
    const corpCodes = watchlist.map((w) => w.corpCode);
    if (corpCodes.length === 0) {
      return { baseDate, days, items: [] };
    }

    // FAILED(추출 실패)·PENDING(미처리)은 제외. NEEDS_REVIEW는 필수 수치 결측으로
    // 낮아진 confidence지 날짜 필드가 발명된 것이 아니므로 포함(파생 시 재검증).
    const rows = await this.prisma.disclosureEvent.findMany({
      where: {
        corpCode: { in: corpCodes },
        eventType: { in: [...UPCOMING_EVENT_TYPES] },
        extractionStatus: { in: [ExtractionStatus.SUCCESS, ExtractionStatus.NEEDS_REVIEW] },
      },
      select: {
        rcpNo: true,
        corpCode: true,
        eventType: true,
        extractedData: true,
        isAmendment: true,
        originalRcpNo: true,
        company: { select: { corpName: true, stockCode: true } },
      },
    });

    const derived = deriveUpcomingEventsFromRows(rows, { fromDate: baseDate, toDate });

    return {
      baseDate,
      days,
      items: derived.map((d) => ({
        kind: d.kind,
        label: d.label,
        date: d.date,
        dDay: diffDaysYmd(d.date, baseDate),
        corpCode: d.row.corpCode,
        corpName: d.row.company.corpName,
        stockCode: d.row.company.stockCode,
        rcpNo: d.row.rcpNo,
        eventType: d.row.eventType,
      })),
    };
  }
}
