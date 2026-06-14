// backend/src/engine1-disclosure/pipeline/pipeline.controller.spec.ts
// DAR-176(security): 운영 pipeline 변형 엔드포인트 인증 가드 회귀 테스트.
//
// 핵심 가드: drain/reprocess-ai 가 무인증으로 호출되면 backfill 큐·AI 재발행을
// 유발해 DoS·AI 비용을 일으킨다. 컨트롤러 전역에 JwtAuthGuard 가 부착되어
// 무인증 요청이 401 로 차단되는지 회귀 가드한다. (가드 제거 시 이 스펙이 깨진다.)

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PipelineController } from './pipeline.controller';
import { PipelineIntegrityService } from './pipeline-integrity.service';

describe('PipelineController', () => {
  let controller: PipelineController;
  let service: {
    getHealth: jest.Mock;
    drainOnce: jest.Mock;
    reprocessMissingAi: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getHealth: jest.fn(),
      drainOnce: jest.fn(),
      reprocessMissingAi: jest.fn(),
    };
    controller = new PipelineController(
      service as unknown as PipelineIntegrityService,
    );
  });

  describe('인증 가드(DAR-176)', () => {
    it('컨트롤러 전역 가드가 JwtAuthGuard 여야 한다(무인증 401 차단)', () => {
      // Nest 는 @UseGuards 를 GUARDS_METADATA('__guards__') 로 클래스에 부착한다.
      // 무인증(=Bearer 토큰 없음) 요청은 JwtAuthGuard 의 passport-jwt 전략이
      // UnauthorizedException(401) 으로 거절한다.
      const guards = Reflect.getMetadata(
        '__guards__',
        PipelineController,
      ) as unknown[];
      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
    });
  });

  describe('GET /pipeline/health', () => {
    it('서비스 스냅샷을 success 봉투로 매핑한다', async () => {
      const snapshot = { stages: [] };
      service.getHealth.mockResolvedValue(snapshot);

      const result = await controller.health();

      expect(service.getHealth).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, data: snapshot });
    });
  });

  describe('POST /pipeline/drain', () => {
    it('limit 미지정 시 기본 100 으로 drainOnce 위임한다', async () => {
      const drained = { queued: 0 };
      service.drainOnce.mockResolvedValue(drained);

      const result = await controller.drain();

      expect(service.drainOnce).toHaveBeenCalledWith(100);
      expect(result).toEqual({ success: true, data: drained });
    });

    it('limit 을 1..500 으로 클램프한다', async () => {
      service.drainOnce.mockResolvedValue({ queued: 0 });

      await controller.drain('999');
      expect(service.drainOnce).toHaveBeenLastCalledWith(500);

      // DAR-273: 음수는 하한(min=1)으로 클램프(정본 parsePaginationInt 계약).
      await controller.drain('-5');
      expect(service.drainOnce).toHaveBeenLastCalledWith(1);

      await controller.drain('42');
      expect(service.drainOnce).toHaveBeenLastCalledWith(42);
    });
  });

  describe('POST /pipeline/reprocess-ai', () => {
    it('clamp 된 limit 으로 reprocessMissingAi 위임한다', async () => {
      const reprocessed = { republished: 0 };
      service.reprocessMissingAi.mockResolvedValue(reprocessed);

      const result = await controller.reprocessAi('not-a-number');

      // 비수치 → 기본 100
      expect(service.reprocessMissingAi).toHaveBeenCalledWith(100);
      expect(result).toEqual({ success: true, data: reprocessed });
    });
  });
});
