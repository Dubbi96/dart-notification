import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        name: true,
        updatedAt: true,
      },
    });

    return user;
  }

  // ── Pro 출시 알림 사전신청 (갭분석 W1) ──────────────────────────────────
  // 기존 모바일 로컬 보관(useSettingsStore.proWaitlistOptIn)은 수요 데이터가
  // 서버에 남지 않아 계측이 불가능했다. ProWaitlistEntry(userId unique) 1행으로
  // 유일한 지불의사 계측기를 켠다. 신청/철회 모두 멱등이다.

  /**
   * Pro 사전신청 등록 — upsert 라 재호출해도 행이 늘지 않고(멱등),
   * 최초 신청 시각(createdAt)이 보존된다.
   */
  async joinProWaitlist(userId: string) {
    const entry = await this.prisma.proWaitlistEntry.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return { optedIn: true, createdAt: entry.createdAt };
  }

  /**
   * Pro 사전신청 철회 — deleteMany 라 미신청 상태에서 호출해도 에러 없이
   * no-op(멱등). 철회 후 상태를 그대로 반환한다.
   */
  async leaveProWaitlist(userId: string) {
    await this.prisma.proWaitlistEntry.deleteMany({ where: { userId } });
    return { optedIn: false, createdAt: null as Date | null };
  }

  /** 본인 Pro 사전신청 여부 조회. 미신청이면 optedIn=false, createdAt=null. */
  async getProWaitlistStatus(userId: string) {
    const entry = await this.prisma.proWaitlistEntry.findUnique({
      where: { userId },
    });
    return {
      optedIn: entry !== null,
      createdAt: entry?.createdAt ?? null,
    };
  }
}
