/**
 * position-thesis.service.spec.ts
 * - DAR-249: findExitSignal reasons 매핑이 exitScore 6컴포넌트 전부를 노출하는지 회귀.
 *   기존엔 lossRisk/thesisBreak/chartBreak/timeExceeded 4개만 매핑되어
 *   disclosureRiskScore·overweightScore>0 인 EXIT가 '사유없음'처럼 보임.
 *   AI 금지영역: 이 테스트는 표시(reasons) plumbing만 검증한다.
 */

import { PositionThesisService } from './position-thesis.service';
import type { PrismaService } from '../../prisma/prisma.service';

interface ScoreOverrides {
  lossRiskScore?: number;
  thesisBreakScore?: number;
  chartBreakScore?: number;
  disclosureRiskScore?: number;
  overweightScore?: number;
  timeExceededScore?: number;
}

function makeSignal(scores: ScoreOverrides) {
  return {
    id: 'exit-001',
    positionId: 'pos-001',
    exitScore: 80,
    exitAction: 'EXIT',
    scoreDetail: {},
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    lossRiskScore: 0,
    thesisBreakScore: 0,
    chartBreakScore: 0,
    disclosureRiskScore: 0,
    overweightScore: 0,
    timeExceededScore: 0,
    ...scores,
  };
}

function makeService(signal: ReturnType<typeof makeSignal> | null) {
  const findFirst = jest.fn().mockResolvedValue(signal);
  const prisma = {
    exitSignal: { findFirst },
  } as unknown as PrismaService;
  return { service: new PositionThesisService(prisma), findFirst };
}

describe('PositionThesisService.findExitSignal — reasons 매핑 (DAR-249)', () => {
  it('exitSignal이 없으면 null', async () => {
    const { service } = makeService(null);
    expect(await service.findExitSignal('user-1', 'pos-001')).toBeNull();
  });

  it.each([
    ['lossRiskScore', 'lossRisk'],
    ['thesisBreakScore', 'thesisBreak'],
    ['chartBreakScore', 'chartBreak'],
    ['disclosureRiskScore', 'disclosureRisk'],
    ['overweightScore', 'overweight'],
    ['timeExceededScore', 'timeExceeded'],
  ] as Array<[keyof ScoreOverrides, string]>)(
    '%s > 0 이면 reasons에 %s 단건 매핑',
    async (field, reason) => {
      const { service } = makeService(makeSignal({ [field]: 30 }));
      const result = await service.findExitSignal('user-1', 'pos-001');
      expect(result?.reasons).toEqual([reason]);
    },
  );

  it('disclosureRisk 단건 EXIT도 사유가 노출된다 (회귀: 과거 누락)', async () => {
    const { service } = makeService(makeSignal({ disclosureRiskScore: 100 }));
    const result = await service.findExitSignal('user-1', 'pos-001');
    expect(result?.reasons).toContain('disclosureRisk');
    expect(result?.reasons).not.toHaveLength(0);
  });

  it('6컴포넌트 전부 양수면 6사유 모두 매핑 (schema 순서)', async () => {
    const { service } = makeService(
      makeSignal({
        lossRiskScore: 10,
        thesisBreakScore: 10,
        chartBreakScore: 10,
        disclosureRiskScore: 10,
        overweightScore: 10,
        timeExceededScore: 10,
      }),
    );
    const result = await service.findExitSignal('user-1', 'pos-001');
    expect(result?.reasons).toEqual([
      'lossRisk',
      'thesisBreak',
      'chartBreak',
      'disclosureRisk',
      'overweight',
      'timeExceeded',
    ]);
  });

  it('0점 컴포넌트는 매핑 제외', async () => {
    const { service } = makeService(
      makeSignal({ lossRiskScore: 0, overweightScore: 50 }),
    );
    const result = await service.findExitSignal('user-1', 'pos-001');
    expect(result?.reasons).toEqual(['overweight']);
  });
});
