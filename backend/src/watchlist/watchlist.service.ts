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
    const count = await this.prisma.watchList.count({
      where: { userId },
    });

    if (count >= MAX_WATCHLIST_COUNT) {
      throw new UnprocessableEntityException('Watchlist limit exceeded (max 30)');
    }

    try {
      const item = await this.prisma.watchList.create({
        data: {
          userId,
          corpCode: dto.corpCode,
          corpName: dto.corpName,
        },
      });

      return item;
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
