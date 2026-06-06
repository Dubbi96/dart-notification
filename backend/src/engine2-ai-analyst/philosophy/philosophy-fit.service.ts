/**
 * Persona 철학 엔진 P-B — 종목 철학 적합도 조회 서비스 (DAR-53)
 *
 * on-demand 계산(무스키마): PhilosophyScore 테이블 없이, 요청 시점에
 * CompanyFinancial 최신 스냅샷 + InvestorPhilosophy 지표를 결합해 적합도를 산출한다.
 * 영속화 없음 → 기존 데이터 무손상, 스키마 변경 0.
 *
 * 순수 Rule — AI 미개입. 시그널/종목 화면 "거장별 적합도" 노출용 데이터 제공.
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §4 P-B
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PhilosophyRepository } from './ports/philosophy.repository';
import {
  FinancialQueryService,
  FinancialSnapshot,
} from '../../engine1-disclosure/financials/financial-query.service';
import {
  PhilosophyFitScore,
  scorePhilosophyFit,
} from './scoring/philosophy.scorer';

/** 종목 1건에 대한 전체 철학 적합도 응답 */
export interface CompanyPhilosophyFit {
  corpCode: string;
  /** 적합도 산정에 사용한 재무 스냅샷 메타(없으면 null) */
  financialBasis: {
    bsnsYear: string;
    reprtCode: string;
    fsDiv: string;
  } | null;
  /** 재무 결측으로 평가 불가하면 true(fits 빈 배열) */
  noFinancials: boolean;
  /** 철학별 적합도(점수 내림차순; computable=false는 후순위) */
  fits: PhilosophyFitScore[];
}

@Injectable()
export class PhilosophyFitService {
  constructor(
    private readonly philosophies: PhilosophyRepository,
    private readonly financials: FinancialQueryService,
  ) {}

  /** 종목 × 전체 철학 적합도(거장별 적합도). 재무 없으면 noFinancials=true. */
  async getCompanyFit(
    corpCode: string,
    fsDiv = 'CFS',
  ): Promise<CompanyPhilosophyFit> {
    const snap = await this.financials.getLatest(corpCode, fsDiv);
    if (!snap) {
      return {
        corpCode,
        financialBasis: null,
        noFinancials: true,
        fits: [],
      };
    }

    const philosophies = await this.philosophies.findAll();
    const fits = philosophies
      .map((p) => scorePhilosophyFit(p, snap))
      .sort(byScoreDesc);

    return {
      corpCode,
      financialBasis: basisOf(snap),
      noFinancials: false,
      fits,
    };
  }

  /** 철학 1종 × 종목 적합도. 철학 미존재 시 404. 재무 없으면 computable=false. */
  async getPhilosophyFit(
    philosophyId: string,
    corpCode: string,
    fsDiv = 'CFS',
  ): Promise<{
    philosophyId: string;
    corpCode: string;
    financialBasis: CompanyPhilosophyFit['financialBasis'];
    noFinancials: boolean;
    fit: PhilosophyFitScore | null;
  }> {
    const philosophy = await this.philosophies.findById(philosophyId);
    if (!philosophy) {
      throw new NotFoundException(`철학을 찾을 수 없습니다: ${philosophyId}`);
    }

    const snap = await this.financials.getLatest(corpCode, fsDiv);
    if (!snap) {
      return {
        philosophyId,
        corpCode,
        financialBasis: null,
        noFinancials: true,
        fit: null,
      };
    }

    return {
      philosophyId,
      corpCode,
      financialBasis: basisOf(snap),
      noFinancials: false,
      fit: scorePhilosophyFit(philosophy, snap),
    };
  }
}

function basisOf(snap: FinancialSnapshot): CompanyPhilosophyFit['financialBasis'] {
  return { bsnsYear: snap.bsnsYear, reprtCode: snap.reprtCode, fsDiv: snap.fsDiv };
}

/** computable=true 우선, 그 다음 점수 내림차순. */
function byScoreDesc(a: PhilosophyFitScore, b: PhilosophyFitScore): number {
  if (a.computable !== b.computable) return a.computable ? -1 : 1;
  return (b.score ?? -1) - (a.score ?? -1);
}
