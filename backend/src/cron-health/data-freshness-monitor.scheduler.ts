import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KST_TIMEZONE } from '../common/time/kst';
import { DataFreshnessService } from './data-freshness.service';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { FreshnessReport } from './freshness';

/**
 * DataFreshnessMonitorScheduler — DAR-476(P02) 수집 신선도 감지점 알림 배선.
 *
 * 배경(갭 E1·B13): 신선도 판정(DataFreshnessService/freshness.ts)은 촘촘하나 능동 발송이 0.
 * 본 스케줄러는 기존 신선도 SSOT 를 주기적으로 읽어 `anyStale` 상태 '전환' 시에만 OPS_ALERT 를
 * 발송한다. 신선도 리포트는 크론 정체(#2)와 데이터 수집 실패·결측(#3)이 모두 마지막 성공시각
 * 노후화로 표면화되는 단일 관측면이므로, 두 감지점을 이 한 곳에서 함께 커버한다(개별 수집기
 * 23종 warn 산발 배선 대신 SSOT 경유 — 폭주 방지·유지보수 단순화).
 *
 * ★관측·알림층 전용: 수집·판정·차단·매매 로직 무접점(M10 클록 안전). 신규 외부호출/AI 없음.
 * ★디바운스: 에지 트리거(정상→정체 상승 에지에서만 1회). 정체 지속 중에는 재발송하지 않고,
 *   정상 복귀 시 재무장(prevAnyStale=false)한다. dedupeKey 에 날짜·정체잡 집합을 넣어
 *   경계 flip-flop 도 consumer 멱등(refId unique)으로 추가 억제한다.
 */
@Injectable()
export class DataFreshnessMonitorScheduler {
  private readonly logger = new Logger(DataFreshnessMonitorScheduler.name);

  // in-memory 에지 상태(단일 인스턴스 배포 전제). 재시작 시 false 로 초기화 —
  // 재기동 직후 정체 상태면 1회 발송(재기동+정체는 인지 가치 있음). dedupeKey 가 일자 중복 억제.
  private prevAnyStale = false;

  constructor(
    private readonly freshness: DataFreshnessService,
    private readonly producer: NotificationProducerService,
  ) {}

  /**
   * 30분마다 신선도 평가 → anyStale 상승 에지에서 OPS_ALERT.
   * 신선도 판정 자체가 장외시간 오탐을 보류(WEEKDAY_INTRADAY window)하므로 상시 실행해도 안전.
   */
  @Cron('*/30 * * * *', { timeZone: KST_TIMEZONE })
  async runCheck(now: Date = new Date()): Promise<FreshnessReport> {
    const report = await this.freshness.getFreshness(now);
    const risingEdge = report.anyStale && !this.prevAnyStale;

    if (risingEdge) {
      // [W11] 제로런(살아있는데 산출 0행) 정체는 라벨에 표기해 age 정체와 구분 —
      //   복구 방향이 다르다(재기동이 아니라 쿼터/토큰/업스트림 점검).
      const staleLabels = report.jobs
        .filter((j) => j.isStale)
        .map((j) => (j.isZeroRun ? `${j.label}(제로런)` : j.label));
      const severity = report.staleJobs.length >= 3 ? 'ERROR' : 'WARNING';
      this.logger.warn(
        `[FreshnessMonitor] 정체 전환 — ${report.staleJobs.length}개 잡 stale: ${report.staleJobs.join(', ')}`,
      );
      void this.producer.enqueueOpsAlert(
        severity,
        'cron-freshness',
        `데이터 수집 정체 감지 — ${report.staleJobs.length}개 항목이 지연/결측 상태입니다: ${staleLabels.join(', ')}`,
        {
          // 날짜 + 정렬된 정체잡 집합 자연키 → 동일 정체 재발/경계 flip-flop 중복 억제.
          dedupeKey: `cron-freshness:${report.generatedAt.slice(0, 10)}:${[...report.staleJobs].sort().join('|')}`,
          deepLink: '/settings',
          data: { staleJobs: report.staleJobs, generatedAt: report.generatedAt },
        },
      );
    }

    this.prevAnyStale = report.anyStale;
    return report;
  }
}
