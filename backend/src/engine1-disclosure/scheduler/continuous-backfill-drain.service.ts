// backend/src/engine1-disclosure/scheduler/continuous-backfill-drain.service.ts
// DAR-396: 과거 공시 메타데이터를 DART 가용 최초까지 '연속' 확장 백필 — 1년에서 멈추지 않고
//          쿼터 리셋마다 더 과거(월 단위 청크)로 내려간다. 멱등·재개가능·쿼터 인지.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/**
 * DART 전자공시 가용 최초(하한). 이 일자보다 더 과거 윈도는 요청하지 않는다.
 * DART 전자공시시스템은 1999~2000년경부터 데이터 제공 — 보수적으로 1999-01-01 을 하한으로 둔다.
 * 실제 데이터가 없는 더 과거 윈도라도 정상 응답(0건)이면 프런티어가 청크씩 내려가다 하한에서 종료된다.
 */
export const DART_EARLIEST_RCP_DT = '19990101';

/** 1회 청크 윈도 크기(일). 월(약 30일) 단위로 과거를 내려간다(재개 단위를 작게). */
const CHUNK_DAYS = 30;

/** 1회 드레인에서 진행할 최대 청크 수(기본). 쿼터 소진/하한 도달 시 조기 종료. */
const DEFAULT_MAX_CHUNKS_PER_RUN = 6;
/** 1회 드레인 청크 수 하드 상한(폭주·쿼터 과소모 방지). */
const MAX_CHUNKS_HARD = 24;

/**
 * 연속 과거 확장 백필 수집 로그의 triggeredBy 마커.
 * 프런티어(어디까지 과거를 '완주 스캔'했는가)는 status='SUCCESS' 인 이 마커 로그의 최소 bgnDe 로 추적한다.
 * 쿼터로 중도 절단된 윈도는 status='PARTIAL' 로 남겨 관측은 하되 프런티어는 advance 하지 않는다
 * (다음 리셋에 그 윈도를 처음부터 재시도해 완주 → SUCCESS 가 되면 비로소 프런티어가 내려간다).
 */
export const BACKFILL_EXTEND_TRIGGER = 'BACKFILL_EXTEND';

// ─── 결과/옵션 타입 ──────────────────────────────────────────────────────────

/** 연속 백필 1회 드레인 결과 — 관측·테스트·recorder itemCount 입력. 정직 로그. */
export interface ContinuousBackfillResult {
  /** 이번 드레인에서 실제로 시도한 청크(윈도) 수. */
  chunksProcessed: number;
  /** 이번 드레인에서 신규 저장(dedup 후)한 공시 건수. recorder itemCount. */
  savedTotal: number;
  /** 이번 드레인에서 DART 에서 받아온 총 건수(중복 포함). */
  fetchedTotal: number;
  /** 쿼터(020/021) 소진으로 중단되었는가(다음 리셋 후 재개). */
  quotaExceeded: boolean;
  /** DART 가용 최초(하한)까지 내려가 더 과거가 없는가(연속 백필 완료). */
  reachedEarliest: boolean;
  /** 이번 드레인이 진행한 가장 과거 윈도 시작일(YYYYMMDD). 진행 없으면 null. */
  oldestWindowStart: string | null;
  /** 드레인 시작 시점의 프런티어(YYYYMMDD) — 이 일자 직전부터 과거로 내려간다. null=앵커 없음(빈 DB). */
  frontierAtStart: string | null;
  /** 소요(ms). */
  durationMs: number;
}

/** drainOnce 옵션 — 수동/테스트용 한도 덮어쓰기. */
export interface ContinuousBackfillOptions {
  /** 1회 드레인 청크 수(미지정 시 기본 6, [1, 24] 클램프). */
  maxChunks?: number;
}

/** 연속 백필 커버리지 리포트 — 수집 범위·진척 가시성(read-only). */
export interface ContinuousBackfillCoverage {
  generatedAt: string;
  /** 전체 공시 최소 rcpDt(YYYYMMDD…). null=공시 없음. */
  earliestRcpDt: string | null;
  /** 전체 공시 최대 rcpDt(YYYYMMDD…). null=공시 없음. */
  latestRcpDt: string | null;
  /** 전체 공시 건수. */
  totalDisclosures: number;
  /** 과거 확장 백필(isBackfill=true) 공시 건수. */
  backfillDisclosures: number;
  /** 다음 드레인이 내려갈 프런티어(YYYYMMDD). null=앵커 없음. */
  frontier: string | null;
  /** DART 가용 최초(하한)까지 도달했는가. */
  reachedEarliest: boolean;
  /** 하한(DART_EARLIEST_RCP_DT). */
  earliestTargetRcpDt: string;
}

// ─── 서비스 ──────────────────────────────────────────────────────────────────

