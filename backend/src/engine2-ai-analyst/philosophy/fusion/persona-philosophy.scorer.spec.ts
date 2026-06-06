/**
 * persona-philosophy.scorer.spec.ts — DAR-72 (Persona 철학 엔진 P-C)
 *
 * 결합 스코어러 순수 Rule 검증(결정론적):
 *  1) 철학 styleTags → AI persona 매핑 Rule
 *  2) AI fitScore → 이산 view 레이블 버킷(임계 경계)
 *  3) VIEW_SCORE 정규화(-60~100 → 0~100)
 *  4) 두 축 결합 가중평균(0.6/0.4)
 *  5) 결측 폴백 — 철학 결측 / AI 결측 / 양축 결측(재정규화·null)
 *  6) AI 점수 직결 금지 — fitScore 변동이 같은 버킷 내면 결합점수 불변(이산화 증명)
 *  7) 신뢰도·표본·근거 동반(DAR-56 신뢰규약)
 *
 * AI 금지영역: 결합점수는 순수 Rule. AI 는 레이블/텍스트만 제공.
 */
import { VIEW_SCORE } from '../../../engine3-quant-market/buy-signal/config/buy-signal.config';
import {
  AI_VIEW_LABEL_THRESHOLDS,
  FUSION_WEIGHTS,
  bucketAiViewLabel,
  fusePersonaPhilosophy,
  mapPhilosophyToPersona,
  normalizePersonaRaw,
  PhilosophyFitFacet,
  StoredPersonaView,
} from './persona-philosophy.scorer';

function facet(over: Partial<PhilosophyFitFacet> = {}): PhilosophyFitFacet {
  return {
    philosophyId: 'BUFFETT',
    investorName: '워렌 버핏 (Warren Buffett)',
    styleTags: ['VALUE', 'MOAT', 'LONG_TERM'],
    computable: true,
    score: 80,
    evaluatedCount: 4,
    totalMetrics: 5,
    ...over,
  };
}

function view(
  persona: string,
  fitScore: number,
  interpretation = '해석',
): StoredPersonaView {
  return { persona, interpretation, fitScore };
}

describe('mapPhilosophyToPersona — 철학 스타일 → AI persona Rule', () => {
  it('VALUE/MOAT → CONSERVATIVE', () => {
    expect(mapPhilosophyToPersona(['VALUE', 'MOAT', 'LONG_TERM'])).toBe(
      'CONSERVATIVE',
    );
    expect(mapPhilosophyToPersona(['VALUE', 'QUANTITATIVE'])).toBe(
      'CONSERVATIVE',
    );
  });

  it('GROWTH/GARP → BALANCED', () => {
    expect(mapPhilosophyToPersona(['GROWTH', 'GARP'])).toBe('BALANCED');
  });

  it('MOMENTUM/MACRO → AGGRESSIVE (우선순위 최상)', () => {
    expect(mapPhilosophyToPersona(['MACRO', 'MOMENTUM'])).toBe('AGGRESSIVE');
    // 모멘텀이 가치보다 우선
    expect(mapPhilosophyToPersona(['VALUE', 'MOMENTUM'])).toBe('AGGRESSIVE');
  });

  it('대소문자 무관, 매칭 없으면 BALANCED', () => {
    expect(mapPhilosophyToPersona(['value'])).toBe('CONSERVATIVE');
    expect(mapPhilosophyToPersona([])).toBe('BALANCED');
    expect(mapPhilosophyToPersona(['UNKNOWN'])).toBe('BALANCED');
  });
});

describe('bucketAiViewLabel — AI fitScore 이산화', () => {
  it('임계 경계', () => {
    expect(bucketAiViewLabel(AI_VIEW_LABEL_THRESHOLDS.POSITIVE)).toBe(
      'POSITIVE',
    );
    expect(bucketAiViewLabel(AI_VIEW_LABEL_THRESHOLDS.POSITIVE - 1)).toBe(
      'WATCH',
    );
    expect(bucketAiViewLabel(AI_VIEW_LABEL_THRESHOLDS.WATCH)).toBe('WATCH');
    expect(bucketAiViewLabel(AI_VIEW_LABEL_THRESHOLDS.NEUTRAL)).toBe('NEUTRAL');
    expect(bucketAiViewLabel(AI_VIEW_LABEL_THRESHOLDS.NEUTRAL - 1)).toBe(
      'NEGATIVE',
    );
    expect(bucketAiViewLabel(0)).toBe('NEGATIVE');
  });
});

