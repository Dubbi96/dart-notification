import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecordFunnelEventDto } from './dto/record-funnel-event.dto';

/**
 * FunnelService — 온보딩 퍼널 계측 적재 (갭분석 W15 ③).
 *
 * install→intro→kakao→관심기업→푸시권한 5단계 이벤트를 FunnelEvent 테이블에 기록한다.
 * 계측 전용 표면 — 온보딩 UI/흐름에는 일절 개입하지 않는다(측정만).
 *
 * ★ 계측은 제품 경로가 아니다: DB 적재 실패가 호출자(모바일 fire-and-forget)에게
 *   5xx 로 튀지 않도록 여기서 흡수하고 warn 로그만 남긴다(무소음 실패 허용).
 * ★ meta 는 비인증 입력이므로 직렬화 크기를 상한(META_MAX_JSON_LENGTH)으로 캡 —
 *   초과 시 meta 만 버리고 이벤트 자체(anonId+step)는 기록한다.
 */
@Injectable()
export class FunnelService {
  private readonly logger = new Logger(FunnelService.name);

  /** meta JSON 직렬화 길이 상한 — 비인증 입력의 무한 적재 방지. */
  static readonly META_MAX_JSON_LENGTH = 2048;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 퍼널 이벤트 1건 기록. 실패는 흡수(계측 손실은 warn 로그로만 관측).
   * @returns 기록 성공 여부(true=적재됨, false=흡수된 실패)
   */
  async record(dto: RecordFunnelEventDto): Promise<boolean> {
    try {
      await this.prisma.funnelEvent.create({
        data: {
          anonId: dto.anonId,
          step: dto.step,
          meta: this.sanitizeMeta(dto.meta),
        },
      });
      return true;
    } catch (e) {
      this.logger.warn(
        `퍼널 이벤트 기록 실패(흡수): step=${dto.step} — ${e?.message || String(e)}`,
      );
      return false;
    }
  }

  /**
   * meta 크기 캡: JSON 직렬화 길이가 상한을 넘으면 meta 를 버린다(이벤트는 유지).
   * 직렬화 불가(순환 등) 입력도 동일하게 버린다.
   */
  private sanitizeMeta(
    meta: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (meta === undefined) return undefined;
    try {
      const serialized = JSON.stringify(meta);
      if (serialized === undefined || serialized.length > FunnelService.META_MAX_JSON_LENGTH) {
        return undefined;
      }
      return meta as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
}
