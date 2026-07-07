import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { formatKstDateCompact, KST_TIMEZONE } from '../common/time/kst';
import { CronRunRecorderService } from '../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../cron-health/cron-health.jobs';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { BiweeklyTrackReviewService } from './biweekly-track-review.service';
import { BiweeklyTrackReview } from './biweekly-track-review.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 격주 게이트 고정 앵커(YYYYMMDD, KST 일요일) — 이 날로부터 짝수 주차 일요일만 리포트 주.
 * ★결정론 SSOT: 앵커를 바꾸면 격주 위상(리포트 주/오프 주)이 뒤집히므로 변경 금지.
 */
export const TRACK_REVIEW_ANCHOR_SUNDAY_YMD = '20260712';

/** 격주 주기(일). */
export const TRACK_REVIEW_CYCLE_DAYS = 14;

/** YYYYMMDD → UTC 자정 Date. 형식 불량이면 null(순수 파서 — TZ 비의존 일수 산술 전용). */
function ymdToUtcDate(ymd: string): Date | null {
  if (!/^\d{8}$/.test(ymd)) return null;
  const date = new Date(
    Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))),
  );
  // 역직렬화 검증 — 2월 30일 등 롤오버 입력 거부(결정론).
  return formatUtcYmd(date) === ymd ? date : null;
}

