/**
 * Persona 철학 엔진 — 조회 컨트롤러 스펙 (DAR-54)
 *
 * 핵심 회귀 가드: 철학 조회 3종이 게스트 열람 가능해야 한다(OptionalJwtAuthGuard).
 * JwtAuthGuard 로 되돌아가면(=게스트 401) 이 스펙이 깨진다.
 */
import { BadRequestException } from '@nestjs/common';
import { PhilosophyController } from './philosophy.controller';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PhilosophyRepository } from './ports/philosophy.repository';
import { PhilosophyFitService } from './philosophy-fit.service';

describe('PhilosophyController', () => {
  const repo = {
    findAll: jest.fn(),
    findById: jest.fn(),
    findByStyleTag: jest.fn(),
  } as unknown as jest.Mocked<PhilosophyRepository>;

  const fitService = {
    getPhilosophyFit: jest.fn(),
    getCompanyFit: jest.fn(),
  } as unknown as jest.Mocked<PhilosophyFitService>;

  let controller: PhilosophyController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PhilosophyController(repo, fitService);
  });

  describe('게스트 열람(가드)', () => {
    it('컨트롤러 가드가 OptionalJwtAuthGuard 여야 한다(게스트 401 금지)', () => {
      // Nest 는 @UseGuards 를 GUARDS_METADATA('__guards__') 로 클래스에 부착한다.
      const guards = Reflect.getMetadata('__guards__', PhilosophyController) as unknown[];
      expect(guards).toBeDefined();
      expect(guards).toContain(OptionalJwtAuthGuard);
    });
  });

  describe('GET /philosophies', () => {
    it('styleTag 없으면 findAll 을 사용한다', async () => {
      (repo.findAll as jest.Mock).mockResolvedValue([{ philosophyId: 'BUFFETT' }]);
      const res = await controller.list();
      expect(repo.findAll).toHaveBeenCalledTimes(1);
      expect(repo.findByStyleTag).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true, data: [{ philosophyId: 'BUFFETT' }] });
    });

    it('styleTag 있으면 findByStyleTag 로 필터한다', async () => {
      (repo.findByStyleTag as jest.Mock).mockResolvedValue([{ philosophyId: 'GREENBLATT' }]);
      const res = await controller.list('VALUE');
      expect(repo.findByStyleTag).toHaveBeenCalledWith('VALUE');
      expect(res.data).toEqual([{ philosophyId: 'GREENBLATT' }]);
    });
  });

  describe('GET /philosophies/:id/fit', () => {
    it('corpCode 누락 시 BadRequestException', async () => {
      await expect(controller.philosophyFit('BUFFETT', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fitService.getPhilosophyFit).not.toHaveBeenCalled();
    });

    it('corpCode 있으면 fsDiv 기본 CFS 로 위임한다', async () => {
      (fitService.getPhilosophyFit as jest.Mock).mockResolvedValue({ score: 80 });
      const res = await controller.philosophyFit('BUFFETT', '00126380');
      expect(fitService.getPhilosophyFit).toHaveBeenCalledWith('BUFFETT', '00126380', 'CFS');
      expect(res).toEqual({ success: true, data: { score: 80 } });
    });

    it('fsDiv 지정 시 그대로 전달한다', async () => {
      (fitService.getPhilosophyFit as jest.Mock).mockResolvedValue({ score: 50 });
      await controller.philosophyFit('LYNCH', '00126380', 'OFS');
      expect(fitService.getPhilosophyFit).toHaveBeenCalledWith('LYNCH', '00126380', 'OFS');
    });
  });

  describe('GET /companies/:corpCode/philosophy-fit', () => {
    it('getCompanyFit 에 fsDiv 기본 CFS 로 위임한다', async () => {
      (fitService.getCompanyFit as jest.Mock).mockResolvedValue({ fits: [] });
      const res = await controller.companyFit('00126380');
      expect(fitService.getCompanyFit).toHaveBeenCalledWith('00126380', 'CFS');
      expect(res).toEqual({ success: true, data: { fits: [] } });
    });
  });
});
