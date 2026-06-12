import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { formatRcpThreshold } from './watchlist.util';

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

    // 마지막 조회 시각(lastViewedAt, 없으면 등록 시각) 이후 신규 공시 수 파생(DAR-165).
    // rcpDt(YYYYMMDD[HHmmss], KST 문자열) > KST 임계 문자열 = 신규. 항목별 임계값이 달라 항목 단위 count.
    const newCounts = await Promise.all(
      watchlist.map((item) => {
        const threshold = formatRcpThreshold(item.lastViewedAt ?? item.createdAt);
        return this.prisma.disclosure.count({
          where: { corpCode: item.corpCode, rcpDt: { gt: threshold } },
        });
      }),
    );

    const items = watchlist.map(({ company, ...item }, idx) => ({
      ...item,
      stockCode: company?.stockCode ?? null,
      market: company?.market ?? null,
      lastDisclosureDate: latestMap.get(item.corpCode) ?? null,
      newDisclosureCount: newCounts[idx],
    }));

    return {
      items,
      total: items.length,
      limit: MAX_WATCHLIST_COUNT,
    };
  }

  /**
   * 종목 상세 진입 등으로 사용자가 해당 종목을 조회했음을 기록한다(DAR-165).
   * lastViewedAt 을 현재 시각으로 갱신 → 이후 신규 공시 카운트가 0으로 리셋(배지 소거).
   * 관심목록에 없는 종목이면 no-op(영향 행 0).
   */
  async markViewed(userId: string, corpCode: string) {
    const result = await this.prisma.watchList.updateMany({
      where: { userId, corpCode },
      data: { lastViewedAt: new Date() },
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
