import { Injectable, Logger } from '@nestjs/common';
import { EventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * DART 공시 폴백 종목상태 도출 (DAR-69).
 *
 * KRX 데이터마켓플레이스 승인 전까지 관리종목·거래정지 상태를 KRX 실응답 대신
 * **기존 DART 공시 이벤트(DisclosureEvent)** 에서 산출한다. 외부 신규 유료호출 없음
 * (이미 수집·분류된 DisclosureEvent + Disclosure 데이터만 사용).
 *
 * 매핑(Rule 전용, AI 미개입):
 *  - TRADING_SUSPENSION            → 거래정지 (isHalted)
 *  - DELISTING_RISK                → 관리종목·상장폐지 위험 (isManagement)
 *  - AUDIT_OPINION_RISK            → 감사의견 거절·한정 → 관리/상폐 사유 (isManagement)
 *
 * 지정/해제 판별: 동일 카테고리 최신 공시의 보고서명이 해제·재개 신호(`해제`/`재개`)를
 * 포함하면 상태 해소(false), 그 외에는 지정 상태(true)로 본다. 최신 이벤트가 상태를
 * 결정하므로 지정 후 해제되면 자동으로 풀린다. 안전 우선 — 데이터 공백 시 기존
 * 지정 상태를 임의로 만료시키지 않는다(최신 공시가 곧 현재 상태).
 *
 * KRX 승인 후에는 KrxApiService.fetchStockStatus 실응답 매핑으로 교체 가능하도록
 * KrxStockStatus 와 호환되는 형태를 유지한다(인터페이스 보존).
 */

/** 관리종목·거래정지 상태에 영향을 주는 DART 이벤트 타입 */
const STATUS_EVENT_TYPES: readonly EventType[] = [
  EventType.TRADING_SUSPENSION,
  EventType.DELISTING_RISK,
  EventType.AUDIT_OPINION_RISK,
];

/** 거래정지 상태로 매핑되는 이벤트 타입 */
const HALT_EVENT_TYPES: ReadonlySet<EventType> = new Set([EventType.TRADING_SUSPENSION]);

/** 관리종목 상태로 매핑되는 이벤트 타입 */
const MANAGEMENT_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  EventType.DELISTING_RISK,
  EventType.AUDIT_OPINION_RISK,
]);

/** 보고서명에 포함되면 "해제(상태 해소)" 로 판정하는 키워드 */
const RELEASE_PATTERN = /해제|재개/;

/** DART 폴백으로 도출한 종목상태 */
export interface DerivedStockStatus {
  /** 관리종목 (DELISTING_RISK / AUDIT_OPINION_RISK 지정, 미해제) */
  isManagement: boolean;
  /** 거래정지 (TRADING_SUSPENSION 지정, 미해제) */
  isHalted: boolean;
  /** 사유 (예: "관리종목 지정 (DART 공시 폴백)") — 상태 없으면 null */
  statusNote: string | null;
  /** 근거 공시 접수번호 (가장 최근 상태결정 공시) — 없으면 null */
  sourceRcpNo: string | null;
  /** 근거 공시 접수일 (YYYYMMDD…) — 없으면 null */
  sourceRcpDt: string | null;
}

/** 카테고리별 최신 공시 1건 요약 */
interface LatestEvent {
  rcpNo: string;
  rcpDt: string;
  reportName: string;
  isRelease: boolean;
}

function emptyStatus(): DerivedStockStatus {
  return {
    isManagement: false,
    isHalted: false,
    statusNote: null,
    sourceRcpNo: null,
    sourceRcpDt: null,
  };
}

