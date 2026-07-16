import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TesterEventName } from './dto/record-tester-event.dto';

/**
 * TesterEventService — 테스터 코호트 인앱 행동 계측 적재 + 오픈율·재방문 집계 (DAR-516, Wave A/A6).
 *
 * FunnelService(비인증 온보딩 퍼널)의 인증판 형제. 로그인 후 인앱 참여 이벤트를 userId로 적재하고,
 * 12인 테스터 코호트의 오픈율·재방문을 KST 일 버킷으로 집계한다(수용기준 3).
 *
 * ★ PII 무수집(수용기준 1): userId(인증)·event(화이트리스트)·createdAt(서버 스탬프 ts)만 적재.
 * ★ 계측은 제품 경로가 아니다: DB 적재 실패가 호출자(모바일 fire-and-forget)에게 5xx로 튀지
 *   않도록 여기서 흡수하고 warn 로그만 남긴다(무소음 실패 허용).
 * ★ M10 무오염: engine5(매매/리스크) 테이블·실주문·킬스위치 미접촉 — 신규 tester_events 만 사용.
 */
@Injectable()
export class TesterEventService {
  private readonly logger = new Logger(TesterEventService.name);

  /** 집계 기본 관측창(일). 테스터 클록(7/22) 이후 코호트 관측에 충분한 창. */
  static readonly DEFAULT_WINDOW_DAYS = 14;
  static readonly MAX_WINDOW_DAYS = 90;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 이벤트 1건 기록. 실패는 흡수(계측 손실은 warn 로그로만 관측).
   * @returns 기록 성공 여부(true=적재됨, false=흡수된 실패)
   */
  async record(userId: string, event: TesterEventName): Promise<boolean> {
    try {
      await this.prisma.testerEvent.create({ data: { userId, event } });
      return true;
    } catch (e) {
      this.logger.warn(
        `테스터 이벤트 기록 실패(흡수): event=${event} — ${(e as Error)?.message || String(e)}`,
      );
      return false;
    }
  }

  /**
   * 오픈율·재방문 집계(수용기준 3, "쿼리 1종").
   *
   * 헤드라인 지표는 단일 집계 쿼리(CTE)로 산출한다:
   *   - openRate    = 관측창 내 edition_open 을 1회 이상 발화한 고유 사용자 / 전체 활동 사용자
   *   - revisitRate = 관측창 내 활동일(KST) ≥2 인 고유 사용자 / 전체 활동 사용자
   * createdAt 은 naive-UTC(TIMESTAMP)로 저장되므로 KST 일 버킷은
   *   `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'` 이중 변환으로 파생한다(DAR-505 패턴).
   *
   * @param windowDays 관측창(일). 1~MAX_WINDOW_DAYS 로 클램프.
   */
  async cohortMetrics(windowDays: number = TesterEventService.DEFAULT_WINDOW_DAYS) {
    const days = Math.min(
      Math.max(1, Math.trunc(windowDays) || TesterEventService.DEFAULT_WINDOW_DAYS),
      TesterEventService.MAX_WINDOW_DAYS,
    );

    // 헤드라인 집계 — 단일 쿼리(오픈율·재방문). 사용자별로 활동일 수·에디션/푸시 오픈 여부를
    // 접은 뒤 코호트 수준 카운트로 롤업한다. 모든 카운트는 ::int 캐스트(JS number 반환).
    const [row] = await this.prisma.$queryRaw<
      Array<{
        total_users: number;
        edition_open_users: number;
        push_open_users: number;
        revisit_users: number;
      }>
    >`
      WITH windowed AS (
        SELECT
          "userId",
          "event",
          ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS kst_day
        FROM "tester_events"
        WHERE "createdAt" >= (NOW() AT TIME ZONE 'UTC') - (${days} * INTERVAL '1 day')
      ),
      per_user AS (
        SELECT
          "userId",
          COUNT(DISTINCT kst_day) AS active_days,
          BOOL_OR("event" = 'edition_open') AS opened_edition,
          BOOL_OR("event" = 'push_open') AS opened_push
        FROM windowed
        GROUP BY "userId"
      )
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE opened_edition)::int AS edition_open_users,
        COUNT(*) FILTER (WHERE opened_push)::int AS push_open_users,
        COUNT(*) FILTER (WHERE active_days >= 2)::int AS revisit_users
      FROM per_user
    `;

    const totalUsers = row?.total_users ?? 0;
    const editionOpenUsers = row?.edition_open_users ?? 0;
    const pushOpenUsers = row?.push_open_users ?? 0;
    const revisitUsers = row?.revisit_users ?? 0;
    const rate = (n: number) => (totalUsers > 0 ? Number((n / totalUsers).toFixed(4)) : 0);

    // 이벤트별 브레이크다운(보조) — 관측창 내 이벤트별 총 발화 수. 헤드라인 지표는 위 단일 쿼리.
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.testerEvent.groupBy({
      by: ['event'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const byEvent = grouped
      .map((g) => ({ event: g.event, count: g._count._all }))
      .sort((a, b) => b.count - a.count);

    return {
      windowDays: days,
      since: since.toISOString(),
      totalUsers,
      editionOpenUsers,
      pushOpenUsers,
      revisitUsers,
      openRate: rate(editionOpenUsers),
      revisitRate: rate(revisitUsers),
      byEvent,
    };
  }
}
