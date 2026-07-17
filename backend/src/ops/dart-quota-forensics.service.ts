import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatKstDateCompact } from '../common/time/kst';
import {
  DART_BULK_CEILING,
  DART_DAILY_BUDGET,
  DART_LIVE_PARSE_CEILING,
  DART_LIVE_PARSE_RESERVE,
  DART_LIVE_RESERVE,
  DART_QUOTA_PERSIST_STEP,
} from '../engine1-disclosure/dart-api/dart-api.service';
import { BACKFILL_EXTEND_TRIGGER } from '../engine1-disclosure/scheduler/continuous-backfill-drain.service';
import {
  CollectionRunEntry,
  CronTimelineEntry,
  DART_FORENSICS_PATHS,
  DART_FORENSICS_PATH_LABELS,
  DART_FORENSICS_TIMELINE_JOBS,
  DART_LIST_PAGE_SIZE,
  DartForensicsPathKey,
  DartQuotaForensicsReport,
  ForensicsHourlyRow,
  HypothesisVerdictReport,
  NIGHT_WINDOW_KST,
  NightWindowSummary,
  PathSummary,
  QuotaStateSnapshot,
  RESTART_MARKER_GRACE_MS,
  RestartMarker,
  RestartMarkerReport,
} from './dart-quota-forensics.types';

/** KST 오프셋(ms) — 서버 TZ 무관 KST 벽시계 산출(edition-density 와 동일 규약). */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 야간 창 길이(ms) — 00:00 시작 후 8시간 30분(= ~08:29:59 포함, 08:30 미포함). */
const NIGHT_WINDOW_MS = (8 * 60 + 30) * 60 * 1000;

/** DAR-532 가 세운 판정 대상 가설 문언(고정 — 리포트에 그대로 동봉). */
export const DAR532_HYPOTHESIS =
  'DAR-532 가설: 야간(00:00~08:29 KST) 다중 프로세스 재기동이 in-memory 쿼터 카운터를 ' +
  '반복 리셋해 벌크 예산을 재개방했고, 그 누적 소비가 DART 일일 쿼터를 전량 소진해 ' +
  '라이브 수집을 굶겼다.';

/** $queryRaw 결과 — 시간대별 집계(문서 fetch: isBackfill 분리). */
interface RawHourBackfillRow {
  hour: string;
  isBackfill: boolean;
  cnt: number;
  nightCnt: number;
}

/** $queryRaw 결과 — 시간대별 집계(단일 계열). */
interface RawHourRow {
  hour: string;
  cnt: number;
  nightCnt: number;
}

// ────────────────────────────────────────────────────────────────────────────
// 순수 함수(테스트 결정론) — DB 무관
// ────────────────────────────────────────────────────────────────────────────

/**
 * date 쿼리 파라미터 정규화 — YYYYMMDD 실존 일자만 허용, 미지정 시 오늘(KST).
 * 형식/실존 위반은 400(INVALID_DATE_PARAM) — 전역 필터가 {success:false,error} 로 감싼다.
 */
export function normalizeForensicsDate(date: string | undefined, now: Date): string {
  if (date === undefined || date === '') return formatKstDateCompact(now);
  if (!/^\d{8}$/.test(date)) {
    throw new BadRequestException({
      error: 'INVALID_DATE_PARAM',
      message: `date 는 YYYYMMDD 8자리여야 합니다(입력: ${date}).`,
    });
  }
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const probe = new Date(Date.UTC(y, mo - 1, d));
  const real =
    probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
  if (!real) {
    throw new BadRequestException({
      error: 'INVALID_DATE_PARAM',
      message: `실존하지 않는 일자입니다(입력: ${date}).`,
    });
  }
  return date;
}

/** KST 일자(YYYYMMDD)의 UTC 경계 — [일 시작, 야간 창 끝(08:30), 일 끝(익일 00:00)). */
export function kstDayBoundsUtc(ymd: string): {
  dayStartUtc: Date;
  nightEndUtc: Date;
  dayEndUtc: Date;
} {
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dayStartUtc = new Date(Date.UTC(y, mo - 1, d) - KST_OFFSET_MS);
  return {
    dayStartUtc,
    nightEndUtc: new Date(dayStartUtc.getTime() + NIGHT_WINDOW_MS),
    dayEndUtc: new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000),
  };
}

