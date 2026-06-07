// backend/src/engine1-disclosure/disclosure-documents/pending-pipeline.scheduler.ts
// DAR-113: 공시 파이프라인 자동 드레인 스케줄러.
//
// 근본 문제: 수집 스케줄러는 신규 공시를 `enqueueParsing`으로 DisclosureDocument(PENDING)에
// 적재만 할 뿐 실제 파싱을 트리거하지 않는다(파싱 큐 워커 부재). PENDING→DONE 전환은
// 수동 `POST /document-parsing/batch`가 유일했고, parse-retry 크론은 FAILED만 재처리한다.
// 그 결과 PENDING 문서가 무한정 정체되고 → 이벤트추출·AI 분석까지 폐루프가 끊긴다.
//
// 이 스케줄러가 그 공백을 메운다: 주기적으로 (1) PENDING 파싱을 드레인하고,
// 이어서 (2) 파싱완료-이벤트없음 공시의 이벤트추출을 드레인한다. 이벤트추출은 큐로
// AI 분석을 발행한다(AiCostGate L0~L3 + 일/월 한도가드가 비용을 통제 — AI 미개입).
//
// ★결정적 경로: 파싱 직후의 fire-and-forget 체이닝(onDocumentParsed)에 의존하지 않고,
//   파싱 드레인 → 이벤트추출 드레인을 같은 실행에서 순차 호출한다(체이닝 누락에도 안전).
// ★멱등: processDisclosure는 rcpNo upsert, AI는 rcpNo+task 캐시 → 중복 실행/체이닝 경합에 안전.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/** 1회 실행당 파싱(DART fetch) 최대 건수 — rate limit·실행시간 통제. */
const PARSE_DRAIN_BATCH = 50;
/** 1회 실행당 이벤트추출 최대 건수 — 추출은 보유 parsedJson 재사용(DART 호출 0). */
const EXTRACT_DRAIN_BATCH = 100;

/** 드레인 1회 결과. */
export interface PipelineDrainResult {
  /** 파싱 성공 건수(PENDING→DONE). */
  parsed: number;
  /** 파싱 실패 건수. */
  failedParse: number;
  /** 이벤트추출 처리 건수(성공+검토+실패) — AI 큐 발행 트리거. */
  eventsProcessed: number;
  /** 이전 실행이 진행 중이라 건너뛴 경우 true. */
  skipped: boolean;
}

@Injectable()
export class PendingPipelineScheduler {
  private readonly logger = new Logger(PendingPipelineScheduler.name);
  private isDraining = false;

  constructor(
    private readonly documents: DisclosureDocumentsService,
    private readonly events: DisclosureEventsService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /**
   * 매 15분마다 공시 파이프라인(PENDING 파싱 + 파싱완료-이벤트없음 추출)을 드레인한다.
   * 수집→파싱→이벤트추출→AI 폐루프를 자동화한다(기존엔 수동 배치만 존재).
   */
  @Cron('*/15 * * * *')
  async drainPending(): Promise<PipelineDrainResult> {
    const run = () => this.runDrain();

    try {
      if (!this.recorder) {
        return await run();
      }
      // DAR-110 정합: 마지막 성공시각/처리건수를 CronRunLog에 기록(신선도 판정 입력).
      return await this.recorder.record(CRON_JOB_KEYS.PIPELINE_DRAIN, run, {
        countOf: (r) => r.parsed + r.eventsProcessed,
        isSkipped: (r) => r.skipped,
      });
    } catch (error) {
      // Cron 스케줄 유지를 위해 throw하지 않음(recorder는 FAILED 기록 후 재던짐 → 여기서 흡수).
      this.logger.error('파이프라인 드레인 오류', error);
      return { parsed: 0, failedParse: 0, eventsProcessed: 0, skipped: false };
    }
  }

  /** 실제 드레인 본문 — 파싱 드레인 후 이벤트추출 드레인을 순차 수행. */
  private async runDrain(): Promise<PipelineDrainResult> {
    if (this.isDraining) {
      this.logger.warn('이전 파이프라인 드레인이 진행 중입니다. 건너뜁니다.');
      return { parsed: 0, failedParse: 0, eventsProcessed: 0, skipped: true };
    }
    this.isDraining = true;

    try {
      // ① PENDING 파싱 드레인 — DART 원문 fetch + 파싱(상태 PENDING→DONE).
      const parse = await this.documents.processPendingBatch(PARSE_DRAIN_BATCH);

      // ② 파싱완료-이벤트없음 추출 드레인 — 보유 parsedJson 재사용(DART 호출 0).
      //    추출 성공/검토/실패 모두 AI_ANALYZE 큐에 발행되어 라이브 AI(게이트 경유)로 흐른다.
      const extract = await this.events.processPendingDisclosures(EXTRACT_DRAIN_BATCH);

      const eventsProcessed = extract.success + extract.needsReview + extract.failed;
      this.logger.log(
        `파이프라인 드레인 완료: 파싱 성공=${parse.success}/실패=${parse.failed}, ` +
          `이벤트추출=${eventsProcessed}(성공 ${extract.success}·검토 ${extract.needsReview}·실패 ${extract.failed})`,
      );

      return {
        parsed: parse.success,
        failedParse: parse.failed,
        eventsProcessed,
        skipped: false,
      };
    } finally {
      this.isDraining = false;
    }
  }
}
