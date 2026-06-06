/**
 * Persona 철학 엔진 P-A — 시드 데이터 정합성 + 조회 어댑터 매핑 단위 테스트 (DAR-48)
 *
 * DB 불필요(단위). 시드 데이터 불변식과 PrismaPhilosophyRepository 의 매핑을 검증한다.
 */
import { PHILOSOPHY_SEEDS } from './philosophy.seed-data';
import { PrismaPhilosophyRepository } from './adapters/prisma-philosophy.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('PHILOSOPHY_SEEDS (P-A 시드 데이터)', () => {
  it('철학 4종(버핏·린치·그린블라트·드러켄밀러)이 정확히 존재한다', () => {
    const ids = PHILOSOPHY_SEEDS.map((p) => p.philosophyId).sort();
    expect(ids).toEqual(['BUFFETT', 'DRUCKENMILLER', 'GREENBLATT', 'LYNCH']);
  });

  it('philosophyId 는 중복 없는 대문자 자연키다', () => {
    const ids = PHILOSOPHY_SEEDS.map((p) => p.philosophyId);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[A-Z_]+$/));
  });

  describe.each(PHILOSOPHY_SEEDS.map((p) => [p.philosophyId, p] as const))(
    '%s',
    (_id, p) => {
      it('지표 가중치 합이 1.0 이다', () => {
        const sum = p.metrics.reduce((acc, m) => acc + m.weight, 0);
        expect(sum).toBeCloseTo(1.0, 6);
      });

      it('metricKey 가 철학 내에서 유일하다(시드 멱등성 전제)', () => {
        const keys = p.metrics.map((m) => m.metricKey);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('핵심 원칙 3~7개·체크리스트·리스크성향·출처 ≥1 을 갖춘다', () => {
        expect(p.corePrinciples.length).toBeGreaterThanOrEqual(3);
        expect(p.corePrinciples.length).toBeLessThanOrEqual(7);
        expect(p.checklistItems.length).toBeGreaterThan(0);
        expect(p.riskProfile.length).toBeGreaterThan(0);
        expect(p.sources.length).toBeGreaterThanOrEqual(1);
        expect(p.styleTags.length).toBeGreaterThan(0);
        expect(p.applicableAssets.length).toBeGreaterThan(0);
      });

      it('모든 지표의 weight 는 0~1, RANGE 연산자만 thresholdMax 를 갖는다', () => {
        p.metrics.forEach((m) => {
          expect(m.weight).toBeGreaterThan(0);
          expect(m.weight).toBeLessThanOrEqual(1);
          if (m.operator === 'RANGE') {
            expect(typeof m.thresholdMax).toBe('number');
          }
          expect(['GT', 'LT', 'EQ', 'RANGE']).toContain(m.operator);
        });
      });
    },
  );
});

describe('PrismaPhilosophyRepository (조회 어댑터 매핑)', () => {
  const buffettRow = {
    philosophyId: 'BUFFETT',
    investorName: '워렌 버핏 (Warren Buffett)',
    styleTags: ['VALUE', 'MOAT'],
    corePrinciples: ['해자'],
    applicableAssets: ['KR_STOCK'],
    checklistItems: ['해자 유지?'],
    riskProfile: '보수적',
    scoreFormula: 'ROE×20...',
    metrics: [
      { metricKey: 'ROE', operator: 'GT', threshold: 15, thresholdMax: null, weight: 0.2, description: 'ROE ≥ 15%' },
    ],
    sources: [
      { type: 'SHAREHOLDER_LETTER', title: '주주서한', year: 1977, url: 'https://x' },
    ],
  };

  function makeRepo(prismaMock: unknown): PrismaPhilosophyRepository {
    return new PrismaPhilosophyRepository(prismaMock as PrismaService);
  }

  it('findAll 이 prisma row 를 PhilosophyView 로 매핑한다', async () => {
    const findMany = jest.fn().mockResolvedValue([buffettRow]);
    const repo = makeRepo({ investorPhilosophy: { findMany } });

    const result = await repo.findAll();

    expect(findMany).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].philosophyId).toBe('BUFFETT');
    expect(result[0].metrics[0]).toEqual({
      metricKey: 'ROE',
      operator: 'GT',
      threshold: 15,
      thresholdMax: null,
      weight: 0.2,
      description: 'ROE ≥ 15%',
    });
    expect(result[0].sources[0].type).toBe('SHAREHOLDER_LETTER');
  });

  it('findById 가 없으면 null 을 반환한다', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repo = makeRepo({ investorPhilosophy: { findUnique } });

    expect(await repo.findById('NONE')).toBeNull();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { philosophyId: 'NONE' } }),
    );
  });

  it('findByStyleTag 이 has 필터로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([buffettRow]);
    const repo = makeRepo({ investorPhilosophy: { findMany } });

    const result = await repo.findByStyleTag('VALUE');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { styleTags: { has: 'VALUE' } } }),
    );
    expect(result[0].styleTags).toContain('VALUE');
  });
});
