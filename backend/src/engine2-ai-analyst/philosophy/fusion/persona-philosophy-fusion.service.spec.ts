/**
 * persona-philosophy-fusion.service.spec.ts — DAR-72 (Persona P-C)
 *
 * 결합 서비스 검증(모킹된 의존):
 *  1) 철학 fit + 저장 AI 뷰 → 거장별 결합, 결합점수 내림차순 정렬
 *  2) 신규 AI 호출 0 — 저장된 personaViews 만 조회(LlmClient 의존 없음)
 *  3) AI 뷰 결측(personaViews null) → 철학 축만으로 폴백
 *  4) 재무 결측(noFinancials) → 철학 축 전부 미가용, AI 축만으로 결합
 *
 * AI 금지영역: 서비스는 저장 산출물만 읽는다 — LLM 미주입.
 */
import { PersonaPhilosophyFusionService } from './persona-philosophy-fusion.service';
import { PhilosophyFitService } from '../philosophy-fit.service';
import { PhilosophyRepository } from '../ports/philosophy.repository';
import { PersonaViewRepository } from './ports/persona-view.repository';

const PHILOSOPHIES = [
  {
    philosophyId: 'BUFFETT',
    investorName: '워렌 버핏',
    styleTags: ['VALUE', 'MOAT'],
    corePrinciples: [],
    applicableAssets: [],
    checklistItems: [],
    riskProfile: 'LOW',
    scoreFormula: null,
    metrics: [],
    sources: [],
  },
  {
    philosophyId: 'DRUCKENMILLER',
    investorName: '드러켄밀러',
    styleTags: ['MACRO', 'MOMENTUM'],
    corePrinciples: [],
    applicableAssets: [],
    checklistItems: [],
    riskProfile: 'HIGH',
    scoreFormula: null,
    metrics: [],
    sources: [],
  },
];

function makeService(opts: {
  fits: any[];
  noFinancials?: boolean;
  views: any | null;
}) {
  const philosophyFit = {
    getCompanyFit: jest.fn().mockResolvedValue({
      corpCode: '00126380',
      financialBasis: opts.noFinancials
        ? null
        : { bsnsYear: '2023', reprtCode: '11011', fsDiv: 'CFS' },
      noFinancials: opts.noFinancials ?? false,
      fits: opts.fits,
    }),
  } as unknown as PhilosophyFitService;

  const philosophies = {
    findAll: jest.fn().mockResolvedValue(PHILOSOPHIES),
  } as unknown as PhilosophyRepository;

  const personaViews = {
    findLatestByCorpCode: jest.fn().mockResolvedValue(opts.views),
  } as unknown as PersonaViewRepository;

  return {
    service: new PersonaPhilosophyFusionService(
      philosophyFit,
      philosophies,
      personaViews,
    ),
    philosophyFit,
    personaViews,
  };
}

function fit(philosophyId: string, investorName: string, score: number | null) {
  return {
    philosophyId,
    investorName,
    computable: score != null,
    score,
    totalMetrics: 5,
    evaluatedCount: score != null ? 4 : 0,
    omittedMetricKeys: [],
    passedMetricKeys: [],
    failedMetricKeys: [],
    breakdown: [],
  };
}

describe('PersonaPhilosophyFusionService', () => {
  it('거장별 결합 + 결합점수 내림차순 정렬', async () => {
    const { service } = makeService({
      fits: [fit('BUFFETT', '워렌 버핏', 60), fit('DRUCKENMILLER', '드러켄밀러', 90)],
      views: {
        rcpNo: '20230101000001',
        corpCode: '00126380',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        views: [
          { persona: 'CONSERVATIVE', interpretation: '안정', fitScore: 80 },
          { persona: 'AGGRESSIVE', interpretation: '공격', fitScore: 75 },
        ],
      },
    });

    const res = await service.getCompanyFusion('00126380');
    expect(res.fusions).toHaveLength(2);
    // 내림차순 — 첫 결합점수 ≥ 둘째
    expect(res.fusions[0].fusionScore).toBeGreaterThanOrEqual(
      res.fusions[1].fusionScore as number,
    );
    expect(res.aiBasis).toEqual({
      rcpNo: '20230101000001',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    // BUFFETT→CONSERVATIVE, DRUCKENMILLER→AGGRESSIVE 각각 매핑
    const buffett = res.fusions.find((f) => f.philosophyId === 'BUFFETT')!;
    expect(buffett.mappedPersona).toBe('CONSERVATIVE');
    expect(buffett.personaView.available).toBe(true);
  });

  it('신규 AI 호출 0 — 저장된 personaViews 만 조회', async () => {
    const { service, personaViews } = makeService({
      fits: [fit('BUFFETT', '워렌 버핏', 60)],
      views: {
        rcpNo: 'r1',
        corpCode: '00126380',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        views: [{ persona: 'CONSERVATIVE', interpretation: 'x', fitScore: 50 }],
      },
    });
    await service.getCompanyFusion('00126380');
    expect(personaViews.findLatestByCorpCode).toHaveBeenCalledWith('00126380');
    // 서비스는 LlmClient 를 주입받지 않는다(생성자 인자 3개 — fit/repo/views)
    expect(PersonaPhilosophyFusionService.length).toBe(3);
  });

  it('AI 뷰 결측(null) → 철학 축만으로 폴백', async () => {
    const { service } = makeService({
      fits: [fit('BUFFETT', '워렌 버핏', 70)],
      views: null,
    });
    const res = await service.getCompanyFusion('00126380');
    expect(res.aiBasis).toBeNull();
    const f = res.fusions[0];
    expect(f.personaView.available).toBe(false);
    expect(f.fusionScore).toBe(70); // 철학 단독
  });

  it('재무 결측(noFinancials) → 철학 축 미가용, AI 축만 결합', async () => {
    const { service } = makeService({
      noFinancials: true,
      fits: [fit('BUFFETT', '워렌 버핏', null)],
      views: {
        rcpNo: 'r1',
        corpCode: '00126380',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        views: [{ persona: 'CONSERVATIVE', interpretation: 'x', fitScore: 90 }],
      },
    });
    const res = await service.getCompanyFusion('00126380');
    expect(res.noFinancials).toBe(true);
    const f = res.fusions[0];
    expect(f.philosophyScore).toBeNull();
    expect(f.personaFitScore).not.toBeNull();
    expect(f.fusionScore).toBe(f.personaFitScore);
  });
});
