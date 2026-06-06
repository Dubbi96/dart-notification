/**
 * philosophy-fit.service.spec.ts — DAR-53 (Persona P-B)
 *
 * on-demand 적합도 서비스 검증(영속화 없음, 순수 Rule):
 *  1) 종목 × 전체 철학 — 점수 내림차순·computable 우선 정렬
 *  2) 재무 없음 → noFinancials=true, fits 빈 배열
 *  3) 철학 미존재 → 404(NotFound)
 *  4) financialBasis 메타 노출
 */
import { NotFoundException } from '@nestjs/common';
import { PhilosophyFitService } from './philosophy-fit.service';
import { PhilosophyRepository, PhilosophyView } from './ports/philosophy.repository';
import {
  FinancialQueryService,
  FinancialSnapshot,
} from '../../engine1-disclosure/financials/financial-query.service';

const BUFFETT_VIEW: PhilosophyView = {
  philosophyId: 'BUFFETT',
  investorName: '워렌 버핏',
  styleTags: ['VALUE'],
  corePrinciples: [],
  applicableAssets: ['KR_STOCK'],
  checklistItems: [],
  riskProfile: '',
  scoreFormula: null,
  metrics: [
    { metricKey: 'ROE', operator: 'GT', threshold: 15, thresholdMax: null, weight: 0.5, description: '' },
    { metricKey: 'DEBT_RATIO', operator: 'LT', threshold: 50, thresholdMax: null, weight: 0.5, description: '' },
  ],
  sources: [],
};

const LYNCH_VIEW: PhilosophyView = {
  ...BUFFETT_VIEW,
  philosophyId: 'LYNCH',
  investorName: '피터 린치',
  // PER 만 재무 파생 가능, 나머지 결측 → 더 낮은(또는 다른) 점수
  metrics: [
    { metricKey: 'PER', operator: 'LT', threshold: 20, thresholdMax: null, weight: 0.5, description: '' },
    { metricKey: 'PEG', operator: 'LT', threshold: 1, thresholdMax: null, weight: 0.5, description: '' },
  ],
};

const DRUCK_VIEW: PhilosophyView = {
  ...BUFFETT_VIEW,
  philosophyId: 'DRUCKENMILLER',
  investorName: '스탠리 드러켄밀러',
  metrics: [
    { metricKey: 'MACRO_ENV_SCORE', operator: 'GT', threshold: 6, thresholdMax: null, weight: 1, description: '' },
  ],
};

function snap(overrides: Partial<FinancialSnapshot>): FinancialSnapshot {
  return {
    corpCode: '00126380', stockCode: null, bsnsYear: '2025', reprtCode: '11011', fsDiv: 'CFS',
    revenue: null, operatingProfit: null, netIncome: null, totalAssets: null,
    totalLiabilities: null, totalEquity: null, eps: null, bps: null,
    roe: null, roa: null, debtRatio: null, per: null, pbr: null, ...overrides,
  };
}

function makeService(opts: {
  views?: PhilosophyView[];
  byId?: Record<string, PhilosophyView | null>;
  snapshot?: FinancialSnapshot | null;
}): PhilosophyFitService {
  const repo: Partial<PhilosophyRepository> = {
    findAll: async () => opts.views ?? [],
    findById: async (id: string) => opts.byId?.[id] ?? null,
  };
  const fin: Partial<FinancialQueryService> = {
    getLatest: async () => opts.snapshot ?? null,
  };
  return new PhilosophyFitService(
    repo as PhilosophyRepository,
    fin as FinancialQueryService,
  );
}

describe('PhilosophyFitService.getCompanyFit', () => {
  it('전체 철학 적합도를 점수 내림차순·computable 우선으로 반환', async () => {
    const svc = makeService({
      views: [DRUCK_VIEW, LYNCH_VIEW, BUFFETT_VIEW],
      snapshot: snap({ roe: 20, debtRatio: 30, per: 30 }), // 버핏 100, 린치 PER 미달 부분점수
    });
    const res = await svc.getCompanyFit('00126380');
    expect(res.noFinancials).toBe(false);
    expect(res.financialBasis).toEqual({ bsnsYear: '2025', reprtCode: '11011', fsDiv: 'CFS' });
    // computable 우선 → 마지막은 드러켄밀러(computable=false)
    expect(res.fits[res.fits.length - 1].philosophyId).toBe('DRUCKENMILLER');
    expect(res.fits[res.fits.length - 1].computable).toBe(false);
    // 1순위는 버핏(100점)
    expect(res.fits[0].philosophyId).toBe('BUFFETT');
    expect(res.fits[0].score).toBe(100);
  });

  it('재무 없으면 noFinancials=true, fits 빈 배열', async () => {
    const svc = makeService({ views: [BUFFETT_VIEW], snapshot: null });
    const res = await svc.getCompanyFit('99999999');
    expect(res.noFinancials).toBe(true);
    expect(res.fits).toEqual([]);
    expect(res.financialBasis).toBeNull();
  });
});

describe('PhilosophyFitService.getPhilosophyFit', () => {
  it('철학 미존재 → NotFoundException', async () => {
    const svc = makeService({ byId: {}, snapshot: snap({ roe: 20 }) });
    await expect(svc.getPhilosophyFit('NOPE', '00126380')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('철학 존재·재무 있음 → fit 산출', async () => {
    const svc = makeService({
      byId: { BUFFETT: BUFFETT_VIEW },
      snapshot: snap({ roe: 20, debtRatio: 30 }),
    });
    const res = await svc.getPhilosophyFit('BUFFETT', '00126380');
    expect(res.noFinancials).toBe(false);
    expect(res.fit?.score).toBe(100);
  });

  it('철학 존재·재무 없음 → noFinancials=true, fit=null', async () => {
    const svc = makeService({ byId: { BUFFETT: BUFFETT_VIEW }, snapshot: null });
    const res = await svc.getPhilosophyFit('BUFFETT', '00126380');
    expect(res.noFinancials).toBe(true);
    expect(res.fit).toBeNull();
  });
});