/** 수집 실행 1건의 추정 list 콜 — 1페이지(100건)=1콜, 0건 실행도 최소 1콜. */
export function estimateListCalls(fetchedCount: number): number {
  if (!Number.isFinite(fetchedCount) || fetchedCount <= 0) return 1;
  return Math.max(1, Math.ceil(fetchedCount / DART_LIST_PAGE_SIZE));
}

/** UTC 시각 → KST 시(hour) 인덱스(0~23). */
export function kstHourIndex(d: Date): number {
  return new Date(d.getTime() + KST_OFFSET_MS).getUTCHours();
}

/** UTC 시각 → 'YYYY-MM-DD HH:mm:ss'(KST). */
export function formatKstTimestamp(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

/** 경로별 24시간 배열 → 리포트 hourly 행(고정 24행·경로 고정 순서). */
export function buildHourlyRows(
  byPath: Record<DartForensicsPathKey, number[]>,
): ForensicsHourlyRow[] {
  const rows: ForensicsHourlyRow[] = [];
  for (let h = 0; h < 24; h++) {
    const rowByPath = {} as Record<DartForensicsPathKey, number>;
    let total = 0;
    for (const path of DART_FORENSICS_PATHS) {
      const v = byPath[path]?.[h] ?? 0;
      rowByPath[path] = v;
      total += v;
    }
    rows.push({ hour: String(h).padStart(2, '0'), total, byPath: rowByPath });
  }
  return rows;
}

/**
 * DAR-532 '다중 재기동 예산 재개방' 가설 판정(조회 일자 1일 한정).
 * - 야간 추정 소비(하한)가 단일 프로세스 벌크 상한을 초과 → 단일 예산으로 설명 불가 → SUPPORTED.
 * - 재기동 마커 2건 이상 + 상한 대비 50% 이상 소비 → SUPPORTED.
 * - 소비 흔적 0건 → 판정 불가(INCONCLUSIVE — 감사 대상 일자인지 확인).
 * - 상한 내 소비 + 마커 0건 → 이 일자에서는 REFUTED.
 * - 그 외 → INCONCLUSIVE.
 */
export function buildHypothesisVerdict(input: {
  nightEstimatedCalls: number;
  restartMarkerCount: number;
  quotaExhausted: boolean | null;
}): HypothesisVerdictReport {
  const { nightEstimatedCalls, restartMarkerCount, quotaExhausted } = input;
  const bulkCeiling = DART_BULK_CEILING;
  const factor = Math.round((nightEstimatedCalls / bulkCeiling) * 100) / 100;
  const reasons: string[] = [
    `야간(00:00~08:29 KST) 추정 소비 하한 ${nightEstimatedCalls}콜 / 단일 프로세스 벌크 상한 ${bulkCeiling}콜 (factor=${factor}).`,
    `재기동 마커(RUNNING 고착) ${restartMarkerCount}건.`,
  ];
  if (quotaExhausted === true) {
    reasons.push('당일 dart_quota_state.quotaExhausted=true — 실제 020/021 쿼터 소진 관측.');
  }

  let verdict: HypothesisVerdictReport['verdict'];
  if (nightEstimatedCalls === 0) {
    verdict = 'INCONCLUSIVE';
    reasons.push('야간 소비 흔적 0건 — 사건 발생 일자를 date 로 지정했는지 확인 필요.');
  } else if (nightEstimatedCalls > bulkCeiling) {
    verdict = 'SUPPORTED';
    reasons.push(
      '추정 하한이 이미 단일 프로세스 벌크 상한을 초과 — 예산 재개방(재기동) 또는 멀티 인스턴스 ' +
        '동시 소비 없이는 불가능한 소비량(추정은 하한이므로 실소비는 더 크다).',
    );
    if (restartMarkerCount === 0) {
      reasons.push(
        '단, 재기동 마커 미검출 — 멀티 인스턴스 동시 소비(이슈 스코프 2, last-writer-wins) 대안 경로 병행 검토.',
      );
    }
  } else if (restartMarkerCount >= 2 && nightEstimatedCalls >= bulkCeiling * 0.5) {
    verdict = 'SUPPORTED';
    reasons.push(
      '야간 재기동 마커 다수 + 상한 대비 50% 이상 소비 — 재기동 예산 재개방 패턴과 정합.',
    );
  } else if (restartMarkerCount === 0) {
    verdict = 'REFUTED';
    reasons.push(
      '이 일자의 야간 소비는 단일 프로세스 예산 내로 설명 가능하고 재기동 마커도 없음 — ' +
        '해당 일자 한정 가설 기각(다른 사건 일자는 별도 조회).',
    );
  } else {
    verdict = 'INCONCLUSIVE';
    reasons.push('재기동 마커는 있으나 소비량이 판정 임계에 미달 — 단독 판정 불가.');
  }

  return {
    hypothesis: DAR532_HYPOTHESIS,
    verdict,
    nightEstimatedCalls,
    bulkCeiling,
    budgetOverrunFactor: factor,
    restartMarkerCount,
    reasons,
    note:
      '판정은 조회 일자 1일 한정. DAR-532(PR #513) 배포 이후에는 재기동 시 callsToday 가 ' +
      '복원되므로 예산 재개방 자체가 차단된다 — 배포 전 사건 일자의 소급 감사와 배포 후 가드 ' +
      '검증을 겸한다.',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 서비스
// ────────────────────────────────────────────────────────────────────────────

/**
 * DartQuotaForensicsService — DART 야간 쿼터 소진 포렌식 (DAR-536).
 *
 * prod DB 직접 접근 대신 배포된 앱이 자기 DB 를 읽어 야간(00:00~08:29 KST) DART 소비를
 * 경로별(벌크 list/문서 파싱 라이브·백필/재무/지분/tables)로 정량 분해하고, DAR-532
 * '다중 재기동 예산 재개방' 가설을 판정 필드로 답한다(PM 재정의 코멘트 2026-07-17).
 *
 * ★read-only — SELECT/COUNT 만. 신규 수집·외부호출·체결·AI 개입·마이그레이션 0.
 *   edition-density 와 동일 정책으로 prod 에 읽기 전용 안전 실행 가능.
 * ★정직성 계약 — 모든 수치는 '저장 흔적 기준 하한'이며 경로별 evidence 에 산출 규칙을,
 *   caveats 에 추정 한계를 그대로 노출한다(수치 발명 금지).
 */
@Injectable()
export class DartQuotaForensicsService {
  private readonly logger = new Logger(DartQuotaForensicsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 포렌식 리포트 산출.
   * @param date 감사 대상 KST 일자(YYYYMMDD, 기본 오늘).
   * @param now  기준 시각(테스트 주입용, 기본 현재).
   */
  async getForensics(date?: string, now: Date = new Date()): Promise<DartQuotaForensicsReport> {
    const day = normalizeForensicsDate(date, now);
    const { dayStartUtc, nightEndUtc, dayEndUtc } = kstDayBoundsUtc(day);

    const [quotaState, collectionLogs, docRows, financialRows, insiderRows, cronRows, markers] =
      await Promise.all([
        this.readQuotaState(day),
        this.prisma.disclosureCollectionLog.findMany({
          where: { startedAt: { gte: dayStartUtc, lt: dayEndUtc } },
          orderBy: { startedAt: 'asc' },
        }),
        this.countDocFetchByHour(day),
        this.countByHour(day, 'company_financials', 'updatedAt'),
        this.countByHour(day, 'insider_holding_changes', 'updatedAt'),
        this.prisma.cronRunLog.findMany({
          where: {
            startedAt: { gte: dayStartUtc, lt: dayEndUtc },
            jobKey: { in: Object.keys(DART_FORENSICS_TIMELINE_JOBS) },
          },
          orderBy: { startedAt: 'asc' },
        }),
        this.collectRestartMarkers(dayStartUtc, dayEndUtc, now),
      ]);

    // ── 경로별 24시간 배열 + 야간 창 정량 ──────────────────────────────────
    const zeros = () => new Array<number>(24).fill(0);
    const byPath: Record<DartForensicsPathKey, number[]> = {
      LIST_FORWARD: zeros(),
      LIST_BACKFILL_EXTEND: zeros(),
      DOC_FETCH_LIVE: zeros(),
      DOC_FETCH_BACKFILL: zeros(),
      FINANCIALS: zeros(),
      INSIDER_HOLDINGS: zeros(),
      TABLES_LAZY_FETCH: zeros(),
    };
    const night: Record<DartForensicsPathKey, number> = {
      LIST_FORWARD: 0,
      LIST_BACKFILL_EXTEND: 0,
      DOC_FETCH_LIVE: 0,
      DOC_FETCH_BACKFILL: 0,
      FINANCIALS: 0,
      INSIDER_HOLDINGS: 0,
      TABLES_LAZY_FETCH: 0,
    };

    // 목록 수집 — 실행 시작 시각 기준 귀속(1실행 = 추정 페이지 콜 합).
    const collectionRuns: CollectionRunEntry[] = collectionLogs.map((log) => {
      const calls = estimateListCalls(log.fetchedCount);
      const path: DartForensicsPathKey =
        log.triggeredBy === BACKFILL_EXTEND_TRIGGER ? 'LIST_BACKFILL_EXTEND' : 'LIST_FORWARD';
      byPath[path][kstHourIndex(log.startedAt)] += calls;
      if (log.startedAt < nightEndUtc) night[path] += calls;
      return {
        startedAtKst: formatKstTimestamp(log.startedAt),
        endedAtKst: log.endedAt ? formatKstTimestamp(log.endedAt) : null,
        bgnDe: log.bgnDe,
        endDe: log.endDe,
        triggeredBy: log.triggeredBy,
        status: log.status,
        fetchedCount: log.fetchedCount,
        estimatedListCalls: calls,
      };
    });

    // 문서 fetch — fetchedAt 완료 시각 기준, isBackfill 로 라이브/백필 분리.
    for (const r of docRows) {
      const path: DartForensicsPathKey = r.isBackfill ? 'DOC_FETCH_BACKFILL' : 'DOC_FETCH_LIVE';
      byPath[path][Number(r.hour)] += r.cnt;
      night[path] += r.nightCnt;
    }
    for (const r of financialRows) {
      byPath.FINANCIALS[Number(r.hour)] += r.cnt;
      night.FINANCIALS += r.nightCnt;
    }
    for (const r of insiderRows) {
      byPath.INSIDER_HOLDINGS[Number(r.hour)] += r.cnt;
      night.INSIDER_HOLDINGS += r.nightCnt;
    }
    // TABLES_LAZY_FETCH — 구조적 0(S3 전용). 배열은 0 유지, evidence 로 근거 고지.

    const paths = this.buildPathSummaries(night, collectionRuns);
    const totalEstimatedCalls = paths.reduce((a, p) => a + p.estimatedCalls, 0);
    const nightSummary: NightWindowSummary = {
      totalEstimatedCalls,
      paths,
      topPaths: [...paths]
        .filter((p) => p.estimatedCalls > 0)
        .sort((a, b) => b.estimatedCalls - a.estimatedCalls)
        .slice(0, 3),
    };

    const cronTimeline: CronTimelineEntry[] = cronRows.map((r) => ({
      jobKey: r.jobKey,
      startedAtKst: formatKstTimestamp(r.startedAt),
      finishedAtKst: r.finishedAt ? formatKstTimestamp(r.finishedAt) : null,
      status: r.status,
      itemCount: r.itemCount,
      dartRelevant: DART_FORENSICS_TIMELINE_JOBS[r.jobKey]?.dartRelevant ?? false,
    }));

    const hypothesis = buildHypothesisVerdict({
      nightEstimatedCalls: totalEstimatedCalls,
      restartMarkerCount: markers.count,
      quotaExhausted: quotaState.quotaExhausted,
    });

    this.logger.log(
      `dart-quota-forensics: date=${day} night=${totalEstimatedCalls}콜(추정 하한) ` +
        `restartMarkers=${markers.count} verdict=${hypothesis.verdict}`,
    );

    return {
      metric: 'dart-quota-forensics',
      date: day,
      generatedAt: now.toISOString(),
      nightWindow: { ...NIGHT_WINDOW_KST },
      budget: {
        dailyBudget: DART_DAILY_BUDGET,
        liveReserve: DART_LIVE_RESERVE,
        liveParseReserve: DART_LIVE_PARSE_RESERVE,
        liveParseCeiling: DART_LIVE_PARSE_CEILING,
        bulkCeiling: DART_BULK_CEILING,
        persistStep: DART_QUOTA_PERSIST_STEP,
      },
      quotaState,
      night: nightSummary,
      hourly: buildHourlyRows(byPath),
      cronTimeline,
      collectionRuns,
      restartMarkers: markers,
      hypothesis,
      caveats: [
        '모든 경로 추정치는 저장 흔적 기준 하한 — HTTP 재시도·무저장 응답(013 데이터 없음/오류) 콜은 DB 에 흔적이 없다.',
        `dart_quota_state.callsToday 는 ${DART_QUOTA_PERSIST_STEP}콜 스텝 flush 라 실소비 대비 최대 ${DART_QUOTA_PERSIST_STEP - 1}콜 저평가(DAR-532 배포 이후 일자만 행 존재).`,
        '재무(FINANCIALS)·지분(INSIDER_HOLDINGS)은 updatedAt 터치 프록시 — DART 무관 갱신이 섞이면 과대, 무저장 콜은 과소 추정.',
        'tables lazy fetch 는 S3/객체 스토리지 전용(DAR-399) — DART 쿼터 소비 0 이 구조적으로 보장되며 후보 경로에서 계측이 아닌 반증으로 답한다.',
        '판정(hypothesis.verdict)은 조회 일자 1일 한정 — 사건 발생 일자를 date 파라미터로 지정해 조회해야 유의미.',
      ],
    };
  }

  /** 경로별 야간 정량 + 산출 근거 문자열(고정 순서). */
  private buildPathSummaries(
    night: Record<DartForensicsPathKey, number>,
    collectionRuns: CollectionRunEntry[],
  ): PathSummary[] {
    const forwardRuns = collectionRuns.filter(
      (r) => r.triggeredBy !== BACKFILL_EXTEND_TRIGGER,
    ).length;
    const backfillRuns = collectionRuns.length - forwardRuns;
    const evidence: Record<DartForensicsPathKey, string> = {
      LIST_FORWARD:
        `disclosure_collection_logs(triggeredBy≠${BACKFILL_EXTEND_TRIGGER}, 당일 ${forwardRuns}건) — ` +
        `실행별 추정 list 콜 = max(1, ceil(fetchedCount/${DART_LIST_PAGE_SIZE})), 시작 시각 기준 귀속.`,
      LIST_BACKFILL_EXTEND:
        `disclosure_collection_logs(triggeredBy=${BACKFILL_EXTEND_TRIGGER}, 당일 ${backfillRuns}건) — ` +
        '동일 추정 규칙. PARTIAL 은 쿼터로 중도 절단된 윈도(정직 관측).',
      DOC_FETCH_LIVE:
        'disclosure_documents.fetchedAt 창 내 완료 건수 × disclosures.isBackfill=false — 1건=1콜(document.xml) 하한.',
      DOC_FETCH_BACKFILL:
        'disclosure_documents.fetchedAt 창 내 완료 건수 × disclosures.isBackfill=true — 1건=1콜(document.xml) 하한.',
      FINANCIALS:
        'company_financials.updatedAt 창 내 터치 행수 — fnlttSinglAcntAll 은 기업·연도·보고서·fsDiv 당 1콜 근사.',
      INSIDER_HOLDINGS:
        'insider_holding_changes.updatedAt 창 내 터치 행수(약한 하한 프록시 — 실제 콜수 2×스캔종목은 DB 미기록, cronTimeline insider.daily 참조).',
      TABLES_LAZY_FETCH:
        '구조적 0 — tables 는 S3 오프로드분을 lazy fetch(DAR-399)하며 DART 재호출이 없다(tables.offload-drain 은 dartRelevant=false).',
    };
    return DART_FORENSICS_PATHS.map((path) => ({
      path,
      label: DART_FORENSICS_PATH_LABELS[path],
      estimatedCalls: night[path],
      evidence: evidence[path],
    }));
  }

  /** dart_quota_state 당일 스냅샷(행 없음/조회 실패 → found:false, 리포트는 계속). */
  private async readQuotaState(day: string): Promise<QuotaStateSnapshot> {
    const baseNote =
      'DAR-532(PR #513) 배포 이후 일자만 행이 존재. callsToday 는 스로틀 flush 하한(실소비 이하).';
    try {
      const row = await this.prisma.dartQuotaState.findUnique({ where: { day } });
      if (!row) {
        return {
          found: false,
          callsToday: null,
          quotaExhausted: null,
          updatedAtKst: null,
          note: `해당 일자 행 없음 — 배포 전 일자이거나 당일 DART 콜 미발생. ${baseNote}`,
        };
      }
      return {
        found: true,
        callsToday: row.callsToday,
        quotaExhausted: row.quotaExhausted,
        updatedAtKst: formatKstTimestamp(row.updatedAt),
        note: baseNote,
      };
    } catch (err) {
      this.logger.warn(
        `dart-quota-forensics: dart_quota_state 조회 실패(무시, found=false): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        found: false,
        callsToday: null,
        quotaExhausted: null,
        updatedAtKst: null,
        note: `조회 실패(마이그레이션 미적용 가능) — 리포트 본계열은 유지. ${baseNote}`,
      };
    }
  }

  /**
   * 문서 fetch 시간대별 집계 — fetchedAt(다운로드 완료) 기준, isBackfill 분리.
   * nightCnt 는 야간 창(00:00~08:30 KST 미만) 정확 경계 필터 — 08시 버킷의 부분 창을 보정한다.
   * ★컬럼명은 Prisma 기본(따옴표 camelCase) — snake_case 는 런타임 42703(DAR-519 선례).
   * ★경계는 바인딩 일자 문자열에서 SQL 로 산출 — 컬럼은 UTC 벽시계 timestamp 이므로
   *   KST 00:00 = to_date(일자) - INTERVAL '9 hours'(tester-event 의 NOW() AT TIME ZONE 'UTC' 규약과 동일 계열).
   */
  private async countDocFetchByHour(day: string): Promise<RawHourBackfillRow[]> {
    return this.prisma.$queryRaw<RawHourBackfillRow[]>(Prisma.sql`
      SELECT
        to_char(dd."fetchedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'HH24') AS hour,
        d."isBackfill"                                                               AS "isBackfill",
        COUNT(*)::int                                                                AS cnt,
        COUNT(*) FILTER (
          WHERE dd."fetchedAt"
            < to_date(${day}, 'YYYYMMDD')::timestamp - INTERVAL '9 hours' + INTERVAL '8 hours 30 minutes'
        )::int                                                                       AS "nightCnt"
      FROM disclosure_documents dd
      JOIN disclosures d ON d."rcpNo" = dd."rcpNo"
      WHERE dd."fetchedAt" >= to_date(${day}, 'YYYYMMDD')::timestamp - INTERVAL '9 hours'
        AND dd."fetchedAt" <  to_date(${day}, 'YYYYMMDD')::timestamp - INTERVAL '9 hours' + INTERVAL '24 hours'
      GROUP BY 1, 2
    `);
  }

  /**
   * 단일 테이블 시간대별 터치 집계(재무·지분 공용) — column(updatedAt) 기준.
   * 테이블/컬럼명은 코드 내 화이트리스트 상수만 도달(외부 입력 무유입 — 인젝션 표면 0).
   */
  private async countByHour(
    day: string,
    table: 'company_financials' | 'insider_holding_changes',
    column: 'updatedAt',
  ): Promise<RawHourRow[]> {
    return this.prisma.$queryRaw<RawHourRow[]>(Prisma.sql`
      SELECT
        to_char(t.${Prisma.raw(`"${column}"`)} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'HH24') AS hour,
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (
          WHERE t.${Prisma.raw(`"${column}"`)}
            < to_date(${day}, 'YYYYMMDD')::timestamp - INTERVAL '9 hours' + INTERVAL '8 hours 30 minutes'
        )::int        AS "nightCnt"
      FROM ${Prisma.raw(table)} t
      WHERE t.${Prisma.raw(`"${column}"`)} >= to_date(${day}, 'YYYYMMDD')::timestamp - INTERVAL '9 hours'
        AND t.${Prisma.raw(`"${column}"`)} <  to_date(${day}, 'YYYYMMDD')::timestamp - INTERVAL '9 hours' + INTERVAL '24 hours'
      GROUP BY 1
    `);
  }

  /**
   * 재기동 마커 수집 — 당일 시작 후 종료시각 없이 RUNNING 으로 고착된 실행 흔적.
   * 프로세스가 실행 중 사망하면 finally/기록이 실행되지 않아 행이 영구 RUNNING 으로 남는다
   * (event-backfill 의 타임아웃은 FAILED 로 기록되므로 마커와 구별됨). 유예(GRACE) 내
   * 시작 행은 '지금 실행 중'일 수 있어 제외 — 마커 수는 재기동 횟수의 하한이다.
   */
  private async collectRestartMarkers(
    dayStartUtc: Date,
    dayEndUtc: Date,
    now: Date,
  ): Promise<RestartMarkerReport> {
    const graceCut = new Date(now.getTime() - RESTART_MARKER_GRACE_MS);
    const stuckBefore = graceCut < dayEndUtc ? graceCut : dayEndUtc;
    const [collection, cron, financial] = await Promise.all([
      this.prisma.disclosureCollectionLog.findMany({
        where: {
          status: 'RUNNING',
          endedAt: null,
          startedAt: { gte: dayStartUtc, lt: stuckBefore },
        },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.cronRunLog.findMany({
        where: {
          status: 'RUNNING',
          finishedAt: null,
          startedAt: { gte: dayStartUtc, lt: stuckBefore },
        },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.financialCollectionLog.findMany({
        where: {
          status: 'RUNNING',
          endedAt: null,
          startedAt: { gte: dayStartUtc, lt: stuckBefore },
        },
        orderBy: { startedAt: 'asc' },
      }),
    ]);

    const markers: RestartMarker[] = [
      ...collection.map(
        (r): RestartMarker => ({
          source: 'disclosure_collection_logs',
          key: `${r.triggeredBy} ${r.bgnDe}~${r.endDe}`,
          startedAtKst: formatKstTimestamp(r.startedAt),
          note: `수집 실행이 RUNNING 고착(fetchedCount=${r.fetchedCount}) — 실행 중 프로세스 사망 추정.`,
        }),
      ),
      ...cron.map(
        (r): RestartMarker => ({
          source: 'cron_run_logs',
          key: r.jobKey,
          startedAtKst: formatKstTimestamp(r.startedAt),
          note: '크론 실행이 RUNNING 고착(finishedAt null) — 실행 중 프로세스 사망 추정.',
        }),
      ),
      ...financial.map(
        (r): RestartMarker => ({
          source: 'financial_collection_logs',
          key: `${r.bsnsYear}/${r.reprtCode}/${r.fsDiv}`,
          startedAtKst: formatKstTimestamp(r.startedAt),
          note: '재무 수집 실행이 RUNNING 고착 — 실행 중 프로세스 사망 추정.',
        }),
      ),
    ].sort((a, b) => (a.startedAtKst < b.startedAtKst ? -1 : 1));

    return {
      count: markers.length,
      markers,
      note:
        'RUNNING 고착(종료시각 null·유예 30분 경과) = 실행 중 프로세스 사망의 영구 흔적 — ' +
        '재기동 횟수의 하한이다(기록 없는 잡 사이 재기동은 미검출). 타임아웃 종료는 FAILED 로 ' +
        '기록되므로 마커에 포함되지 않는다.',
    };
  }
}
