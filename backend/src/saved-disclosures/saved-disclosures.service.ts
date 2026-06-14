import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSavedDisclosureDto } from './dto/create-saved-disclosure.dto';

@Injectable()
export class SavedDisclosuresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    const items = await this.prisma.savedDisclosure.findMany({
      where: { userId },
      include: {
        disclosure: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        savedAt: item.createdAt,
        ...item.disclosure,
      })),
      total: items.length,
    };
  }

  async create(userId: string, dto: CreateSavedDisclosureDto) {
    const disclosure = await this.prisma.disclosure.findUnique({
      where: { rcpNo: dto.rcpNo },
    });

    if (!disclosure) {
      throw new NotFoundException('Disclosure not found');
    }

    try {
      const item = await this.prisma.savedDisclosure.create({
        data: {
          userId,
          disclosureRcpNo: dto.rcpNo,
        },
        include: { disclosure: true },
      });

      return {
        id: item.id,
        savedAt: item.createdAt,
        ...item.disclosure,
      };
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Disclosure already saved');
      }
      // 선검증(findUnique)과 insert 사이에 해당 공시 행이 삭제·프루닝되는 경쟁(TOCTOU)에서는
      // 여전히 FK 위반(P2003)이 날 수 있다. 사라진 입력이므로 5xx 로 새지 않게 404 로 매핑한다.
      if (error.code === 'P2003') {
        throw new NotFoundException('Disclosure not found');
      }
      throw error;
    }
  }

  async remove(userId: string, id: string) {
    const item = await this.prisma.savedDisclosure.findFirst({
      where: { id, userId },
    });

    if (!item) {
      throw new NotFoundException('Saved disclosure not found');
    }

    await this.prisma.savedDisclosure.delete({
      where: { id },
    });
  }

  async removeByRcpNo(userId: string, rcpNo: string) {
    const item = await this.prisma.savedDisclosure.findUnique({
      where: {
        userId_disclosureRcpNo: { userId, disclosureRcpNo: rcpNo },
      },
    });

    if (!item) {
      throw new NotFoundException('Saved disclosure not found');
    }

    await this.prisma.savedDisclosure.delete({
      where: { id: item.id },
    });
  }

  async isSaved(userId: string, rcpNo: string): Promise<boolean> {
    const item = await this.prisma.savedDisclosure.findUnique({
      where: {
        userId_disclosureRcpNo: { userId, disclosureRcpNo: rcpNo },
      },
    });
    return !!item;
  }
}
