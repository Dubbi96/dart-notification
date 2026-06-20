// backend/src/engine1-disclosure/pipeline/event-backfill-drain.service.ts
// DAR-391: 과거 공시 이벤트 추출 백필 드레이너 — rcpDt 연중 분포를 점진적으로 채운다.

import { Injectable, Logger } from '@nestjs/common';
import { ExtractionStatus, ParseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/**
 * 1회 드레인에서 이벤트를 추출(Rule)할 최대 건수.
 * 추출은 보유 parsedJson 재사용(DART 호출 0)이라 비교적 큰 배치 허용 — 타 드레이너(200)와 정합.
 */
const DEFAULT_EXTRACT_LIMIT = 200;
/** 추출 배치 하드 상한(폭주 방지). */
const MAX_EXTRACT_LIMIT = 500;

/**
 * 1회 드레인에서 파싱 큐에 신규 등록(PENDING)할 최대 건수.
 * ★등록만 한다(cheap upsert, DART 호출 0). 실제 DART 문서 fetch·레이트리밋 준수는 기존
 *   throttled 파싱 드레인(PipelineDrainScheduler→processPendingBatch, BATCH_CONCURRENCY=5)이
 *   소유한다 — 여기서 직접 fetch 하지 않으므로 중복 DART 호출·레이트리밋 폭주가 없다.
 * ★등록은 DB-only 라 큐 적재 부하만 따른다. 미등록 백필 공시(문서 레코드 자체 부재)는 수만 건
 *   규모이므로(실측), 일배치로 며칠 내 큐에 올리도록 추출(200)보다 큰 상한을 둔다. 큐가 깊어져도
 *   DART 부하는 파싱 드레인의 throttle 로 상한이 고정되므로 안전하다.
 */
const DEFAULT_PARSE_ENQUEUE_LIMIT = 1000;
/** 파싱 등록 배치 하드 상한(DB-only 부하 캡). */
const MAX_PARSE_ENQUEUE_LIMIT = 5000;

/** 아직 파싱(DONE) 도달 전인 문서 상태 — 백로그(미파싱) 집계용. */
const NOT_DONE_PARSE_STATES: ParseStatus[] = [
  ParseStatus.PENDING,
  ParseStatus.FETCHING,
  ParseStatus.PARSING,
  ParseStatus.FETCH_FAILED,
  ParseStatus.PARSE_FAILED,
  ParseStatus.SKIPPED,
];

/** 이벤트 백필 드레인 1회 결과 — 관측·테스트·recorder itemCount 입력. 정직 로그. */
export interface EventBackfillDrainResult {
  /** Phase 1: 추출 시도한 (DONE 문서·이벤트 없음) 백필 공시 건수. */
  extractScanned: number;
  /** Phase 1: 추출 성공(SUCCESS) 건수. recorder itemCount. */
  extractSuccess: number;
  /** Phase 1: 검토대기(NEEDS_REVIEW)로 회수된 건수(AI L1 보강 대기). */
  extractNeedsReview: number;
  /** Phase 1: 추출 실패(FAILED) 건수. */
  extractFailed: number;
  /** Phase 2: 파싱 큐에 신규 등록(PENDING)한 미파싱 백필 공시 건수. */
  parseEnqueued: number;
  /** 잔여(정직 진행성): DONE 문서지만 이벤트가 아직 없는 백필 공시 건수. */
  remainingUnextracted: number;
  /** 잔여(정직 진행성): DONE 문서에 도달하지 못한(미파싱) 백필 공시 건수. */
  remainingUnparsed: number;
  /** 소요(ms). */
  durationMs: number;
}

/** drainOnce 옵션 — 수동/테스트용 한도 덮어쓰기. */
export interface EventBackfillDrainOptions {
  /** Phase 1 추출 배치 상한(미지정 시 기본 200). */
  extractLimit?: number;
  /** Phase 2 파싱 등록 배치 상한(미지정 시 기본 200). */
  parseEnqueueLimit?: number;
}

/** rcpDt 월(YYYYMM)별 이벤트 추출 커버리지 1행. */
export interface EventCoverageMonth {
  /** 접수월 'YYYYMM'. */
  rcpMonth: string;
  /** 해당 월 공시 수(백필 포함 전체). */
  disclosures: number;
  /** 해당 월 이벤트 추출(DisclosureEvent) 수. */
  events: number;
  /** events / disclosures (0~1, 소수 둘째자리). disclosures=0 이면 0. */
  coverageRatio: number;
}

/** 이벤트 추출 커버리지 리포트 — rcpDt 월별 분포(연중화 검증용). */
export interface EventCoverageReport {
  generatedAt: string;
  totalDisclosures: number;
  totalEvents: number;
  /** rcpDt 월 오름차순. */
  months: EventCoverageMonth[];
}

/** $queryRaw 원시 행(Postgres count → bigint, ::int 캐스팅분은 number). */
interface CoverageRow {
  month: string | null;
  disclosures: number | bigint;
  events: number | bigint;
}

/**
 * EventBackfillDrainService (DAR-391) — 과거 공시 이벤트 추출 백필 드레이너.
 *
 * ★진단(상위 병목): 공시는 161K 연중 백필됐으나 DisclosureEvent 추출은 최근 월에만 집중되어
 *   (202506~202507·202606) 2025-08~2026-05 추출이 0 → 신호·백테스트가 6월만 거래하는 진짜 게이트.
 *   라이브 공시는 수집 직후 onDocumentParsed 체이닝으로 즉시 추출되지만, 과거 백필 공시는
 *   파싱·추출 적체가 rcpDt 분포로 가시화되지 않아 사일런트로 비어 있었다.
 *
 * ★해법(2단계·rcpDt 시간순 우선):
 *   Phase 1 — 추출(AI 무관 Rule 우선): isBackfill 공시 중 문서는 DONE 이나 이벤트가 없는 건을
 *     rcpDt 오름차순으로 processDisclosure 한다. 보유 parsedJson 재사용 → DART 호출 0, 저비용.
 *     → DisclosureEvent rcpDt 분포를 과거로 직접 확장한다(연중화의 직접 레버).
 *   Phase 2 — 파싱 피드(throttle-safe): isBackfill 공시 중 문서 레코드가 없는 건을 rcpDt
 *     오름차순으로 enqueueParsing(PENDING 등록)만 한다. 실제 DART fetch·레이트리밋 준수는
 *     기존 throttled 파싱 드레인이 소유 → 중복 호출/폭주 없음. 파싱 DONE 후 추출은 다음 회차 Phase 1.
 *
 * ★멱등: processDisclosure(upsert rcpNo) + enqueueParsing(upsert, 기존상태 유지) → 반복 무해.
 * ★AI 금지영역 불가침: 추출은 전부 Rule(L0). AI는 기존 큐 체이닝(비용게이트 #335)에 그대로 위임,
 *   본 서비스는 신규 AI 호출 0. 손절·주문(Engine5)과 무관.
 * ★진행성: 1회 배치 상한(추출 200·파싱 200) — 일배치로 점진. 즉시 전량 처리 불가(정직 표기).
 */
@Injectable()
export class EventBackfillDrainService {
  private readonly logger = new Logger(EventBackfillDrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DisclosureDocumentsService,
    private readonly eventsService: DisclosureEventsService,
  ) {}

  /**
   * 1회 드레인 — 과거 백필 공시의 추출(Phase 1)·파싱 등록(Phase 2)을 rcpDt 시간순으로 진행.
   * 각 단계는 멱등하며, 단계 예외는 흡수해 다음 단계·다음 건으로 진행한다(부분 진행 보장).
   */
  async drainOnce(
    options: EventBackfillDrainOptions = {},
  ): Promise<EventBackfillDrainResult> {
    const startedAt = Date.now();

    const extractLimit = clamp(
      options.extractLimit ?? DEFAULT_EXTRACT_LIMIT,
      0,
      MAX_EXTRACT_LIMIT,
    );
    const parseEnqueueLimit = clamp(
      options.parseEnqueueLimit ?? DEFAULT_PARSE_ENQUEUE_LIMIT,
      0,
      MAX_PARSE_ENQUEUE_LIMIT,
    );

    // ── Phase 1: 추출(Rule, DART 호출 0) ──────────────────────────────────────
    let extractScanned = 0;
    let extractSuccess = 0;
    let extractNeedsReview = 0;
    let extractFailed = 0;

    if (extractLimit > 0) {
      const candidates = await this.prisma.disclosure.findMany({
        where: {
          isBackfill: true,
          document: { parseStatus: ParseStatus.DONE },
          disclosureEvent: { is: null },
        },
        // rcpDt(YYYYMMDD…) 사전식 == 시간순. rcpNo tie-break 으로 페이지 경계 안정화(멱등 재개).
        orderBy: [{ rcpDt: 'asc' }, { rcpNo: 'asc' }],
        take: extractLimit,
        select: { rcpNo: true },
      });
      extractScanned = candidates.length;

      for (const { rcpNo } of candidates) {
        // processDisclosure 는 throw 하지 않음(상태 전이로 실패 기록) — 한 건 실패가 배치를 깨지 않음.
        const result = await this.eventsService.processDisclosure(rcpNo);
        switch (result.extractionStatus) {
          case ExtractionStatus.SUCCESS:
            extractSuccess++;
            break;
          case ExtractionStatus.NEEDS_REVIEW:
            extractNeedsReview++;
            break;
          default:
            extractFailed++;
        }
      }
    }

    // ── Phase 2: 파싱 등록(PENDING upsert만, fetch는 파싱 드레인 소유) ───────────
    let parseEnqueued = 0;
    if (parseEnqueueLimit > 0) {
      const missing = await this.prisma.disclosure.findMany({
        where: { isBackfill: true, document: { is: null } },
        orderBy: [{ rcpDt: 'asc' }, { rcpNo: 'asc' }],
        take: parseEnqueueLimit,
        select: { rcpNo: true },
      });
      if (missing.length > 0) {
        await this.documentsService.enqueueParsing(missing.map((m) => m.rcpNo));
        parseEnqueued = missing.length;
      }
    }

    // ── 잔여 백로그(정직 진행성) ────────────────────────────────────────────────
    const [remainingUnextracted, remainingMissingDoc, remainingNotDoneDoc] =
      await Promise.all([
        this.prisma.disclosure.count({
          where: {
            isBackfill: true,
            document: { parseStatus: ParseStatus.DONE },
            disclosureEvent: { is: null },
          },
        }),
        this.prisma.disclosure.count({
          where: { isBackfill: true, document: { is: null } },
        }),
        this.prisma.disclosure.count({
          where: {
            isBackfill: true,
            document: { parseStatus: { in: NOT_DONE_PARSE_STATES } },
          },
        }),
      ]);
    const remainingUnparsed = remainingMissingDoc + remainingNotDoneDoc;

    const result: EventBackfillDrainResult = {
      extractScanned,
      extractSuccess,
      extractNeedsReview,
      extractFailed,
      parseEnqueued,
      remainingUnextracted,
      remainingUnparsed,
      durationMs: Date.now() - startedAt,
    };

    this.logger.log(
      `이벤트 추출 백필 드레인 완료: 추출(스캔=${extractScanned}/성공=${extractSuccess}/` +
        `검토=${extractNeedsReview}/실패=${extractFailed}), 파싱등록=${parseEnqueued}, ` +
        `잔여(미추출=${remainingUnextracted}/미파싱=${remainingUnparsed}), 소요=${result.durationMs}ms`,
    );

    return result;
  }

  /**
   * rcpDt 월(YYYYMM)별 이벤트 추출 커버리지 리포트(read-only).
   * 백필 포함 전체 공시 대비 DisclosureEvent 분포를 보여 '연중화' 진척을 검증한다.
   * LEFT JOIN 으로 이벤트가 없는 월도 events=0 으로 노출(빈 구간 가시화).
   */
  async getCoverageReport(now: Date = new Date()): Promise<EventCoverageReport> {
    const rows = await this.prisma.$queryRaw<CoverageRow[]>(Prisma.sql`
      SELECT
        substring(d."rcpDt" FROM 1 FOR 6) AS "month",
        count(*)::int                      AS "disclosures",
        count(e."rcpNo")::int              AS "events"
      FROM "disclosures" d
      LEFT JOIN "disclosure_events" e ON e."rcpNo" = d."rcpNo"
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    let totalDisclosures = 0;
    let totalEvents = 0;
    const months: EventCoverageMonth[] = [];

    for (const row of rows) {
      // rcpDt 가 6자리 미만(데이터 불량)인 행은 방어적으로 제외.
      if (!row.month || row.month.length < 6) continue;
      const disclosures = Number(row.disclosures);
      const events = Number(row.events);
      totalDisclosures += disclosures;
      totalEvents += events;
      months.push({
        rcpMonth: row.month,
        disclosures,
        events,
        coverageRatio:
          disclosures > 0 ? Math.round((events / disclosures) * 100) / 100 : 0,
      });
    }

    return {
      generatedAt: now.toISOString(),
      totalDisclosures,
      totalEvents,
      months,
    };
  }
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** n 을 [min, max] 로 클램프(정수 가정). */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
