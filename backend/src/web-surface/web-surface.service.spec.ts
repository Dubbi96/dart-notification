import { Test } from '@nestjs/testing';
import { AiTaskName } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebSurfaceService } from './web-surface.service';

describe('WebSurfaceService', () => {
  const disclosureFindUnique = jest.fn();
  const analysisFindUnique = jest.fn();

  const prismaMock = {
    disclosure: { findUnique: disclosureFindUnique },
    disclosureAnalysis: { findUnique: analysisFindUnique },
  };

  let service: WebSurfaceService;

  const disclosureRow = {
    rcpNo: '20260714000123',
    corpName: '삼성전자',
    reportName: '주요사항보고서(유상증자결정)',
    rcpDt: '20260714',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [WebSurfaceService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(WebSurfaceService);
  });

  describe('getSharePage — 정상 분기', () => {
    it('공시 + 캐시 요약이 있으면 found=true, 요약 포함 HTML을 반환한다', async () => {
      disclosureFindUnique.mockResolvedValue(disclosureRow);
      analysisFindUnique.mockResolvedValue({
        resultJson: { summary: '유상증자 결정 요약.', polarity: 'MIXED' },
      });

      const result = await service.getSharePage('20260714000123');

      expect(result.found).toBe(true);
      expect(result.html).toContain('삼성전자');
      expect(result.html).toContain('유상증자 결정 요약.');
      // summary task 캐시만 조회 — 재계산·신규 AI 호출 경로 없음
      expect(analysisFindUnique).toHaveBeenCalledWith({
        where: {
          rcpNo_task: { rcpNo: '20260714000123', task: AiTaskName.summary },
        },
        select: { resultJson: true },
      });
    });

    it('캐시 요약이 없으면 요약 섹션 없이 found=true 를 반환한다', async () => {
      disclosureFindUnique.mockResolvedValue(disclosureRow);
      analysisFindUnique.mockResolvedValue(null);

      const result = await service.getSharePage('20260714000123');

      expect(result.found).toBe(true);
      expect(result.html).toContain('주요사항보고서(유상증자결정)');
      expect(result.html).not.toContain('AI 요약');
    });

    it('resultJson 형식이 어긋나면(요약 문자열 없음) 요약 섹션을 생략한다', async () => {
      disclosureFindUnique.mockResolvedValue(disclosureRow);
      analysisFindUnique.mockResolvedValue({ resultJson: { polarity: 'NEUTRAL' } });

      const result = await service.getSharePage('20260714000123');

      expect(result.found).toBe(true);
      expect(result.html).not.toContain('AI 요약');
    });
  });

  describe('getSharePage — 404 분기', () => {
    it('존재하지 않는 rcpNo 는 found=false + 404 HTML', async () => {
      disclosureFindUnique.mockResolvedValue(null);

      const result = await service.getSharePage('20260714999999');

      expect(result.found).toBe(false);
      expect(result.html).toContain('공시를 찾을 수 없습니다');
      // 공시 자체가 없으면 요약 캐시 조회도 하지 않는다
      expect(analysisFindUnique).not.toHaveBeenCalled();
    });

    it('형식 미달 rcpNo(14자리 숫자 아님)는 DB 조회 없이 404로 수렴한다', async () => {
      const result = await service.getSharePage('<script>alert(1)</script>');

      expect(result.found).toBe(false);
      expect(result.html).toContain('공시를 찾을 수 없습니다');
      expect(disclosureFindUnique).not.toHaveBeenCalled();
      expect(analysisFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('getLandingHtml', () => {
    it('랜딩 HTML을 DB 조회 없이 반환한다', () => {
      const html = service.getLandingHtml();

      expect(html).toContain('공시온');
      expect(html).toContain('투자판단 참고용');
      expect(disclosureFindUnique).not.toHaveBeenCalled();
    });
  });
});