/**
 * ContinuousBackfillDrainService (DAR-396) — 과거 공시 메타데이터 연속 확장 백필 드레이너.
 *
 * ★진단: 공시는 최근 1년(20250619~20260619)만 수집됨. DART 는 과거 수년치(대략 1999~)를 제공한다.
 *   기존 백필(DAR-129 manual / DAR-391 event)은 '1년 윈도'를 채우는 데 그쳤고, 더 과거로 '연속'
 *   내려가는 자동화가 없었다. 일일 쿼터(list/document 공유 키, 20,000건)가 자주 소진되어 일회성
 *   스크립트로는 멈추기 십상이었다.
 *
 * ★해법: 현재 프런티어(가장 과거 완주 스캔 지점) 직전부터 월(청크) 단위로 과거로 내려가며 수집한다.
 *   - 멱등: rcpNo dedup(createMany skipDuplicates) — 중단 후 재실행 = 재개. isBackfill=true 격리
 *     (라이브 신호·알림 불간섭, DAR-129 와 동일).
 *   - 쿼터 인지: getAllDisclosuresWithMeta 가 020/021 을 감지하면 quotaExceeded — 그 윈도는 PARTIAL
 *     로 남기고(프런티어 미advance) 드레인을 멈춘다. throw 금지. 다음 리셋에 자동 재개(스케줄러).
 *   - 체이닝: 신규 저장분은 enqueueParsing 으로 문서 드레인(#344)에 태운다(DB-only, 멱등). 거래대상
 *     우선 fetch·이벤트 추출·신호/백테스트는 기존 파이프라인이 그대로 처리.
 *   - 진행 가시성: getCoverageReport(최소 rcpDt·총건수·프런티어·하한 도달 여부).
 *
 * ★프런티어 모델: status='SUCCESS' 인 BACKFILL_EXTEND 로그의 최소 bgnDe(완주 스캔한 가장 과거 윈도
 *   시작). 로그가 없으면 전체 공시 최소 rcpDt 를 앵커로 사용. 둘 중 더 과거(작은 값)를 택한다.
 *   ★완주(SUCCESS)한 윈도만 프런티어를 내린다 → 쿼터로 절단된 윈도는 재시도되어 갭이 생기지 않는다.
 *   ★빈 윈도(0건이지만 완주)는 SUCCESS 로 기록되어 프런티어가 계속 내려가 하한에서 종료된다.
 */
@Injectable()
export class ContinuousBackfillDrainService {
  private readonly logger = new Logger(ContinuousBackfillDrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApiService: DartApiService,
    /**
     * @Optional: DisclosureDocumentsModule 미등록 환경(테스트 등)에서도 동작.
     * 미주입 시 수집·저장은 그대로 하고 파싱 큐 등록만 생략(문서 드레인이 다음 회차에 backfill).
     */
    @Optional()
    private readonly documentsService?: DisclosureDocumentsService,
  ) {}