describe('normalizePersonaRaw — VIEW_SCORE 정규화', () => {
  it('POSITIVE→100, NEGATIVE→0, NEUTRAL/WATCH 중간', () => {
    expect(normalizePersonaRaw(VIEW_SCORE.POSITIVE)).toBe(100);
    expect(normalizePersonaRaw(VIEW_SCORE.NEGATIVE)).toBe(0);
    // NEUTRAL(0): (0 - -60)/160 *100 = 37.5
    expect(normalizePersonaRaw(VIEW_SCORE.NEUTRAL)).toBe(37.5);
    // WATCH(40): (40+60)/160*100 = 62.5
    expect(normalizePersonaRaw(VIEW_SCORE.WATCH)).toBe(62.5);
  });
});

describe('fusePersonaPhilosophy — 결합(Rule)', () => {
  it('두 축 모두 가용 → 가중평균(0.6 철학 + 0.4 persona)', () => {
    // BUFFETT→CONSERVATIVE, fitScore 90 → POSITIVE(100 raw) → normalize 100
    const f = fusePersonaPhilosophy(facet({ score: 80 }), [
      view('CONSERVATIVE', 90),
    ]);
    expect(f.mappedPersona).toBe('CONSERVATIVE');
    expect(f.philosophyScore).toBe(80);
    expect(f.personaFitScore).toBe(100);
    // 0.6*80 + 0.4*100 = 88
    expect(f.fusionScore).toBe(88);
    expect(f.computable).toBe(true);
    expect(f.personaView.available).toBe(true);
    expect(f.personaView.view).toBe('POSITIVE');
  });

  it('철학 결측 → persona 축만으로 재정규화(DAR-49)', () => {
    const f = fusePersonaPhilosophy(
      facet({ computable: false, score: null, evaluatedCount: 0 }),
      [view('CONSERVATIVE', 90)],
    );
    expect(f.philosophyScore).toBeNull();
    // persona 단독 → 재정규화하면 personaFitScore 그대로
    expect(f.fusionScore).toBe(f.personaFitScore);
    expect(f.computable).toBe(true);
  });

  it('AI 관점 결측 → 철학 축만으로 재정규화', () => {
    const f = fusePersonaPhilosophy(facet({ score: 70 }), []);
    expect(f.personaFitScore).toBeNull();
    expect(f.personaView.available).toBe(false);
    expect(f.fusionScore).toBe(70);
    expect(f.computable).toBe(true);
  });

  it('양축 결측 → computable=false, fusionScore=null', () => {
    const f = fusePersonaPhilosophy(
      facet({ computable: false, score: null, evaluatedCount: 0 }),
      [],
    );
    expect(f.fusionScore).toBeNull();
    expect(f.computable).toBe(false);
    expect(f.confidence.level).toBe('LOW');
    expect(f.confidence.value).toBe(0);
  });

  it('mappedPersona 외 다른 persona 만 저장됨 → AI 축 미가용', () => {
    const f = fusePersonaPhilosophy(facet(), [view('AGGRESSIVE', 90)]);
    expect(f.personaView.available).toBe(false);
    expect(f.personaFitScore).toBeNull();
    expect(f.fusionScore).toBe(f.philosophyScore);
  });

  it('AI 점수 직결 금지 — 같은 버킷 내 fitScore 변동은 결합점수 불변', () => {
    const base = fusePersonaPhilosophy(facet(), [view('CONSERVATIVE', 72)]);
    const higher = fusePersonaPhilosophy(facet(), [view('CONSERVATIVE', 99)]);
    // 72·99 모두 POSITIVE 버킷 → personaFit·fusion 동일(이산화 증명)
    expect(base.personaFitScore).toBe(higher.personaFitScore);
    expect(base.fusionScore).toBe(higher.fusionScore);
  });

  it('NEGATIVE 뷰는 결합점수를 낮춘다', () => {
    const pos = fusePersonaPhilosophy(facet({ score: 80 }), [
      view('CONSERVATIVE', 90),
    ]);
    const neg = fusePersonaPhilosophy(facet({ score: 80 }), [
      view('CONSERVATIVE', 10),
    ]);
    expect(neg.personaView.view).toBe('NEGATIVE');
    expect(neg.fusionScore).toBeLessThan(pos.fusionScore as number);
  });

  it('신뢰도·표본·근거 동반(DAR-56)', () => {
    const f = fusePersonaPhilosophy(
      facet({ evaluatedCount: 5, totalMetrics: 5 }),
      [view('CONSERVATIVE', 90)],
    );
    // 양축 가용 + 철학 커버리지 1.0 → confidence 1.0 HIGH
    expect(f.confidence.value).toBe(1);
    expect(f.confidence.level).toBe('HIGH');
    // 표본 = AI 1 + 평가지표 5 = 6
    expect(f.confidence.sampleCount).toBe(6);
    expect(f.basis.length).toBe(2);
    expect(f.basis[0]).toContain('철학 적합도');
    expect(f.basis[1]).toContain('AI 관점');
  });

  it('가중치 상수 합=1.0', () => {
    expect(FUSION_WEIGHTS.philosophy + FUSION_WEIGHTS.persona).toBeCloseTo(1.0);
  });
});
