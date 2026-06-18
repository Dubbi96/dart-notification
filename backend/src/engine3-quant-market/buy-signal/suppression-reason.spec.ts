/**
 * suppression-reason.spec.ts — DAR-323
 *
 * '왜 강한 신호가 아닌지' 억제 사유 도출 검증(순수 매핑, 점수 산식 무관):
 *  1) 각 omit 케이스 → 해당 enum (단일 omit 격리)
 *  2) BUY 이상 → null
 *  3) BLOCKED → null (blockedReason 전담)
 *  4) omit 없음 + BUY 미만 → GENUINELY_NEUTRAL
 *  5) 복수 omit → 우선순위 대표 1개 + 전체 목록
 *
 * AI 금지영역: 순수 Rule 검증.
 */

import { BucketKey } from './scoring/bucket-renormalization';
import { SignalGrade } from './buy-signal.service';
import {
  SuppressionReason,
  deriveSuppressionReason,
} from './suppression-reason';

describe('deriveSuppressionReason (DAR-323)', () => {
  describe('각 omit 케이스 → 해당 enum (WATCH 등급 기준, 단일 omit)', () => {
    const cases: Array<[BucketKey, SuppressionReason]> = [
      ['historicalEvent', 'EVENT_STUDY_DARK'],
      ['chart', 'INDICATORS_MISSING'],
      ['volumeLiquidity', 'INDICATORS_MISSING'],
      ['keyMetric', 'UNMODELED_EVENT'],
      ['personaFit', 'NO_POLARITY'],
    ];

    it.each(cases)('omit [%s] → %s', (omitted, expected) => {
      const out = deriveSuppressionReason('WATCH', [omitted]);
      expect(out.reason).toBe(expected);
      expect(out.reasons).toEqual([expected]);
    });
  });

  describe('BUY 이상 → null (충분히 강한 신호)', () => {
    const buyGrades: SignalGrade[] = [
      'STRONG_BUY_CANDIDATE',
      'BUY_CANDIDATE',
    ];
    it.each(buyGrades)('%s → null (omit 이 있어도 사유 없음)', (grade) => {
      const out = deriveSuppressionReason(grade, [
        'historicalEvent',
        'keyMetric',
        'personaFit',
      ]);
      expect(out.reason).toBeNull();
      expect(out.reasons).toEqual([]);
    });
  });

  it('BLOCKED → null (blockedReason 전담, omit 무관)', () => {
    const out = deriveSuppressionReason('BLOCKED', [
      'chart',
      'historicalEvent',
      'keyMetric',
      'personaFit',
    ]);
    expect(out.reason).toBeNull();
    expect(out.reasons).toEqual([]);
  });

  it('omit 없음 + BUY 미만 → GENUINELY_NEUTRAL (정직하게 약함)', () => {
    for (const grade of ['WATCH', 'NEUTRAL', 'AVOID'] as SignalGrade[]) {
      const out = deriveSuppressionReason(grade, []);
      expect(out.reason).toBe('GENUINELY_NEUTRAL');
      expect(out.reasons).toEqual(['GENUINELY_NEUTRAL']);
    }
  });

  describe('복수 omit → 우선순위 대표 1개 + 전체 목록', () => {
    it('historicalEvent + keyMetric + personaFit → EVENT_STUDY_DARK 대표', () => {
      const out = deriveSuppressionReason('NEUTRAL', [
        'keyMetric',
        'personaFit',
        'historicalEvent',
      ]);
      // 입력 순서와 무관하게 우선순위(EVENT_STUDY_DARK 최상위)로 대표 선정
      expect(out.reason).toBe('EVENT_STUDY_DARK');
      expect(out.reasons).toEqual([
        'EVENT_STUDY_DARK',
        'UNMODELED_EVENT',
        'NO_POLARITY',
      ]);
    });

    it('chart + volumeLiquidity 동시 omit → INDICATORS_MISSING 1개로 합쳐짐(중복 없음)', () => {
      const out = deriveSuppressionReason('WATCH', ['chart', 'volumeLiquidity']);
      expect(out.reason).toBe('INDICATORS_MISSING');
      expect(out.reasons).toEqual(['INDICATORS_MISSING']);
    });

    it('전 우선순위 omit → 목록 정렬 보존, GENUINELY_NEUTRAL 미포함', () => {
      const out = deriveSuppressionReason('AVOID', [
        'personaFit',
        'keyMetric',
        'chart',
        'historicalEvent',
      ]);
      expect(out.reason).toBe('EVENT_STUDY_DARK');
      expect(out.reasons).toEqual([
        'EVENT_STUDY_DARK',
        'INDICATORS_MISSING',
        'UNMODELED_EVENT',
        'NO_POLARITY',
      ]);
      // 결측 사유가 있으면 GENUINELY_NEUTRAL 은 부여되지 않는다.
      expect(out.reasons).not.toContain('GENUINELY_NEUTRAL');
    });
  });

  it('omittedBuckets 에 사유 매핑이 없는 버킷만 있으면 GENUINELY_NEUTRAL', () => {
    // disclosureEvent/marketSector/insider/fundamental 은 배지 사유에 매핑되지 않음.
    const out = deriveSuppressionReason('WATCH', [
      'marketSector',
      'insider',
      'fundamental',
    ]);
    expect(out.reason).toBe('GENUINELY_NEUTRAL');
    expect(out.reasons).toEqual(['GENUINELY_NEUTRAL']);
  });
});
