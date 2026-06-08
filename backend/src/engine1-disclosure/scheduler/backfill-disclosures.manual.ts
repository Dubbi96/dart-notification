/**
 * 과거 공시 대량 백필 수동 스크립트 (DAR-129).
 *
 * 목적: 오늘 공시가 아니어도 과거 DART 공시를 전부 끌어와 DB에 적재하여
 *   '정보의 기준'(추이·분석 baseline)을 만든다. 적재분은 isBackfill=true 표식으로
 *   ★라이브 신호 생성·신호 피드·푸시 알림에서 격리된다(불가침). 파싱·이벤트추출은
 *   기존 파이프라인이 그대로 처리하여 Event Study/Buy Score 백테스트 입력으로 활용된다.
 *
 * ★ cron 자동화 아님 — 대량·장시간 작업이므로 사람이 직접 실행한다.
 *
 * 실행:
 *   # 최근 N개월(기본 12) 백필 — 오늘 기준 역산
 *   npx ts-node -r dotenv/config src/engine1-disclosure/scheduler/backfill-disclosures.manual.ts [months]
 *   예: npx ts-node -r dotenv/config src/engine1-disclosure/scheduler/backfill-disclosures.manual.ts 36
 *
 *   # 명시적 날짜 범위 백필 (YYYYMMDD YYYYMMDD)
 *   npx ts-node -r dotenv/config src/engine1-disclosure/scheduler/backfill-disclosures.manual.ts 20230101 20231231
 *
 * 동작:
 *   - [bgnDe, endDe] 구간을 약 30일 윈도로 쪼개 순차 수집(DART list API 페이지네이션 재사용).
 *   - rcpNo 멱등 dedup(filterNewDisclosures)로 이미 적재된 공시는 건너뛴다 → ★중단 후 재실행 = 재개 가능.
 *   - 윈도 간 지연(rate-limit 배려)·진행률 로깅.
 *   - DART_API_KEY 미설정 시 DART API가 graceful 처리(0건). AI 미개입 — 순수 수집.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SchedulerService } from './scheduler.service';

/** 윈도 크기(일). DART list API는 날짜 범위 페이지네이션을 지원하나, 윈도를 잘게 쪼개 재개 단위를 작게 한다. */
const WINDOW_DAYS = 30;
/** 윈도 간 지연(ms). DART rate-limit 배려. */
const WINDOW_DELAY_MS = 1500;

/** YYYYMMDD 문자열 → Date(UTC 자정) */
function parseYmd(ymd: string): Date {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date → YYYYMMDD */
function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Date에 일수 가산(새 Date 반환) */
function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** [bgn, end] 구간을 windowDays 단위 [bgnDe, endDe] 윈도 배열로 분할(오래된 → 최신 순). */
function buildWindows(
  bgn: Date,
  end: Date,
  windowDays: number,
): { bgnDe: string; endDe: string }[] {
  const windows: { bgnDe: string; endDe: string }[] = [];
  let cursor = bgn;
  while (cursor.getTime() <= end.getTime()) {
    const windowEnd = addDays(cursor, windowDays - 1);
    const clampedEnd = windowEnd.getTime() > end.getTime() ? end : windowEnd;
    windows.push({ bgnDe: formatYmd(cursor), endDe: formatYmd(clampedEnd) });
    cursor = addDays(clampedEnd, 1);
  }
  return windows;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** argv를 파싱해 [bgnDe, endDe] 구간을 결정한다. */
function resolveRange(argv: string[]): { bgnDe: string; endDe: string } {
  const a = argv[2];
  const b = argv[3];

  // 명시적 범위: 두 인자 모두 YYYYMMDD(8자리)
  if (a && b && /^\d{8}$/.test(a) && /^\d{8}$/.test(b)) {
    return { bgnDe: a, endDe: b };
  }

  // 최근 N개월: 인자 없거나 숫자 1개
  const months = a ? parseInt(a, 10) : 12;
  const safeMonths = Number.isFinite(months) && months > 0 ? months : 12;
  const end = new Date();
  const bgn = new Date(end.getTime());
  bgn.setUTCMonth(bgn.getUTCMonth() - safeMonths);
  return { bgnDe: formatYmd(bgn), endDe: formatYmd(end) };
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillDisclosuresManual');

  const { bgnDe, endDe } = resolveRange(process.argv);
  const windows = buildWindows(parseYmd(bgnDe), parseYmd(endDe), WINDOW_DAYS);

  logger.log(
    `과거 공시 백필 시작: ${bgnDe} ~ ${endDe} (윈도 ${windows.length}개, isBackfill=true 격리)`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  let totalSaved = 0;
  let totalFetched = 0;
  let failedWindows = 0;

  try {
    const scheduler = app.get(SchedulerService);

    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      try {
        const result = await scheduler.collectByDate(w.bgnDe, w.endDe, 'MANUAL', {
          isBackfill: true,
        });
        totalSaved += result.saved;
        totalFetched += result.total ?? 0;
        logger.log(
          `[${i + 1}/${windows.length}] ${w.bgnDe}~${w.endDe}: 신규 ${result.saved}건 / 조회 ${result.total ?? 0}건 ` +
            `(누적 신규 ${totalSaved}건)`,
        );
      } catch (err) {
        failedWindows++;
        logger.error(
          `[${i + 1}/${windows.length}] ${w.bgnDe}~${w.endDe} 실패 (재실행 시 dedup으로 재개됨): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      // rate-limit 배려 — 마지막 윈도 뒤에는 지연 불필요
      if (i < windows.length - 1) {
        await delay(WINDOW_DELAY_MS);
      }
    }

    logger.log(
      `백필 완료: 누적 신규 ${totalSaved}건 / 조회 ${totalFetched}건 / 실패 윈도 ${failedWindows}개. ` +
        `적재분은 isBackfill=true — 라이브 신호·알림 격리, 분석/백테스트 포함.`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[BackfillDisclosuresManual] 실패:', err);
    process.exit(1);
  });
