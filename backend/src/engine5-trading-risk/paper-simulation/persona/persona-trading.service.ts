/**
 * PersonaTradingService — persona별 모의운용 성과 + 현재 장 적합 persona 추천 (DAR-130, P-D)
 *
 * 사용자 지시(2026-06-08): persona 4종(VALUE/MACRO/QUANTITATIVE/GROWTH ≡ 거장 철학)별로 모의투자를
 * 각각 돌리고, 현재 장에 어떤 persona가 맞을지 판단한다.
 *
 * - persona별 독립 모의 포트폴리오·일일 사이클·성과 누적: 기존 PhilosophyStyleSimulationService 재사용
 *   (DAR-76, 스타일 전용 포트폴리오 4트랙 분리 운용). 본 서비스는 그 위에 추천 레이어를 얹는다.
 * - 현재 장 적합 persona: MarketRegimeService(레짐) + 최근 성과 → recommendPersonas(결정론적 룰).
 *
 * ★ read-only — 신규 수집·AI 0. 추천 점수/판단은 전부 순수 Rule(AI 금지영역 불가침).
 */

import { Injectable } from '@nestjs/common';
import {
  PhilosophyStyleSimulationService,
  StylePerformance,
  AllStylesCycleResult,
} from '../philosophy-style-simulation.service';
import { MarketRegimeService } from './market-regime.service';
import { MarketRegime } from './market-regime';
import {
  recommendPersonas,
  PersonaPerformanceRow,
  PersonaRecommendation,
  PERSONA_ARCHETYPE,
  RankedPersona,
} from './persona-recommendation';

/** persona 1종의 성과 + 추천 정보 결합 행. */
export interface PersonaOverviewRow {
  /** 기반 스타일 성과(자산곡선·성적표·졸업지표·lowSample). */
  performance: StylePerformance;
  archetype: string;
  regimeFitScore: number;
  compositeScore: number;
  recommended: boolean;
  rationale: string;
}

/** persona별 모의운용 종합 응답. */
export interface PersonaOverview {
  initialCapital: number;
  /** 현재 시장 레짐(추세·변동성·이벤트분포). */
  regime: MarketRegime;
  /** 복합점수 내림차순 정렬된 persona 행. */
  personas: PersonaOverviewRow[];
  /** 추천 persona(1~2개) style 목록. */
  recommended: string[];
  /** 표본<30 미유의 — 결론 과신 금지. */
  dataLimited: boolean;
  significantSampleThreshold: number;
  /** 비교 랭킹(누적수익률 기준, DAR-76 재사용). */
  lowSampleThreshold: number;
  minEntryFit: number;
}

@Injectable()
export class PersonaTradingService {
  constructor(
    private readonly styleSim: PhilosophyStyleSimulationService,
    private readonly regimeService: MarketRegimeService,
  ) {}

  /** persona 4종 1일치 사이클 수동 실행(독립 포트폴리오 분기 운용). */
  async runDailyCycle(tradeDate: string): Promise<AllStylesCycleResult> {
    return this.styleSim.runDailyCycleAllStyles(tradeDate);
  }

  /** 현재 시장 레짐만 조회(추천 근거 단독 노출용). */
  async getRegime(): Promise<MarketRegime> {
    return this.regimeService.getCurrentRegime();
  }

  /** persona별 성과 + 현재 장 적합 persona 추천 종합. */
  async getOverview(): Promise<PersonaOverview> {
    const comparison = await this.styleSim.getStyleComparison();
    const regime = await this.regimeService.getCurrentRegime();

    const rows: PersonaPerformanceRow[] = comparison.styles.map((s) => ({
      style: s.style,
      cumulativeReturnPct: s.scorecard.cumulativeReturnPct,
      mddPct: s.graduation.mddPct,
      hitRatePct: s.graduation.hitRatePct,
      sampleSize: s.scorecard.sampleSize,
    }));

    const recommendation: PersonaRecommendation = recommendPersonas(rows, regime);

    const byStyle = new Map<string, StylePerformance>();
    for (const s of comparison.styles) byStyle.set(s.style, s);

    // 복합점수 순(recommendation.ranked)으로 성과를 결합.
    const personas: PersonaOverviewRow[] = recommendation.ranked
      .map((r: RankedPersona) => {
        const perf = byStyle.get(r.style);
        if (!perf) return null;
        return {
          performance: perf,
          archetype: r.archetype,
          regimeFitScore: r.regimeFitScore,
          compositeScore: r.compositeScore,
          recommended: r.recommended,
          rationale: r.rationale,
        } as PersonaOverviewRow;
      })
      .filter((x): x is PersonaOverviewRow => x !== null);

    return {
      initialCapital: comparison.initialCapital,
      regime,
      personas,
      recommended: recommendation.recommended,
      dataLimited: recommendation.dataLimited,
      significantSampleThreshold: recommendation.significantSampleThreshold,
      lowSampleThreshold: comparison.lowSampleThreshold,
      minEntryFit: comparison.minEntryFit,
    };
  }
}

// PERSONA_ARCHETYPE 재노출(컨트롤러/문서에서 매핑 참조 가능).
export { PERSONA_ARCHETYPE };
