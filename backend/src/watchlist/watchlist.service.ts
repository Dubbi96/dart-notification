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
    });

    return {
      items: watchlist,
      total: watchlist.length,
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