  /**
   * 1회 드레인 — 프런티어 직전부터 과거로 최대 maxChunks 청크를 수집한다.
   * 각 청크는 멱등하며, 쿼터 소진/하한 도달/비정상 응답 시 조기 종료한다(throw 금지).
   */
  async drainOnce(
    options: ContinuousBackfillOptions = {},
    now: Date = new Date(),
  ): Promise<ContinuousBackfillResult> {
    const startedAt = Date.now();
    const maxChunks = clamp(
      options.maxChunks ?? DEFAULT_MAX_CHUNKS_PER_RUN,
      1,
      MAX_CHUNKS_HARD,
    );

    const frontierAtStart = await this.resolveFrontier(now);

    let chunksProcessed = 0;
    let savedTotal = 0;
    let fetchedTotal = 0;
    let quotaExceeded = false;
    let reachedEarliest = false;
    let oldestWindowStart: string | null = null;

    for (let i = 0; i < maxChunks; i++) {
      const frontier = await this.resolveFrontier(now);
      if (!frontier) {
        // 앵커 자체가 없음(빈 DB) — 라이브 수집이 먼저 시드해야 한다. 진행 없음.
        this.logger.warn('연속 백필 앵커(공시 최소 rcpDt) 부재 — 라이브 수집 선행 필요. 종료.');
        break;
      }

      const reqEnd = previousYmd(frontier);
      if (reqEnd < DART_EARLIEST_RCP_DT) {
        reachedEarliest = true;
        this.logger.log(
          `연속 백필 하한(${DART_EARLIEST_RCP_DT}) 도달 — 더 과거 없음. 완료.`,
        );
        break;
      }
      const reqStart = maxYmd(DART_EARLIEST_RCP_DT, subtractDays(reqEnd, CHUNK_DAYS - 1));

      // ── DART 쿼터 인지 수집 ──────────────────────────────────────────────────
      const { items, quotaExceeded: q, abnormalStatus } =
        await this.dartApiService.getAllDisclosuresWithMeta(reqStart, reqEnd);
      fetchedTotal += items.length;

      const saved = await this.saveChunk(items);
      savedTotal += saved;
      chunksProcessed += 1;
      oldestWindowStart = reqStart;

      // ★프런티어 모델: 완주(쿼터·비정상 없음)한 윈도만 SUCCESS → 프런티어를 내린다.
      //   쿼터 절단/비정상은 PARTIAL/FAILED 로 남겨 관측은 하되 프런티어를 advance 하지 않는다.
      const status: 'SUCCESS' | 'PARTIAL' | 'FAILED' = q
        ? 'PARTIAL'
        : abnormalStatus
          ? 'FAILED'
          : 'SUCCESS';
      await this.recordLog(reqStart, reqEnd, items.length, saved, status, abnormalStatus);

      this.logger.log(
        `[연속백필 ${i + 1}/${maxChunks}] ${reqStart}~${reqEnd}: 조회 ${items.length} / 신규 ${saved} ` +
          `[${status}]${q ? ' (쿼터 소진 — 중단)' : ''}`,
      );

      if (q) {
        quotaExceeded = true;
        break; // 쿼터 소진 — 다음 리셋까지 더 진행 무의미. 스케줄러가 자동 재개.
      }
      if (abnormalStatus) {
        // 비정상 응답(쿼터 외) — 이 윈도는 프런티어 미advance(재시도 대상). 폭주 방지 위해 종료.
        break;
      }
    }

    const result: ContinuousBackfillResult = {
      chunksProcessed,
      savedTotal,
      fetchedTotal,
      quotaExceeded,
      reachedEarliest,
      oldestWindowStart,
      frontierAtStart,
      durationMs: Date.now() - startedAt,
    };

    this.logger.log(
      `연속 백필 드레인 완료: 청크=${chunksProcessed}, 신규=${savedTotal}/조회=${fetchedTotal}, ` +
        `프런티어시작=${frontierAtStart ?? 'none'}→가장과거윈도=${oldestWindowStart ?? 'none'}, ` +
        `쿼터소진=${quotaExceeded}, 하한도달=${reachedEarliest}, 소요=${result.durationMs}ms`,
    );

    return result;
  }

  /**
   * 연속 백필 커버리지 리포트(read-only) — 수집 범위·프런티어·하한 도달 여부.
   * '최소 rcpDt 가 과거로 확장되는가'를 사용자/운영이 직접 검증한다.
   */
  async getCoverageReport(now: Date = new Date()): Promise<ContinuousBackfillCoverage> {
    const [earliest, latest, total, backfill, frontier] = await Promise.all([
      this.prisma.disclosure.findFirst({
        orderBy: { rcpDt: 'asc' },
        select: { rcpDt: true },
      }),
      this.prisma.disclosure.findFirst({
        orderBy: { rcpDt: 'desc' },
        select: { rcpDt: true },
      }),
      this.prisma.disclosure.count(),
      this.prisma.disclosure.count({ where: { isBackfill: true } }),
      this.resolveFrontier(now),
    ]);

    const reachedEarliest =
      frontier != null && previousYmd(frontier) < DART_EARLIEST_RCP_DT;

    return {
      generatedAt: now.toISOString(),
      earliestRcpDt: earliest?.rcpDt ?? null,
      latestRcpDt: latest?.rcpDt ?? null,
      totalDisclosures: total,
      backfillDisclosures: backfill,
      frontier,
      reachedEarliest,
      earliestTargetRcpDt: DART_EARLIEST_RCP_DT,
    };
  }

  /**
   * 다음 드레인이 내려갈 프런티어(YYYYMMDD) 해석.
   * = min(SUCCESS BACKFILL_EXTEND 로그 최소 bgnDe, 전체 공시 최소 rcpDt). 둘 다 없으면 null.
   * ★완주 로그(SUCCESS)만 사용 → 빈 윈도도 프런티어를 내리고, 쿼터 절단(PARTIAL)은 내리지 않는다.
   */
  private async resolveFrontier(_now: Date): Promise<string | null> {
    const [successLog, earliestDisclosure] = await Promise.all([
      this.prisma.disclosureCollectionLog.findFirst({
        where: { triggeredBy: BACKFILL_EXTEND_TRIGGER, status: 'SUCCESS' },
        orderBy: { bgnDe: 'asc' },
        select: { bgnDe: true },
      }),
      this.prisma.disclosure.findFirst({
        orderBy: { rcpDt: 'asc' },
        select: { rcpDt: true },
      }),
    ]);

    const candidates: string[] = [];
    if (successLog?.bgnDe) candidates.push(toYmd8(successLog.bgnDe));
    if (earliestDisclosure?.rcpDt) candidates.push(toYmd8(earliestDisclosure.rcpDt));
    if (candidates.length === 0) return null;
    // 8자리 사전식 비교 == 시간순. 더 과거(작은 값)를 프런티어로.
    return candidates.reduce((a, b) => (a <= b ? a : b));
  }

