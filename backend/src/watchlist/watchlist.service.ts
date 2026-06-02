import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';

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

    const items = watchlist.map(({ company, ...item }) => ({
      ...item,
      stockCode: company?.stockCode ?? null,
      market: company?.market ?? null,
      lastDisclosureDate: latestMap.get(item.corpCode) ?? null,
    }));

    return {
      items,
      total: items.length,
      limit: MAX_WATCHLIST_COUNT,
    };
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
