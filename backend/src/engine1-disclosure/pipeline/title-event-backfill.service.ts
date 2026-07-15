// backend/src/engine1-disclosure/pipeline/title-event-backfill.service.ts
// W4 신호 검증: 제목(reportName) 기반 과거 공시 이벤트 분류 백필 — DART 쿼터 소비 0.

import { Injectable, Logger } from '@nestjs/common';
import { ExtractionStatus, ParseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { classifyByReportName } from '../disclosure-events/extractors/event-classifier';
import {
  TITLE_BACKFILL_SOURCE,
  TITLE_ONLY_BACKFILL_MARKER,
} from './title-event-backfill.constants';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** 1페이지 조회 크기 — keyset 페이지네이션 단위(DB-only, DART 호출 0). */
export const TITLE_BACKFILL_PAGE_SIZE = 1_000;

/**
 * 1회 실행 기본 스캔 상한. 스캔은 소컬럼 select + 인메모리 정규식이라 저비용이므로
 * 백필 공시 전량(수십만)을 한 번에 훑을 수 있게 크게 둔다 — 미매칭 행은 이벤트가 생기지
 * 않아 매 실행 재스캔되므로(커서 영속 없음, 스키마 변경 금지), 상한이 전체를 덮어야
 * '미매칭 머리에 걸려 정체'하지 않는다.
 */
export const DEFAULT_SCAN_LIMIT = 200_000;
/** 스캔 하드 상한(폭주 방지). */
export const MAX_SCAN_LIMIT = 500_000;

/**
 * 이벤트 생성 최소 분류 confidence — 라이브 SUCCESS 임계(disclosure-events.service 의
 * CONFIDENCE_SUCCESS_THRESHOLD=0.85)와 동일 값. 제목만으로 타입이 확정되는 룰(≥0.85)만
 * 채택하고, 절차성(0.80)·방향 미상(0.72) 룰은 건너뛴다 — 오분류 노이즈가 Event Study
 * 버킷을 오염시키지 않게 하는 정밀도 가드(라이브 분류 semantics 와 경계 일치).
 */
export const TITLE_BACKFILL_MIN_CONFIDENCE = 0.85;

/** keyset 커서 — (rcpDt, rcpNo) 사전식 오름차순 재개 지점. */
export interface TitleBackfillCursor {
  rcpDt: string;
  rcpNo: string;
}

/** backfillOnce 옵션 — 수동/테스트용 한도·재개 커서. */
export interface TitleEventBackfillOptions {
  /** 스캔 상한(기본 200,000 · 하드 상한 500,000). */
  scanLimit?: number;
  /** 이 커서(배타) 이후부터 스캔 — 수동 재개용. rcpDt·rcpNo 둘 다 있어야 적용. */
  startAfterRcpDt?: string;
  startAfterRcpNo?: string;
}

/** 제목 기반 이벤트 백필 1회 결과 — 관측·테스트·recorder itemCount 입력. 정직 로그. */
export interface TitleEventBackfillResult {
  /** 스캔한 후보(백필·무이벤트·비DONE 문서) 공시 건수. */
  scanned: number;
  /** 제목 룰 매칭(confidence ≥ 0.85) 건수 = 생성 시도 건수. */
  matched: number;
  /** 실제 생성된 DisclosureEvent 건수(skipDuplicates 이후). recorder itemCount. */
  created: number;
  /** 제목 룰 미매칭으로 건너뛴 건수(이벤트 미생성 — 파싱 경로에 위임). */
  skippedUnmatched: number;
  /** 매칭됐으나 confidence < 0.85 라 건너뛴 건수(절차성·방향 미상 룰). */
  skippedLowConfidence: number;
  /** true = 후보 전량 스캔 완료(마지막 페이지 미만). false = scanLimit 도달 중단. */
  exhausted: boolean;
  /** 마지막 스캔 위치(수동 재개 커서). 스캔 0건이면 null. */
  lastRcpDt: string | null;
  lastRcpNo: string | null;
  /** 실행 후 잔여 후보 건수(정직 진행성 — 미매칭 잔존 포함). */
  remainingCandidates: number;
  /** 소요(ms). */
  durationMs: number;
}

/** 진행 리포트(read-only). */
export interface TitleEventBackfillProgress {
  /** 백필 공시 중 이벤트가 없는 전체 건수(DONE 문서 포함 — 추출 경로 전체 잔여). */
  backfillWithoutEvent: number;
  /** 이 잡의 후보 건수(백필·무이벤트·비DONE 문서 — 제목 분류 대상). */
  titleBackfillCandidates: number;
  /** 지금까지 제목 백필로 생성된 이벤트 건수(failReason 마커 기준). */
  titleOnlyEventsCreated: number;
}

/**
 * TitleEventBackfillService (W4 신호 검증) — 제목 기반 과거 공시 이벤트 분류 백필.
 *
 * ★목적: 연속 백필(continuous-backfill, 1999까지 자동 확장 중)로 적재된 과거 공시 중
 *   DisclosureEvent 가 없는 행을, 라이브와 동일한 제목 분류 룰(event-classifier 의
 *   classifyByReportName — SSOT)로 분류해 이벤트를 생성한다. Event Study 관측치가
 *   n≈1,093 → 수만으로 확장되는 직접 레버(주간 토 04:00 재집계가 자동 편입).
 *
 * ★DART 쿼터 소비 0(절대): 문서 fetch·파싱을 트리거하지 않는다 — DB read + createMany 만.
 *   기존 이벤트 백필 드레인(DAR-391)의 파싱 등록(Phase 2)과 달리 파싱 큐에도 넣지 않는다.
 *
 * ★기존 추출 경로와의 경계(품질 우선):
 *   - DONE 문서 보유 공시는 제외 — DAR-391 Phase 1 의 전체 수치 추출(Rule)이 그 코호트를
 *     소유한다. 제목만으로 이벤트를 만들면 `disclosureEvent is null` 술어에서 빠져
 *     수치 추출 기회가 영영 사라지므로 여기서 건드리지 않는다.
 *   - 비DONE 문서(미등록·PENDING·실패)는 제목 이벤트를 먼저 만들어도, 추후 파싱 완료 시
 *     onDocumentParsed → processDisclosure upsert(rcpNo) 가 전체 추출로 덮어쓴다(업그레이드).
 *
 * ★관측 구분(스키마 변경 0): failReason=TITLE_ONLY_BACKFILL + extractedData.backfillSource
 *   =TITLE_ONLY 로 라이브 관측과 분리 집계 가능. extractionStatus=SUCCESS 로 저장해
 *   Event Study(loadEvents 는 SUCCESS 만 적재)에 편입시키되, confidence ≥ 0.85 룰만
 *   채택해 라이브 SUCCESS semantics 를 보존한다.
 *
 * ★멱등: 선정 술어가 `disclosureEvent is null`(이벤트 기존재 시 스킵) + createMany
 *   skipDuplicates(rcpNo unique — 동시 실행 레이스에도 안전) → 반복 실행 무해.
 * ★AI 금지영역 불가침: 전 구간 Rule(L0). AI 큐 발행 0 — engine2 AI 백필 드레인은
 *   마커로 이 관측치를 제외한다(AI 예산 잠식 방지). 신호·매매(Engine5) 경로 무접촉 —
 *   라이브 신호 생성은 isBackfill=true 공시를 항상 제외(DAR-129 불가침)한다.
 */
@Injectable()
export class TitleEventBackfillService {
  private readonly logger = new Logger(TitleEventBackfillService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1회 백필 — 후보를 (rcpDt, rcpNo) 오름차순 keyset 페이지네이션으로 스캔하며
   * 제목 룰 매칭(≥0.85) 건만 DisclosureEvent 로 생성한다. DART 호출 0.
   */
  async backfillOnce(
    options: TitleEventBackfillOptions = {},
  ): Promise<TitleEventBackfillResult> {
    const startedAt = Date.now();
    const scanLimit = clamp(
      options.scanLimit ?? DEFAULT_SCAN_LIMIT,
      0,
      MAX_SCAN_LIMIT,
    );

    let cursor: TitleBackfillCursor | null =
      options.startAfterRcpDt && options.startAfterRcpNo
        ? { rcpDt: options.startAfterRcpDt, rcpNo: options.startAfterRcpNo }
        : null;

    let scanned = 0;
    let matched = 0;
    let created = 0;
    let skippedUnmatched = 0;
    let skippedLowConfidence = 0;
    let exhausted = false;
    let lastRcpDt: string | null = null;
    let lastRcpNo: string | null = null;

    while (scanned < scanLimit) {
      const take = Math.min(TITLE_BACKFILL_PAGE_SIZE, scanLimit - scanned);
      const page = await this.prisma.disclosure.findMany({
        where: this.candidateWhere(cursor),
        // rcpDt(YYYYMMDD…) 사전식 == 시간순. rcpNo tie-break 으로 keyset 경계 안정화.
        orderBy: [{ rcpDt: 'asc' }, { rcpNo: 'asc' }],
        take,
        select: { rcpNo: true, corpCode: true, reportName: true, rcpDt: true },
      });

      if (page.length === 0) {
        exhausted = true;
        break;
      }

      scanned += page.length;
      const tail = page[page.length - 1];
      cursor = { rcpDt: tail.rcpDt, rcpNo: tail.rcpNo };
      lastRcpDt = tail.rcpDt;
      lastRcpNo = tail.rcpNo;

      // ── 제목 분류(라이브 룰 SSOT 재사용) — 문서·파싱 무접촉 ────────────────────
      const rows: Prisma.DisclosureEventCreateManyInput[] = [];
      for (const d of page) {
        const classification = classifyByReportName(d.reportName);
        if (!classification) {
          skippedUnmatched++;
          continue;
        }
        if (classification.confidence < TITLE_BACKFILL_MIN_CONFIDENCE) {
          skippedLowConfidence++;
          continue;
        }
        matched++;
        rows.push({
          rcpNo: d.rcpNo,
          corpCode: d.corpCode, // Disclosure FK 가 보장하는 유효 corpCode
          eventType: classification.eventType,
          polarity: classification.polarity,
          confidence: classification.confidence,
          isAiAssisted: false,
          extractionStatus: ExtractionStatus.SUCCESS,
          extractedData: { backfillSource: TITLE_BACKFILL_SOURCE },
          failReason: TITLE_ONLY_BACKFILL_MARKER,
        });
      }

      if (rows.length > 0) {
        // rcpNo unique + skipDuplicates → 동시 실행/재실행 레이스에도 중복 0(멱등).
        const result = await this.prisma.disclosureEvent.createMany({
          data: rows,
          skipDuplicates: true,
        });
        created += result?.count ?? rows.length;
      }

      if (page.length < take) {
        exhausted = true;
        break;
      }
    }

    const remainingCandidates = await this.prisma.disclosure.count({
      where: this.candidateWhere(null),
    });

    const result: TitleEventBackfillResult = {
      scanned,
      matched,
      created,
      skippedUnmatched,
      skippedLowConfidence,
      exhausted,
      lastRcpDt,
      lastRcpNo,
      remainingCandidates,
      durationMs: Date.now() - startedAt,
    };

    this.logger.log(
      `제목 이벤트 백필 완료: 스캔=${scanned}(매칭=${matched}/생성=${created}/` +
        `미매칭=${skippedUnmatched}/저신뢰=${skippedLowConfidence}), ` +
        `전량완료=${exhausted}, 잔여후보=${remainingCandidates}, 소요=${result.durationMs}ms`,
    );

    return result;
  }

  /** 진행 리포트(read-only) — 잔여·생성 누계를 마커 기준으로 분리 집계. */
  async getProgress(): Promise<TitleEventBackfillProgress> {
    const [backfillWithoutEvent, titleBackfillCandidates, titleOnlyEventsCreated] =
      await Promise.all([
        this.prisma.disclosure.count({
          where: { isBackfill: true, disclosureEvent: { is: null } },
        }),
        this.prisma.disclosure.count({ where: this.candidateWhere(null) }),
        this.prisma.disclosureEvent.count({
          where: { failReason: TITLE_ONLY_BACKFILL_MARKER },
        }),
      ]);
    return { backfillWithoutEvent, titleBackfillCandidates, titleOnlyEventsCreated };
  }

  /**
   * 백필 대상 선정 술어(멱등의 근원):
   *   - isBackfill=true          — 과거 백필 공시만(라이브 파이프라인 소유 행 무접촉).
   *   - disclosureEvent is null  — 이벤트 기존재 시 스킵(반복 실행 무해).
   *   - 문서 미등록 또는 비DONE  — DONE 문서는 DAR-391 전체 수치 추출 경로가 소유.
   *   - (rcpDt, rcpNo) > cursor  — keyset 재개(사전식 튜플 비교를 OR 로 전개).
   */
  private candidateWhere(
    cursor: TitleBackfillCursor | null,
  ): Prisma.DisclosureWhereInput {
    return {
      isBackfill: true,
      disclosureEvent: { is: null },
      AND: [
        {
          OR: [
            { document: { is: null } },
            { document: { parseStatus: { not: ParseStatus.DONE } } },
          ],
        },
        ...(cursor
          ? [
              {
                OR: [
                  { rcpDt: { gt: cursor.rcpDt } },
                  { rcpDt: cursor.rcpDt, rcpNo: { gt: cursor.rcpNo } },
                ],
              },
            ]
          : []),
      ],
    };
  }
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** n 을 [min, max] 로 클램프(정수 가정). */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
