import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatKstDateDashed, kstDayStart } from '../common/time/kst';

/**
 * W5 리얼타임성 ③: 공시 알림 지연 계측 — '감지→푸시' 일별 p50/p95.
 *
 * ★지표 정의(정직성 계약): DART list API 의 rcept_dt 는 '일자'뿐 접수 '시각'이 없다.
 *   따라서 진짜 E2E(접수→푸시)는 측정 불가하고, 본 지표는
 *   감지(Disclosure.createdAt = 폴링이 공시를 DB에 적재한 시각) →
 *   푸시 발송(NotificationHistory.sentAt = 인박스 생성·푸시 발송 시각)
 *   구간만 정직하게 측정한다. 응답 필드명(detectToPush*)에도 이 정의를 반영한다.
 *   부풀린 수치가 발각되면 '측정치 공표' 전략 자체가 부채로 반전되므로 정의를 코드로 고정.
 *
 * ★전부 기존 테이블(Disclosure·NotificationHistory) 집계 — 신규 테이블·수집·외부호출·AI 0.
 */
export const DETECT_TO_PUSH_DEFINITION =
  '감지(Disclosure.createdAt: 폴링 적재 시각)→푸시 발송(NotificationHistory.sentAt) 지연. ' +
  'DART API 에는 접수 시각이 없어(rcept_dt 는 일자뿐) 접수→푸시 E2E 가 아닌 감지→푸시를 측정한다.';

/** 윈도 상한(일) — 전량 메모리 집계라 과도한 스캔을 막는다. */
const MAX_WINDOW_DAYS = 30;
const DEFAULT_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * nearest-rank 백분위수 — 오름차순 정렬 배열에서 p(0~100) 백분위 값.
 * 표본 0건이면 null. 순수 함수(테스트 결정론).
 */
export function percentileNearestRank(
  sortedAscMs: number[],
  p: number,
): number | null {
  const n = sortedAscMs.length;
  if (n === 0) return null;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAscMs[rank - 1];
}

/** 일별(KST) 감지→푸시 지연 집계 1행. */
export interface DisclosureLatencyDaily {
  /** KST 일자(YYYY-MM-DD) — 푸시 발송 시각 기준 버킷. */
  kstDate: string;
  /** 표본 수 = 해당 일자 발송된 공시(DISCLOSURE) 알림 건수. */
  count: number;
  /** 감지→푸시 p50(ms). 표본 0건이면 null. */
  detectToPushP50Ms: number | null;
  /** 감지→푸시 p95(ms). 표본 0건이면 null. */
  detectToPushP95Ms: number | null;
  /** 감지→푸시 최대(ms). 표본 0건이면 null. */
  detectToPushMaxMs: number | null;
}

/** 감지→푸시 지연 리포트. */
export interface DisclosureLatencyReport {
  metric: 'disclosure-detect-to-push';
  /** 지표 정의(정직성 계약) — DART 접수시각 부재로 '감지→푸시'만 측정함을 명시. */
  definition: string;
  /** 집계 윈도(일, KST 일자 기준 오늘 포함). */
  windowDays: number;
  generatedAt: string;
  /** 최신 일자 우선 정렬. 표본이 없는 일자는 행을 만들지 않는다. */
  daily: DisclosureLatencyDaily[];
}

@Injectable()
export class NotificationLatencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 공시(DISCLOSURE) 알림의 감지→푸시 지연을 KST 일별 p50/p95 로 집계한다.
   *
   * @param days 집계 윈도(1~30, 기본 7) — KST 오늘 자정 기준 최근 N일.
   */
  async getDisclosureLatencyDaily(
    days: number = DEFAULT_WINDOW_DAYS,
  ): Promise<DisclosureLatencyReport> {
    const windowDays = Math.min(
      MAX_WINDOW_DAYS,
      Math.max(1, Math.trunc(days) || DEFAULT_WINDOW_DAYS),
    );
    const now = new Date();
    const since = new Date(
      kstDayStart(now).getTime() - (windowDays - 1) * MS_PER_DAY,
    );

    // 공시 알림만(백필은 matchAndNotify 자체를 건너뛰므로 전부 라이브 발송분).
    const rows = await this.prisma.notificationHistory.findMany({
      where: {
        type: NotificationType.DISCLOSURE,
        disclosureRcpNo: { not: null },
        sentAt: { gte: since },
      },
      select: {
        sentAt: true,
        disclosure: { select: { createdAt: true } },
      },
    });

    const byDay = new Map<string, number[]>();
    for (const row of rows) {
      if (!row.disclosure) continue; // 고아 방어(FK nullable 계약)
      const latencyMs =
        row.sentAt.getTime() - row.disclosure.createdAt.getTime();
      if (latencyMs < 0) continue; // 시계 역전 방어(지표 오염 차단)
      const key = formatKstDateDashed(row.sentAt);
      const bucket = byDay.get(key);
      if (bucket) {
        bucket.push(latencyMs);
      } else {
        byDay.set(key, [latencyMs]);
      }
    }

    const daily: DisclosureLatencyDaily[] = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // 최신 일자 우선
      .map(([kstDate, values]) => {
        values.sort((a, b) => a - b);
        return {
          kstDate,
          count: values.length,
          detectToPushP50Ms: percentileNearestRank(values, 50),
          detectToPushP95Ms: percentileNearestRank(values, 95),
          detectToPushMaxMs: values.length > 0 ? values[values.length - 1] : null,
        };
      });

    return {
      metric: 'disclosure-detect-to-push',
      definition: DETECT_TO_PUSH_DEFINITION,
      windowDays,
      generatedAt: now.toISOString(),
      daily,
    };
  }
}