/** UTC Date → YYYYMMDD. */
function formatUtcYmd(date: Date): string {
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${date.getUTCDate()}`.padStart(2, '0');
  return `${date.getUTCFullYear()}${m}${d}`;
}

/** 앵커 일요일로부터의 일수 차(음수 허용). 형식 불량이면 null. */
function daysFromAnchor(ymd: string): number | null {
  const date = ymdToUtcDate(ymd);
  const anchor = ymdToUtcDate(TRACK_REVIEW_ANCHOR_SUNDAY_YMD);
  if (!date || !anchor) return null;
  return Math.round((date.getTime() - anchor.getTime()) / MS_PER_DAY);
}

/**
 * 격주 게이트(순수 함수·결정론) — 앵커('20260712' 일요일)로부터 일수 차 / 7 이 **짝수**인
 * 일요일만 true. 일요일이 아니거나 형식 불량이면 false. 앵커 이전 날짜도 동일 산술로
 * 위상이 유지된다(예: 2026-06-28 = −2주 → true, 2026-07-05 = −1주 → false).
 */
export function isReviewSunday(ymd: string): boolean {
  const date = ymdToUtcDate(ymd);
  if (!date || date.getUTCDay() !== 0) return false; // 일요일(UTC 산술 캘린더) 아님
  const days = daysFromAnchor(ymd);
  if (days === null || days % 7 !== 0) return false; // 일요일인데 7일 격자 밖이면 방어적 거부
  return (days / 7) % 2 === 0;
}

/**
 * 앵커 기준 회차(멱등 dedupe 버킷·순수 함수) — 앵커 일요일 = 0, 2주마다 +1(이전은 음수).
 * 형식 불량이면 null. 리포트 일요일이 아닌 날짜는 가장 가까운 격주 격자로 반올림되므로
 * 반드시 isReviewSunday 통과 후 사용한다.
 */
export function reviewCycleNo(ymd: string): number | null {
  const days = daysFromAnchor(ymd);
  return days === null ? null : Math.round(days / TRACK_REVIEW_CYCLE_DAYS);
}

/**
 * BiweeklyTrackReviewScheduler — 격주 트랙 성과 순위 리포트 발송 cron.
 *
 * ★카덴스: 매주 일요일 10:00 KST 발화하되 **격주 게이트(isReviewSunday)** 로 앵커 기준
 *   짝수 주차 일요일만 실행한다(오프 주는 SKIPPED 기록 — '크론 살아있음' 표면화, 발송 0).
 *   일요일 = 주중 데이터 완결(금요일 청산까지 반영) + 배치 무경합 시간대.
 *
 * ★발송: BiweeklyTrackReviewService.buildReview → NotificationProducer.enqueueOpsAlert
 *   (OPS_ALERT 채널, DAR-473 P01). 멱등 자연키 dedupeKey='biweekly-track-review:<앵커기준 회차>'
 *   로 회차당 1건만 적재된다. 본문은 한국어 평문(이모지 미사용 — 2026-07-06 표기 개정).
 *
 * ★실행 헬스: CronRunRecorder 로 CronRunLog(jobKey=ops.biweekly-track-review)에 남겨 freshness
 *   안전망에 노출(FRESHNESS_JOB_SPECS 등록 — 격주 카덴스 허용시간). 겹침 가드 + throw 금지.
 * ★read-only 관측·알림 전용 — 매매/주문/Kill Switch 무접점(M10 클록 보호)·AI 개입 0.
 */
@Injectable()
export class BiweeklyTrackReviewScheduler {
  private readonly logger = new Logger(BiweeklyTrackReviewScheduler.name);

  /** 겹침 가드 — 한 사이클이 끝날 때까지 다음 진입을 막는다. */
  private isRunning = false;

  constructor(
    private readonly reviewService: BiweeklyTrackReviewService,
    private readonly producer: NotificationProducerService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매주 일요일 10:00 KST — 격주 게이트 통과 시 리포트 생성·발송. 스킵/실패 시 null. */
  @Cron('0 10 * * 0', { timeZone: KST_TIMEZONE })
  async runWeekly(now: Date = new Date()): Promise<BiweeklyTrackReview | null> {
    if (this.isRunning) {
      this.logger.warn('이전 격주 리포트가 진행 중 — 이번 사이클 스킵(겹침 방지)');
      return null;
    }
    this.isRunning = true;
    try {
      const ymd = formatKstDateCompact(now);
      if (!isReviewSunday(ymd)) {
        // 격주 오프 주 — 발송 0. SKIPPED 를 남겨 '크론 살아있음'을 표면화(DAR-503 패턴).
        this.logger.log(`[TrackReview] 오프 주 일요일(격주 게이트) — 스킵 ymd=${ymd}`);
        await this.recorder?.recordSkip(CRON_JOB_KEYS.BIWEEKLY_TRACK_REVIEW);
        return null;
      }
      const run = (): Promise<BiweeklyTrackReview> => this.publish(now, ymd);
      if (!this.recorder) {
        return await run();
      }
      // 마지막 성공시각을 CronRunLog 에 남겨 신선도 판정 입력으로 쓴다(DAR-110 연계).
      return await this.recorder.record(CRON_JOB_KEYS.BIWEEKLY_TRACK_REVIEW, run, {
        countOf: (r) => r.tracks.length,
      });
    } catch (err) {
      // recorder 가 FAILED 를 기록한 뒤 재던진 예외 — cron 스케줄 유지를 위해 흡수한다.
      this.logger.error('[TrackReview] 발송 실패(cron 유지)', err as Error);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  /** 리포트 생성 + OPS_ALERT 발행(INFO — 관측 리포트라 상시 정보 등급). */
  private async publish(now: Date, ymd: string): Promise<BiweeklyTrackReview> {
    const review = await this.reviewService.buildReview(now);
    const cycle = reviewCycleNo(ymd);
    await this.producer.enqueueOpsAlert('INFO', 'biweekly-track-review', review.body, {
      // 앵커 기준 회차 버킷 — 회차당 1건 멱등(재시도·수동 재발화 중복 억제).
      dedupeKey: `biweekly-track-review:${cycle}`,
      deepLink: '/portfolio',
      data: {
        periodStartKst: review.periodStartKst,
        periodEndKst: review.periodEndKst,
        windowDays: review.windowDays,
        regimeTrend: review.regime?.trend ?? null,
        topTracks: review.tracks.slice(0, 3).map((t) => ({
          trackKey: t.trackKey,
          returnPct: t.returnPct,
          lowSample: t.lowSample,
        })),
      },
    });
    this.logger.log(
      `[TrackReview] cycle=${cycle} period=${review.periodStartKst}~${review.periodEndKst} ` +
        `tracks=${review.tracks.length} top=${review.tracks[0]?.trackKey ?? '-'} ` +
        `regime=${review.regime?.trend ?? 'N/A'}`,
    );
    return review;
  }
}
