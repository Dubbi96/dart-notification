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