  /**
   * 청크 저장 — rcpNo dedup 후 createMany(skipDuplicates, isBackfill=true) + 신규분 파싱 큐 등록.
   * ★알림(matchAndNotify) 미발송: 과거 공시 푸시 폭탄 방지(DAR-129 백필 정신). 신규 건수 반환.
   */
  private async saveChunk(items: { rcept_no: string; corp_code: string; corp_name: string; report_nm: string; rcept_dt: string; flr_nm: string; rm: string }[]): Promise<number> {
    if (items.length === 0) return 0;

    // 이미 적재된 rcpNo 제외 — 신규분만 파싱 큐에 등록하기 위함(createMany 는 skipDuplicates 로 이중 방어).
    const rcpNos = items.map((i) => i.rcept_no);
    const existing = await this.prisma.disclosure.findMany({
      where: { rcpNo: { in: rcpNos } },
      select: { rcpNo: true },
    });
    const existingSet = new Set(existing.map((e) => e.rcpNo));
    const fresh = items.filter((i) => !existingSet.has(i.rcept_no));
    if (fresh.length === 0) return 0;

    const data = fresh.map((item) => ({
      rcpNo: item.rcept_no,
      corpCode: item.corp_code,
      corpName: item.corp_name,
      reportName: item.report_nm,
      rcpDt: item.rcept_dt,
      flrName: item.flr_nm,
      rmk: item.rm || '',
      disclosureType: this.dartApiService.classifyDisclosureType(item.report_nm),
      isBackfill: true, // ★라이브 신호·알림 격리(DAR-129)
    }));

    const result = await this.prisma.disclosure.createMany({
      data,
      skipDuplicates: true,
    });

    // M1 체이닝: 신규 저장분을 파싱 큐에 등록(멱등). 실제 DART 문서 fetch·레이트리밋은
    // 기존 throttled 파싱 드레인(#344)이 소유 — 여기서 직접 fetch 하지 않는다.
    if (this.documentsService) {
      try {
        await this.documentsService.enqueueParsing(fresh.map((f) => f.rcept_no));
      } catch (err) {
        this.logger.error(
          '파싱 큐 등록 오류(연속 백필) — 문서 드레인이 다음 회차에 backfill',
          err as Error,
        );
      }
    }

    return result.count;
  }

  /** 청크 수집 결과를 DisclosureCollectionLog 에 기록(프런티어 추적 + 운영 가시성). */
  private async recordLog(
    bgnDe: string,
    endDe: string,
    fetchedCount: number,
    newCount: number,
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED',
    abnormalStatus: string | null,
  ): Promise<void> {
    await this.prisma.disclosureCollectionLog.create({
      data: {
        bgnDe,
        endDe,
        triggeredBy: BACKFILL_EXTEND_TRIGGER,
        fetchedCount,
        newCount,
        skippedCount: fetchedCount - newCount,
        failedCount: 0,
        status,
        endedAt: new Date(),
        errorMessage:
          status === 'PARTIAL'
            ? 'DART 일일 쿼터 소진(020/021) — 윈도 중도 절단, 다음 리셋 후 재시도'
            : abnormalStatus
              ? `DART 비정상 응답 status=${abnormalStatus} — 재시도 대상`
              : null,
      },
    });
  }
}

// ─── 유틸(순수 함수) ─────────────────────────────────────────────────────────

/** n 을 [min, max] 로 클램프(정수 가정). */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** rcpDt(YYYYMMDD 또는 YYYYMMDDHHmmss)에서 앞 8자리(YYYYMMDD)만. */
function toYmd8(rcpDt: string): string {
  return rcpDt.slice(0, 8);
}

/** YYYYMMDD → UTC Date(자정). */
function parseYmd8(ymd: string): Date {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
}

/** UTC Date → YYYYMMDD. */
function formatYmd8(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** YYYYMMDD 의 하루 전(YYYYMMDD). 달·해 경계 안전(UTC 산술). */
function previousYmd(ymd: string): string {
  const date = parseYmd8(toYmd8(ymd));
  date.setUTCDate(date.getUTCDate() - 1);
  return formatYmd8(date);
}

/** YYYYMMDD 에서 days 일 뺀 YYYYMMDD. */
function subtractDays(ymd: string, days: number): string {
  const date = parseYmd8(toYmd8(ymd));
  date.setUTCDate(date.getUTCDate() - days);
  return formatYmd8(date);
}

/** 두 YYYYMMDD 중 더 최근(큰 값). 사전식 비교 == 시간순. */
function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}
