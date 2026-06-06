/**
 * Persona 철학 엔진 P-C — 저장된 AI personaViews Prisma 어댑터 (DAR-72)
 *
 * 읽기 전용. corpCode → 최신 Disclosure 중 personaAnalysis 가 존재하는 건의 resultJson
 * 을 StoredPersonaView[] 로 매핑한다. **신규 AI 호출 없음** — 저장 산출물만 조회.
 *
 * resultJson 은 `PersonaAnalysisDraft[]`(`{persona, interpretation, fitScore}`) 형태.
 * 비정형/결측 항목은 방어적으로 걸러낸다(파이프라인 버전차 내성).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  LatestPersonaViews,
  PersonaViewRepository,
} from '../ports/persona-view.repository';
import { StoredPersonaView } from '../persona-philosophy.scorer';

interface PersonaAnalysisRow {
  rcpNo: string;
  resultJson: unknown;
  createdAt: Date;
  disclosure: { corpCode: string } | null;
}

function coerceViews(resultJson: unknown): StoredPersonaView[] {
  if (!Array.isArray(resultJson)) return [];
  const out: StoredPersonaView[] = [];
  for (const item of resultJson) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const persona = obj.persona;
    const fitScore = obj.fitScore;
    if (typeof persona !== 'string' || typeof fitScore !== 'number') continue;
    if (!Number.isFinite(fitScore)) continue;
    out.push({
      persona,
      interpretation:
        typeof obj.interpretation === 'string' ? obj.interpretation : '',
      fitScore,
    });
  }
  return out;
}

@Injectable()
export class PrismaPersonaViewRepository extends PersonaViewRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findLatestByCorpCode(
    corpCode: string,
  ): Promise<LatestPersonaViews | null> {
    const row = (await this.prisma.personaAnalysis.findFirst({
      where: { disclosure: { corpCode } },
      orderBy: { createdAt: 'desc' },
      select: {
        rcpNo: true,
        resultJson: true,
        createdAt: true,
        disclosure: { select: { corpCode: true } },
      },
    })) as PersonaAnalysisRow | null;

    if (!row) return null;

    return {
      rcpNo: row.rcpNo,
      corpCode: row.disclosure?.corpCode ?? corpCode,
      views: coerceViews(row.resultJson),
      createdAt: row.createdAt,
    };
  }
}
