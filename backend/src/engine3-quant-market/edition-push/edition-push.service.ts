import { Injectable, Logger } from '@nestjs/common';
import { SignalsService } from '../signals/signals.service';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import { DisclosureReactionStatsService } from '../event-study/disclosure-reaction-stats.service';
import type { ReactionStatInput } from '../../notifications/push-body-template';
import { tradeDateFromMs } from '../market-data/candle-query';
import {
  decideEditionPush,
  buildEditionPushContent,
  type EditionPushDecision,
} from './edition-push.guard';

/** 발행 사이클 결과(스케줄러 로깅·크론 카운트·테스트 관측용). */
export interface EditionPushRunResult {
  /** 대상 에디션 발행일(KST YYYYMMDD). */
  editionDate: string;
  /** 실제 enqueue 했는가(빈 에디션이면 false). */
  published: boolean;
  /** 매수등급 건수(미발행이면 0). */
  count: number;
  /** 미발행 사유(빈 에디션 emptyReason — CLOSED/QUIET/PENDING/…). */
  emptyReason?: string;
}

/**
 * EditionPublishPushService (DAR-523, Wave B/B2·P0) — 일일 에디션 발행 푸시 오케스트레이션.
 *
 * 흐름: 당일(KST) 에디션을 ★조회 API 재사용(SignalsService.findDailyEdition, DAR-505/519)으로
 *   가져와 → decideEditionPush 하드 가드 → 발행 대상이면 NOTIFY 큐(EDITION)로 enqueue 한다.
 *   ★빈 에디션(매수등급 0)은 enqueue 자체를 하지 않는다(수용기준 1 — 발송 0).
 *
 * ★경계: 조회·알림 계층 전용 — engine5(매매·체결)·Buy Score·M10 클록 무접점(AI 0). 발송·인박스·
 *   캡·멱등은 전부 NotifyConsumer 가 담당한다(엔진 직접 발송 금지 — BullMQ NOTIFY 큐 경유).
 */
@Injectable()
export class EditionPublishPushService {
  private readonly logger = new Logger(EditionPublishPushService.name);

  constructor(
    private readonly signals: SignalsService,
    private readonly producer: NotificationProducerService,
    private readonly reactionStats: DisclosureReactionStatsService,
  ) {}

  /**
   * 당일(KST) 에디션을 조회해 발행 대상이면 푸시를 enqueue 한다.
   * @param now 결정론 테스트용 주입 시각(기본 현재). KST 거래일 산출에만 쓴다.
   */
  async publishTodayEdition(now: Date = new Date()): Promise<EditionPushRunResult> {
    const editionDate = tradeDateFromMs(now.getTime());
    // ★에디션 조회 API 재사용(DAR-505/519) — 별도 쿼리 재구현 금지(SSOT).
    const edition = await this.signals.findDailyEdition(editionDate);
    const decision: EditionPushDecision = decideEditionPush(edition);

    // ★하드 가드: 빈 에디션은 발송하지 않는다(수용기준 1).
    if (!decision.publish) {
      this.logger.log(
        `[EditionPush] ${editionDate} 발송 금지(빈 에디션·매수등급 0·reason=${decision.emptyReason ?? 'EMPTY'})`,
      );
      return {
        editionDate,
        published: false,
        count: 0,
        emptyReason: decision.emptyReason,
      };
    }

    // ★DAR-525: 헤드라인 종목의 유사공시 반응 통계(Wave A DAR-511)를 조립해 '한 줄 판단' 본문에 주입.
    //   조회 실패·미추출·n<30 은 전부 null → buildEditionPushContent 가 대체 꼬리로 폴백(허수 미노출).
    const statInput = await this.fetchHeadlineStat(decision.headlineRcpNo);
    const content = buildEditionPushContent(decision, statInput);
    await this.producer.enqueueEdition({
      editionDate: decision.editionDate,
      count: decision.count,
      strongBuyCount: decision.strongBuyCount,
      headlineCorpName: decision.headlineCorpName,
      title: content.title,
      body: content.body,
      deepLink: content.deepLink,
    });
    this.logger.log(
      `[EditionPush] ${editionDate} 발행 푸시 enqueue: count=${decision.count} ` +
        `strongBuy=${decision.strongBuyCount} headline=${decision.headlineCorpName} ` +
        `stats=${content.statsIncluded ? 'included' : 'omitted'}`,
    );
    return { editionDate, published: true, count: decision.count };
  }

  /**
   * 헤드라인 종목(rcpNo)의 유사공시 반응 통계를 D+5 기준으로 조립한다(Wave A DAR-511 페이로드 재사용).
   *   - rcpNo 없음/이벤트 미추출/n<30 → null(통계 문구 생략 — 정직 규약 승계).
   *   - 조회 예외는 삼켜서 null(통계는 부가정보 — 실패해도 발행은 계속, 발송 신뢰 우선).
   */
  private async fetchHeadlineStat(rcpNo?: string): Promise<ReactionStatInput | null> {
    if (!rcpNo) return null;
    try {
      const resp = await this.reactionStats.getReactionStatsByRcpNo(rcpNo);
      const result = resp.results[0];
      if (!result?.stats) return null;
      return {
        horizon: 'D+5',
        avgReturnPct: result.stats.d5.avgReturn,
        sampleCount: result.sampleCount,
        minSampleSize: resp.minSampleSize,
      };
    } catch (err) {
      this.logger.warn(
        `[EditionPush] 반응 통계 조회 실패(rcpNo=${rcpNo}) — 통계 없이 발행: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
