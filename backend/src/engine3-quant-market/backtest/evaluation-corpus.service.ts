/**
 * evaluation-corpus.service.ts — 평가자료·인과코퍼스 조립 서비스 (DAR-379)
 *
 * DisclosureEvent(사전 극성·신뢰도) ⨝ DisclosureAnalysis(AI 분석 유무) ⨝
 * EventStudyObservation(실현 D+5/D+20 초과수익) 을 공시(rcpNo)별로 결합해
 * 일치/괴리 라벨 코퍼스를 만든다. 이벤트유형·규모별 통계 근거(hitRate·커버리지)를 노출.
 *
 * ★ read-only — 신규 수집·외부호출·AI 개입 0. 가중치/임계값 미변경.
 *   실현결과가 없는(아직 미성숙·일봉 부족) 공시도 사전평가만 포함(NEUTRAL)해
 *   AI 커버리지와 사후 커버리지를 분리 관측한다. 마이그레이션 불요(파생 read-time 뷰).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCorpusRecord,
  buildEvaluationCorpusReport,
  CorpusRecord,
  CorpusRecordInput,
  EvaluationCorpusReport,
} from './evaluation-corpus';

export interface EvaluationCorpusParams {
  /** 대상 공시 최대 수(최신 추출순). 과도조회 방지. 기본 2000, 상한 5000. */
  limit?: number;
  /** 특정 eventType 만 필터(선택) */
  eventType?: string;
}

/** summary 태스크명 — AiBackfillDrainService 가 커버리지 기준으로 쓰는 동일 태스크. */
const AI_SUMMARY_TASK = 'summary';

@Injectable()
export class EvaluationCorpusService {
  constructor(private readonly prisma: PrismaService) {}

  async getCorpus(params: EvaluationCorpusParams = {}): Promise<EvaluationCorpusReport> {
    const limit = Math.min(Math.max(params.limit ?? 2000, 1), 5000);
    const eventType = params.eventType?.trim() || undefined;

    // 1) 추출 성공 공시 이벤트(사전 극성·신뢰도 보유). 최신 추출순.
    const events = await this.prisma.disclosureEvent.findMany({
      where: {
        extractionStatus: { in: ['SUCCESS', 'NEEDS_REVIEW'] },
        ...(eventType ? { eventType: eventType as never } : {}),
      },
      select: {
        rcpNo: true,
        corpCode: true,
        eventType: true,
        polarity: true,
        confidence: true,
        isAiAssisted: true,
      },
      orderBy: { extractedAt: 'desc' },
      take: limit,
    });

    if (events.length === 0) {
      return buildEvaluationCorpusReport([]);
    }

    const rcpNos = events.map((e) => e.rcpNo);

    // 2) 실현 관측치(EventStudyObservation) — rcpNo 배치 조회. 1 공시 = 1 관측치(있으면).
    const observations = await this.prisma.eventStudyObservation.findMany({
      where: { rcpNo: { in: rcpNos } },
      select: {
        rcpNo: true,
        bucketKey: true,
        d0Date: true,
        cumulativeAR: true,
        maxDrawdown: true,
        isUpD5: true,
        isCrashD5: true,
      },
    });
    const obsByRcp = new Map(observations.map((o) => [o.rcpNo, o]));

    // 3) AI 분석 레코드 — rcpNo 배치 조회. 태스크 수 + summary 보유 여부.
    const analyses = await this.prisma.disclosureAnalysis.findMany({
      where: { rcpNo: { in: rcpNos } },
      select: { rcpNo: true, task: true },
    });
    const aiByRcp = new Map<string, { count: number; hasSummary: boolean }>();
    for (const a of analyses) {
      const cur = aiByRcp.get(a.rcpNo) ?? { count: 0, hasSummary: false };
      cur.count += 1;
      if ((a.task as string) === AI_SUMMARY_TASK) cur.hasSummary = true;
      aiByRcp.set(a.rcpNo, cur);
    }

    // 4) 조립 → 라벨 부여
    const records: CorpusRecord[] = events.map((e) => {
      const obs = obsByRcp.get(e.rcpNo);
      const car = (obs?.cumulativeAR ?? null) as Record<string, number> | null;
      const ai = aiByRcp.get(e.rcpNo);

      const input: CorpusRecordInput = {
        rcpNo: e.rcpNo,
        corpCode: e.corpCode,
        eventType: e.eventType as string,
        bucketKey: obs?.bucketKey ?? (e.eventType as string),
        predictedPolarity: e.polarity,
        predictedConfidence: e.confidence,
        isAiAssisted: e.isAiAssisted,
        aiTaskCount: ai?.count ?? 0,
        hasAiSummary: ai?.hasSummary ?? false,
        d0Date: obs?.d0Date ?? null,
        realizedArD5: car && typeof car['d5'] === 'number' ? car['d5'] : null,
        realizedArD20: car && typeof car['d20'] === 'number' ? car['d20'] : null,
        isUpD5: obs?.isUpD5 ?? null,
        isCrashD5: obs?.isCrashD5 ?? null,
        maxDrawdown: obs?.maxDrawdown ?? null,
      };
      return buildCorpusRecord(input);
    });

    return buildEvaluationCorpusReport(records);
  }
}