@Injectable()
export class DartStockStatusService {
  private readonly logger = new Logger(DartStockStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 종목(기업) 1건의 관리종목·거래정지 상태를 DART 공시에서 도출한다.
   * @param corpCode DART 고유번호(8자리)
   */
  async deriveStatus(corpCode: string): Promise<DerivedStockStatus> {
    if (!corpCode) return emptyStatus();

    try {
      const events = await this.prisma.disclosureEvent.findMany({
        where: { corpCode, eventType: { in: [...STATUS_EVENT_TYPES] } },
        select: {
          rcpNo: true,
          eventType: true,
          disclosure: { select: { reportName: true, rcpDt: true } },
        },
      });
      return this.reduceEvents(events);
    } catch (err) {
      // 조회 실패는 graceful — 상태 미상(false)으로 처리하되 사실은 로깅.
      this.logger.error(`[DART폴백] 종목상태 도출 실패 corpCode=${corpCode}`, err as Error);
      return emptyStatus();
    }
  }

  /**
   * 관리종목 여부만 반환하는 편의 메서드 (AiCostGate L0 입력용).
   * @param corpCode DART 고유번호(8자리)
   */
  async isManagementStock(corpCode: string): Promise<boolean> {
    const status = await this.deriveStatus(corpCode);
    return status.isManagement;
  }

  /**
   * 상태 이벤트가 있는 전 기업의 관리종목·거래정지 상태를 일괄 도출한다.
   * (스케줄러 StockStatus 폴백 적재용). 상태 이벤트가 전혀 없는 기업은 결과에
   * 포함되지 않는다(= 정상 종목, 기본 false).
   * @returns corpCode → DerivedStockStatus
   */
  async deriveAllStatuses(): Promise<Map<string, DerivedStockStatus>> {
    const events = await this.prisma.disclosureEvent.findMany({
      where: { eventType: { in: [...STATUS_EVENT_TYPES] } },
      select: {
        corpCode: true,
        rcpNo: true,
        eventType: true,
        disclosure: { select: { reportName: true, rcpDt: true } },
      },
    });

    const byCorp = new Map<string, typeof events>();
    for (const ev of events) {
      const list = byCorp.get(ev.corpCode) ?? [];
      list.push(ev);
      byCorp.set(ev.corpCode, list);
    }

    const result = new Map<string, DerivedStockStatus>();
    for (const [corpCode, list] of byCorp) {
      result.set(corpCode, this.reduceEvents(list));
    }
    return result;
  }

  /**
   * 한 기업의 상태 이벤트 묶음을 카테고리별 최신 공시로 환원해 상태를 산출한다.
   * rcpDt(접수일시) 내림차순으로 가장 최근 공시가 현재 상태를 결정한다.
   */
  private reduceEvents(
    events: Array<{
      rcpNo: string;
      eventType: EventType;
      disclosure: { reportName: string; rcpDt: string } | null;
    }>,
  ): DerivedStockStatus {
    let latestHalt: LatestEvent | null = null;
    let latestMgmt: LatestEvent | null = null;

    for (const ev of events) {
      const reportName = ev.disclosure?.reportName ?? '';
      const rcpDt = ev.disclosure?.rcpDt ?? '';
      const candidate: LatestEvent = {
        rcpNo: ev.rcpNo,
        rcpDt,
        reportName,
        isRelease: RELEASE_PATTERN.test(reportName),
      };

      if (HALT_EVENT_TYPES.has(ev.eventType)) {
        latestHalt = this.pickLatest(latestHalt, candidate);
      }
      if (MANAGEMENT_EVENT_TYPES.has(ev.eventType)) {
        latestMgmt = this.pickLatest(latestMgmt, candidate);
      }
    }

    const isHalted = latestHalt != null && !latestHalt.isRelease;
    const isManagement = latestMgmt != null && !latestMgmt.isRelease;

    if (!isHalted && !isManagement) return emptyStatus();

    // 사유·근거 공시: 활성 상태 중 더 최근 공시를 대표로 채택.
    const notes: string[] = [];
    if (isManagement) notes.push('관리종목 지정');
    if (isHalted) notes.push('거래정지');

    const active: LatestEvent[] = [];
    if (isManagement && latestMgmt) active.push(latestMgmt);
    if (isHalted && latestHalt) active.push(latestHalt);
    const source = active.reduce<LatestEvent | null>(
      (acc, cur) => this.pickLatest(acc, cur),
      null,
    );

    return {
      isManagement,
      isHalted,
      statusNote: `${notes.join('·')} (DART 공시 폴백)`,
      sourceRcpNo: source?.rcpNo ?? null,
      sourceRcpDt: source?.rcpDt ?? null,
    };
  }

  /** rcpDt(문자열 비교, YYYYMMDD…) 가 큰 쪽을 최신으로 채택 */
  private pickLatest(current: LatestEvent | null, candidate: LatestEvent): LatestEvent {
    if (!current) return candidate;
    return candidate.rcpDt >= current.rcpDt ? candidate : current;
  }
}
