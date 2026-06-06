/**
 * Persona 철학 엔진 P-C — 결합 합성 서비스 (DAR-72)
 *
 * 거장 철학 × AI 관점 통합 뷰를 산출한다. **신규 AI 호출 0**:
 *   - philosophy-fit: engine2 PhilosophyFitService(순수 Rule, on-demand 재무 평가) 재사용
 *   - AI 관점: DB 저장된 personaViews(PersonaViewRepository)만 조회
 *   - 결합점수: persona-philosophy.scorer 의 순수 Rule(`fusePersonaPhilosophy`)
 *
 * 엔진 경계: engine2 내부에서 완결(engine5 미의존). persona-fit Rule 은 engine3 의
 * 순수 함수만 import(서비스 호출 아님). AI 산출물은 DB 경유로만 읽는다.
 */
import { Injectable } from '@nestjs/common';
import { PhilosophyFitService } from '../philosophy-fit.service';
import { PhilosophyRepository } from '../ports/philosophy.repository';
import { PersonaViewRepository } from './ports/persona-view.repository';
import {
  fusePersonaPhilosophy,
  PersonaPhilosophyFusion,
  PhilosophyFitFacet,
} from './persona-philosophy.scorer';

export interface CompanyPersonaPhilosophyFusion {
  corpCode: string;
  /** 철학 적합도 산정에 쓴 재무 스냅샷 메타(없으면 null) */
  financialBasis: { bsnsYear: string; reprtCode: string; fsDiv: string } | null;
  /** 재무 결측(철학 축 전부 미가용) */
  noFinancials: boolean;
  /** AI 관점 산출물 출처(없으면 null) */
  aiBasis: { rcpNo: string; createdAt: string } | null;
  /** 거장별 결합 결과(결합점수 내림차순; computable=false 후순위) */
  fusions: PersonaPhilosophyFusion[];
}

@Injectable()
export class PersonaPhilosophyFusionService {
  constructor(
    private readonly philosophyFit: PhilosophyFitService,
    private readonly philosophies: PhilosophyRepository,
    private readonly personaViews: PersonaViewRepository,
  ) {}

  async getCompanyFusion(
    corpCode: string,
    fsDiv = 'CFS',
  ): Promise<CompanyPersonaPhilosophyFusion> {
    const [companyFit, philosophyList, latest] = await Promise.all([
      this.philosophyFit.getCompanyFit(corpCode, fsDiv),
      this.philosophies.findAll(),
      this.personaViews.findLatestByCorpCode(corpCode),
    ]);

    // philosophyId → styleTags (persona 매핑용)
    const styleById = new Map<string, string[]>(
      philosophyList.map((p) => [p.philosophyId, p.styleTags]),
    );

    const storedViews = latest?.views ?? [];

    const fusions = companyFit.fits
      .map((fit) => {
        const facet: PhilosophyFitFacet = {
          philosophyId: fit.philosophyId,
          investorName: fit.investorName,
          styleTags: styleById.get(fit.philosophyId) ?? [],
          computable: fit.computable,
          score: fit.score,
          evaluatedCount: fit.evaluatedCount,
          totalMetrics: fit.totalMetrics,
        };
        return fusePersonaPhilosophy(facet, storedViews);
      })
      .sort(byFusionDesc);

    return {
      corpCode,
      financialBasis: companyFit.financialBasis,
      noFinancials: companyFit.noFinancials,
      aiBasis: latest
        ? { rcpNo: latest.rcpNo, createdAt: latest.createdAt.toISOString() }
        : null,
      fusions,
    };
  }
}

/** computable=true 우선, 그 다음 결합점수 내림차순 */
function byFusionDesc(
  a: PersonaPhilosophyFusion,
  b: PersonaPhilosophyFusion,
): number {
  if (a.computable !== b.computable) return a.computable ? -1 : 1;
  return (b.fusionScore ?? -1) - (a.fusionScore ?? -1);
}
