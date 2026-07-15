import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

// ─── 계정 삭제(탈퇴) 관계 커버리지 목록 (Play 컴플라이언스 — 갭분석 W3) ───────────────
// users.service.spec.ts 가 Prisma DMMF(스키마 전수)와 아래 목록의 일치를 강제한다.
// 스키마에 User 참조 관계가 새로 생기면 스펙이 실패하므로, 여기 목록과 deleteMe 처리를
// 의식적으로 갱신해야 한다(관계 누락 = 탈퇴 시 개인정보 잔존 사고).

/** User FK 관계 중 DB `onDelete: Cascade` 로 함께 삭제되는 모델 전수. */
export const USER_CASCADE_DELETE_RELATIONS = [
  'ProWaitlistEntry',
  'RefreshToken',
  'UserDevice',
  'WatchList',
  'NotificationSettings',
  'SavedDisclosure',
  'NotificationHistory',
  'Portfolio',
] as const;

/**
 * User FK 관계 중 Cascade 미설정이라 deleteMe 트랜잭션이 명시 삭제해야 하는 모델.
 * 현재 스키마는 전 관계가 Cascade 라 비어 있다 — Cascade 없는 관계가 추가되면
 * 스펙이 실패하고, 이 목록 + deleteMe 에 명시 삭제를 함께 추가해야 한다.
 */
export const USER_EXPLICIT_DELETE_MODELS: readonly string[] = [];

/**
 * FK 미강결합(관계 없음)으로 userId 문자열만 보관하는 계측 모델 —
 * 탈퇴 시 행 자체는 통계용으로 남기되 userId 를 null 로 익명화한다.
 */
export const USER_LOOSE_USERID_ANONYMIZE_MODELS = ['SearchMissLog', 'FunnelEvent'] as const;

type LooseUserIdModel = (typeof USER_LOOSE_USERID_ANONYMIZE_MODELS)[number];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  /**
   * FK 미강결합 모델 → 익명화 실행기. Record 키가 목록 union 이라
   * 목록에 모델을 추가하고 실행기를 빠뜨리면 컴파일 에러가 난다.
   */
  private static readonly LOOSE_USERID_ANONYMIZERS: Record<
    LooseUserIdModel,
    (tx: Prisma.TransactionClient, userId: string) => Promise<unknown>
  > = {
    SearchMissLog: (tx, userId) =>
      tx.searchMissLog.updateMany({ where: { userId }, data: { userId: null } }),
    FunnelEvent: (tx, userId) =>
      tx.funnelEvent.updateMany({ where: { userId }, data: { userId: null } }),
  };

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

  /**
   * 계정 삭제(회원 탈퇴) — Play 스토어 계정 삭제 하드 요구사항 (갭분석 W3 퀵윈 (5)).
   *
   * 단일 트랜잭션에서:
   * 1) refresh 토큰 전부 폐기(revoke) — Cascade 로 행이 지워지기 전 의도를 명시
   * 2) FK 미강결합 계측 모델(SearchMissLog·FunnelEvent)의 userId 익명화
   * 3) Cascade 미설정 관계 명시 삭제(현재 없음 — USER_EXPLICIT_DELETE_MODELS 참조)
   * 4) User 삭제 → Cascade 관계(USER_CASCADE_DELETE_RELATIONS)는 DB 가 함께 삭제
   */
  async deleteMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1) refresh 토큰 전부 폐기 — 탈퇴 즉시 재발급(refresh) 불가 보장
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // 2) FK 미강결합 userId 익명화 (개인정보 파기 — 통계 행은 보존)
      for (const model of USER_LOOSE_USERID_ANONYMIZE_MODELS) {
        await UsersService.LOOSE_USERID_ANONYMIZERS[model](tx, userId);
      }

      // 3) Cascade 미설정 관계 명시 삭제 — 현재 스키마엔 없음.
      //    (USER_EXPLICIT_DELETE_MODELS 에 모델이 추가되면 여기서 tx.<model>.deleteMany 필수)

      // 4) User 삭제 — Cascade 관계는 DB 가 함께 정리
      await tx.user.delete({ where: { id: userId } });
    });

    this.logger.log(`계정 삭제 완료: userId=${userId}`);
    return { deleted: true };
  }
}
