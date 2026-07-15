import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';
import {
  FUNNEL_STEPS,
  RecordFunnelEventDto,
} from './dto/record-funnel-event.dto';

/**
 * 갭분석 W15 ③ — POST /ops/funnel 온보딩 퍼널 계측 유닛 스펙.
 *
 * 1) 컨트롤러: 서비스 위임 + success 플래그 매핑(적재 실패도 흡수 응답).
 * 2) 서비스: prisma 적재 데이터 형태 · meta 크기 캡 · DB 예외 흡수(계측 무소음 실패).
 * 3) DTO: 5단계 화이트리스트 · anonId 길이 · meta 객체 검증(비인증 입력 가드).
 */
describe('FunnelController (POST /ops/funnel)', () => {
  const buildController = (recordResult: boolean) => {
    const service = {
      record: jest.fn().mockResolvedValue(recordResult),
    } as unknown as jest.Mocked<FunnelService>;
    return { controller: new FunnelController(service), service };
  };

  const dto: RecordFunnelEventDto = {
    anonId: '6f0c2b3e-8a41-4b7d-9d2f-1c5e7a9b3d10',
    step: 'intro',
    meta: { from: 'carousel' },
  };

  it('서비스에 dto 그대로 위임하고 적재 성공 시 success:true 를 반환한다', async () => {
    const { controller, service } = buildController(true);
    await expect(controller.record(dto)).resolves.toEqual({ success: true });
    expect(service.record).toHaveBeenCalledTimes(1);
    expect(service.record).toHaveBeenCalledWith(dto);
  });

  it('적재 실패(흡수)여도 throw 하지 않고 success:false 로 응답한다 — 계측 전용 표면', async () => {
    const { controller } = buildController(false);
    await expect(controller.record(dto)).resolves.toEqual({ success: false });
  });
});

describe('FunnelService.record', () => {
  const buildService = (createImpl?: () => Promise<unknown>) => {
    const create = jest.fn(createImpl ?? (() => Promise.resolve({})));
    const prisma = { funnelEvent: { create } };
    // PrismaService 전체 목 대신 사용 표면(funnelEvent.create)만 좁게 목킹.
    const service = new FunnelService(prisma as never);
    return { service, create };
  };

  it('anonId+step+meta 를 funnelEvent 로 적재한다', async () => {
    const { service, create } = buildService();
    const ok = await service.record({
      anonId: 'anon-12345678',
      step: 'watchlist',
      meta: { selectedCount: 3 },
    });
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: {
        anonId: 'anon-12345678',
        step: 'watchlist',
        meta: { selectedCount: 3 },
      },
    });
  });

  it('meta 미전달 시 meta:undefined 로 적재한다(이벤트 자체는 기록)', async () => {
    const { service, create } = buildService();
    await service.record({ anonId: 'anon-12345678', step: 'install' });
    expect(create).toHaveBeenCalledWith({
      data: { anonId: 'anon-12345678', step: 'install', meta: undefined },
    });
  });

  it('meta 직렬화 길이가 상한(2048)을 넘으면 meta 만 버리고 이벤트는 기록한다', async () => {
    const { service, create } = buildService();
    const oversized = { blob: 'x'.repeat(FunnelService.META_MAX_JSON_LENGTH + 1) };
    const ok = await service.record({
      anonId: 'anon-12345678',
      step: 'push_permission',
      meta: oversized,
    });
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { anonId: 'anon-12345678', step: 'push_permission', meta: undefined },
    });
  });

  it('직렬화 불가(순환 참조) meta 도 버리고 이벤트는 기록한다', async () => {
    const { service, create } = buildService();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await service.record({ anonId: 'anon-12345678', step: 'kakao', meta: circular });
    expect(create).toHaveBeenCalledWith({
      data: { anonId: 'anon-12345678', step: 'kakao', meta: undefined },
    });
  });

  it('DB 예외를 흡수하고 false 를 반환한다 — 호출자(모바일)에 5xx 미전파', async () => {
    const { service } = buildService(() => Promise.reject(new Error('db down')));
    await expect(
      service.record({ anonId: 'anon-12345678', step: 'install' }),
    ).resolves.toBe(false);
  });
});

describe('RecordFunnelEventDto 검증(비인증 입력 가드)', () => {
  const validateDto = async (plain: Record<string, unknown>) =>
    validate(plainToInstance(RecordFunnelEventDto, plain));

  it('5단계 화이트리스트 전수가 유효하다', async () => {
    for (const step of FUNNEL_STEPS) {
      const errors = await validateDto({ anonId: 'anon-12345678', step });
      expect(errors).toHaveLength(0);
    }
  });

  it('허용 외 step 은 거부한다', async () => {
    const errors = await validateDto({ anonId: 'anon-12345678', step: 'purchase' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('step');
  });

  it('anonId 길이(8~64) 위반은 거부한다', async () => {
    const tooShort = await validateDto({ anonId: 'short', step: 'install' });
    expect(tooShort.length).toBeGreaterThan(0);

    const tooLong = await validateDto({ anonId: 'x'.repeat(65), step: 'install' });
    expect(tooLong.length).toBeGreaterThan(0);
  });

  it('meta 는 객체만 허용한다(문자열 등 비객체 거부)', async () => {
    const errors = await validateDto({
      anonId: 'anon-12345678',
      step: 'intro',
      meta: 'not-an-object',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('meta');
  });
});
