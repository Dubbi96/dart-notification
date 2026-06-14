import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { resolveCursor, newCountMapFromGrouped } from './watchlist.util';

const MAX_WATCHLIST_COUNT = 30;

@Injectable()
export class WatchlistService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    const watchlist = await this.prisma.watchList.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        company: {
          select: { stockCode: true, market: true },
        },
      },
    });

    const corpCodes = watchlist.map((w) => w.corpCode);

    // 각 기업의 최근 공시 날짜 조회
    const latestDisclosures = corpCodes.length > 0
      ? await this.prisma.disclosure.groupBy({
          by: ['corpCode'],
          where: { corpCode: { in: corpCodes } },
          _max: { rcpDt: true },
        })
      : [];

    const latestMap = new Map(
      latestDisclosures.map((d) => [d.corpCode, d._max.rcpDt]),
    );

    // 마지막으로 본 rcpNo 커서(없으면 등록일 floor) 이후 신규 공시 수 파생(DAR-185).
    // rcpNo(='YYYYMMDD'+일련번호) > 커서 = 신규. rcpDt(일 단위)와 달리 같은 날 안의
    // 순서까지 보존되어 당일 공시도 정확히 집계된다.
    //
    // 항목별 커서(lastViewedRcpNo)가 달라 단일 groupBy 로는 셀 수 없었고, 기존에는 항목당
    // disclosure.count 를 Promise.all 로 N건 병렬 발행했다(DAR-214 N+1). 진입 빈도가 높은
    // 화면에서 종목 수만큼 대용량 Disclosure count 가 동시 발행되는 부하다.
    //
    // 해결: (corpCode, 커서) 쌍을 VALUES 로 만들어 disclosures 와 LEFT JOIN → corpCode 별
    // 그룹 count 를 단일 raw 쿼리로 1회 집계한다(N→1). LEFT JOIN 이라 신규 0건 종목도 행이
    // 남고, corpCode 는 사용자별 유니크(@@unique([userId, corpCode]))라 항목과 1:1 매핑된다.
    // 동일 술어(rcpNo > cursor)라 배지 수치는 기존과 정확히 일치한다. (corpCode, rcpNo)
    // 복합 인덱스가 이 조인 조건을 직접 서빙한다(DAR-214 마이그레이션).
    const newCountMap = await this.countNewDisclosures(watchlist);

    const items = watchlist.map(({ company, ...item }) => ({
      ...item,
      stockCode: company?.stockCode ?? null,
      market: company?.market ?? null,
      lastDisclosureDate: latestMap.get(item.corpCode) ?? null,
      newDisclosureCount: newCountMap.get(item.corpCode) ?? 0,
    }));

    return {
      items,
      total: items.length,
      limit: MAX_WATCHLIST_COUNT,
    };
  }

  /**
   * 워치리스트 각 항목의 (corpCode, 커서) 쌍을 VALUES 로 묶어 disclosures 와 LEFT JOIN,
   * corpCode 별 신규(rcpNo > 커서) 공시 수를 단일 쿼리로 집계한다(DAR-214 N→1).
   * 반환: corpCode → 신규 공시 수 Map. 빈 워치리스트면 쿼리 없이 빈 Map.
   *
   * 각 VALUES 값은 ::text 캐스팅해 Postgres 의 컬럼 타입 추론 모호성을 제거하고,
   * COUNT(...)::int 로 bigint 대신 number 로 받는다(JS number 직매핑).
   */
  private async countNewDisclosures(
    watchlist: { corpCode: string; lastViewedRcpNo: string | null; createdAt: Date }[],
  ): Promise<Map<string, number>> {
    if (watchlist.length === 0) {
      return new Map();
    }

    const cursorRows = Prisma.join(
      watchlist.map((item) => {
        const cursor = resolveCursor(item.lastViewedRcpNo, item.createdAt);
        return Prisma.sql`(${item.corpCode}::text, ${cursor}::text)`;
      }),
    );

    // 컬럼은 Prisma 필드명을 그대로 쓰는 camelCase 라 큰따옴표 인용 필수("corpCode"/"rcpNo").
    // VALUES 별칭(v.corp_code/v.cursor)은 자체 명명이라 비인용 소문자.
    const grouped = await this.prisma.$queryRaw<
      { corpCode: string; count: number }[]
    >(Prisma.sql`
      SELECT v.corp_code AS "corpCode", COUNT(d."rcpNo")::int AS "count"
      FROM (VALUES ${cursorRows}) AS v(corp_code, cursor)
      LEFT JOIN disclosures d
        ON d."corpCode" = v.corp_code AND d."rcpNo" > v.cursor
      GROUP BY v.corp_code
    `);

    return newCountMapFromGrouped(grouped);
  }

  /**
   * 종목 상세 진입 등으로 사용자가 해당 종목을 조회했음을 기록한다(DAR-165/DAR-185).
   * 현재 그 종목의 최신 공시 rcpNo 를 커서로 고정 → 이후 더 큰 rcpNo(같은 날 포함)만 신규로
   * 집계되어 배지가 0 으로 리셋된다. 공시가 아직 하나도 없으면 커서는 변경하지 않는다
   * (등록일 floor 폴백 유지 → 향후 들어올 공시가 정상적으로 신규로 잡힘).
   * 관심목록에 없는 종목이면 no-op(영향 행 0).
   */
  async markViewed(userId: string, corpCode: string) {
    const latest = await this.prisma.disclosure.aggregate({
      where: { corpCode },
      _max: { rcpNo: true },
    });

    const data: { lastViewedAt: Date; lastViewedRcpNo?: string } = {
      lastViewedAt: new Date(),
    };
    if (latest._max.rcpNo) {
      data.lastViewedRcpNo = latest._max.rcpNo;
    }

    const result = await this.prisma.watchList.updateMany({
      where: { userId, corpCode },
      data,
    });
    return { updated: result.count };
  }

  async create(userId: string, dto: CreateWatchlistDto) {
    // 동시성: count→create 는 비원자적이라 서로 다른 corpCode 병렬 추가가
    // 각각 count(<30) 통과 후 모두 insert → MAX_WATCHLIST_COUNT 초과 가능(DAR-179).
    // 사용자 단위 트랜잭션 advisory lock 으로 같은 userId 의 추가를 직렬화하면
    // 트랜잭션 안의 count→create 가 원자적으로 보장된다(스키마 변경 불필요).
    try {
      return await this.prisma.$transaction(async (tx) => {
        // pg_advisory_xact_lock: 트랜잭션 종료 시 자동 해제. 같은 userId 끼리만 직렬화
        // (hashtextextended 로 cuid → bigint 키). 다른 사용자는 경합 없이 병렬 진행.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;

        const count = await tx.watchList.count({ where: { userId } });
        if (count >= MAX_WATCHLIST_COUNT) {
          throw new UnprocessableEntityException(
            'Watchlist limit exceeded (max 30)',
          );
        }

        return tx.watchList.create({
          data: {
            userId,
            corpCode: dto.corpCode,
            corpName: dto.corpName,
          },
        });
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Company already in watchlist');
      }
      throw error;
    }
  }

  async remove(userId: string, id: string) {
    const item = await this.prisma.watchList.findFirst({
      where: { id, userId },
    });

    if (!item) {
      throw new NotFoundException('Watchlist item not found');
    }

    await this.prisma.watchList.delete({
      where: { id },
    });
  }
}
