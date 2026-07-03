import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatKstDateCompact,
  formatKstDateDashed,
} from '../common/time/kst';
import {
  getMarketSession,
  isHalfDay,
  isTradingDay,
  prevTradingDay,
} from '../common/time/market-calendar';
import { isValidDailyOhlc } from '../engine3-quant-market/market-data/daily-price-sanity';
import { KisApiService } from '../engine3-quant-market/market-data/kis-api.service';
import { AutoTradingStatusService } from '../engine5-trading-risk/services/auto-status.service';
import {
  PreflightChecks,
  PreflightFinding,
  PreMarketPreflightReport,
} from './pre-market-preflight.types';

/**
 * PreMarketPreflightService (DAR-487, 견고화 W3·P26) — 장 시작 전 종합 프리플라이트 점검.
 *
 * 08:30 KST 스케줄러가 호출한다. 네 가지 사전 점검을 한 번에 묶어 상태 스냅샷을 만든다:
 *   1) KIS 토큰 사전 워밍 — kis-api getAccessToken(유효 캐시 있으면 재발급 없이 반환 = 발급 제한 존중).
 *   2) 휴장일/반일장 판정 — market-calendar(P09) 재사용. 휴장이면 이후 점검 스킵(정상 로그).
 *   3) 전일(최근) 일봉 정합 — daily-price-sanity(isValidDailyOhlc) + 신선도(최근 tradeDate).
 *   4) 킬스위치·리스크 게이트 상태 — auto-status.service(read-only) 재사용.
 *
 * ★점검 전용 — 매매 로직·판정·체결 무접점(M10 클록 보호, 측정 트랙 행동 무변경). AI 미개입.
 *   ★격리: 각 점검은 try/catch 로 감싸 한 점검 실패가 다른 점검·잡을 중단시키지 않는다.
 *   ★발송은 스케줄러 담당 — 이 서비스는 이상 소견을 findings 로 수집만 한다(정상 시 빈 배열).
 */
@Injectable()
export class PreMarketPreflightService {
  private readonly logger = new Logger(PreMarketPreflightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kis: KisApiService,
    private readonly autoStatus: AutoTradingStatusService,
  ) {}

  /** 프리플라이트 스냅샷 생성. `now` 주입 가능(테스트 결정론). */
  async buildReport(now: Date = new Date()): Promise<PreMarketPreflightReport> {
    const ymd = formatKstDateCompact(now);
    const tradingDateKst = formatKstDateDashed(now);
    const tradingDay = isTradingDay(ymd);

    // 휴장일 → 이후 점검 스킵(정상). 무발송·로그만.
    if (!tradingDay) {
      const report: PreMarketPreflightReport = {
        generatedAt: now.toISOString(),
        tradingDateKst,
        isTradingDay: false,
        isHalfDay: false,
        session: null,
        checks: {
          kisToken: 'SKIPPED',
          dailyPriceSanity: 'SKIPPED',
          killSwitch: 'SKIPPED',
          riskGate: 'SKIPPED',
        },
        findings: [],
        overall: 'HOLIDAY',
        summary: `휴장일(${tradingDateKst}) — 프리플라이트 스킵`,
      };
      return report;
    }

    const half = isHalfDay(ymd);
    const session = getMarketSession(ymd);

    const findings: PreflightFinding[] = [];
    const checks: PreflightChecks = {
      kisToken: 'SKIPPED',
      dailyPriceSanity: 'SKIPPED',
      killSwitch: 'SKIPPED',
      riskGate: 'SKIPPED',
    };

    // 각 점검을 격리 실행 — 개별 실패가 전체를 깨지 않도록 결과를 병렬로 모은다.
    const [tokenRes, sanityRes, riskRes] = await Promise.all([
      this.checkKisToken(now),
      this.checkDailyPriceSanity(ymd),
      this.checkRiskState(),
    ]);

    checks.kisToken = tokenRes.status;
    if (tokenRes.finding) findings.push(tokenRes.finding);

    checks.dailyPriceSanity = sanityRes.status;
    if (sanityRes.finding) findings.push(sanityRes.finding);

    checks.killSwitch = riskRes.killSwitchStatus;
    checks.riskGate = riskRes.riskGateStatus;
    findings.push(...riskRes.findings);

    const overall = findings.length > 0 ? 'ANOMALY' : 'OK';
    const report: PreMarketPreflightReport = {
      generatedAt: now.toISOString(),
      tradingDateKst,
      isTradingDay: true,
      isHalfDay: half,
      session: session
        ? { openMin: session.openMin, closeMin: session.closeMin }
        : null,
      checks,
      findings,
      overall,
      summary: '',
    };
    report.summary = this.renderSummary(report);
    return report;
  }

  /**
   * KIS 토큰 사전 워밍. 키 미설정이면 SKIPPED(정상 — dev·미구성 환경). 설정돼 있으면
   * getAccessToken 으로 사전 발급(유효 캐시가 있으면 내부에서 재발급 없이 반환 = 발급 제한 존중).
   * 실패(네트워크·발급 오류)는 OPS 채널 이상으로 보고하되 throw 하지 않는다.
   */
  private async checkKisToken(
    now: Date,
  ): Promise<{ status: PreflightChecks['kisToken']; finding?: PreflightFinding }> {
    if (!this.kis.isConfigured) {
      return { status: 'SKIPPED' };
    }
    try {
      await this.kis.getAccessToken(now.getTime());
      return { status: 'OK' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Preflight] KIS 토큰 사전 워밍 실패: ${reason}`);
      return {
        status: 'FAIL',
        finding: {
          check: 'kis-token',
          channel: 'OPS',
          severity: 'ERROR',
          message: `KIS 토큰 사전 워밍 실패 — 장중 실시간 시세 발급이 막힐 수 있습니다: ${reason}`,
        },
      };
    }
  }

  /**
   * 전일(최근) 일봉 정합. 최근 tradeDate 의 행들을 isValidDailyOhlc 로 검사하고, 그 날짜가
   * 예상 직전 거래일보다 오래됐으면 신선도 이상으로 본다. 일봉 데이터가 아예 없으면(수집 전·dev)
   * 판정 불가이므로 SKIPPED(정상). 조회 실패도 graceful(SKIPPED).
   */
  private async checkDailyPriceSanity(
    todayYmd: string,
  ): Promise<{ status: PreflightChecks['dailyPriceSanity']; finding?: PreflightFinding }> {
    try {
      const latest = await this.prisma.stockDailyPrice.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      });
      // 데이터 없음 → 판정 대상 아님(수집 파이프라인 미가동·dev). 오탐 방지 위해 스킵.
      if (!latest) {
        return { status: 'SKIPPED' };
      }

      const rows = await this.prisma.stockDailyPrice.findMany({
        where: { tradeDate: latest.tradeDate },
        select: {
          openPrice: true,
          highPrice: true,
          lowPrice: true,
          closePrice: true,
        },
      });
      const corrupt = rows.filter((r) => !isValidDailyOhlc(r)).length;

      // 신선도: 예상 직전 거래일(하드코딩 캘린더)보다 최근 일봉이 오래됐으면 EOD 수집 정체 의심.
      const expectedPrev = prevTradingDay(todayYmd);
      const stale = latest.tradeDate < expectedPrev;

      if (corrupt > 0 && stale) {
        return {
          status: 'WARN',
          finding: this.sanityFinding(
            `전일 일봉 정합 이상 — 최근 일봉(${latest.tradeDate})이 예상 거래일(${expectedPrev})보다 오래됐고 ` +
              `손상 행 ${corrupt}건이 발견됐습니다(EOD 수집·정합 확인 필요).`,
          ),
        };
      }
      if (stale) {
        return {
          status: 'WARN',
          finding: this.sanityFinding(
            `전일 일봉 미수집 의심 — 최근 일봉이 ${latest.tradeDate}로 예상 직전 거래일(${expectedPrev})보다 ` +
              `오래됐습니다(EOD 전진수집 확인 필요).`,
          ),
        };
      }
      if (corrupt > 0) {
        return {
          status: 'WARN',
          finding: this.sanityFinding(
            `전일 일봉 정합 이상 — ${latest.tradeDate} 일봉에서 손상 행 ${corrupt}건이 발견됐습니다(OHLC 물리 불일치).`,
          ),
        };
      }
      return { status: 'OK' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Preflight] 전일 일봉 정합 점검 실패(graceful): ${reason}`);
      return { status: 'SKIPPED' };
    }
  }

  /** 일봉 정합 OPS WARNING 소견 헬퍼. */
  private sanityFinding(message: string): PreflightFinding {
    return {
      check: 'daily-price-sanity',
      channel: 'OPS',
      severity: 'WARNING',
      message,
    };
  }

  /**
   * 킬스위치·리스크 게이트 상태 스냅샷(auto-status.service read-only 재사용). 발동/차단 중이면
   * RISK 채널 이상으로 보고(장 시작을 차단 상태로 맞이하는 것을 운영자에게 상기). 조회 실패는 graceful.
   */
  private async checkRiskState(): Promise<{
    killSwitchStatus: PreflightChecks['killSwitch'];
    riskGateStatus: PreflightChecks['riskGate'];
    findings: PreflightFinding[];
  }> {
    try {
      const status = await this.autoStatus.getStatus();
      const findings: PreflightFinding[] = [];

      const ksActive = status.killSwitch.isActive;
      if (ksActive) {
        const trigger = status.killSwitch.triggeredBy === 'USER' ? '수동' : '자동';
        findings.push({
          check: 'kill-switch',
          channel: 'RISK',
          severity: 'CRITICAL',
          message:
            `킬스위치 발동(${trigger}) 상태로 장을 시작합니다 — 신규 주문이 전면 차단됩니다. ` +
            `사유: ${status.killSwitch.reason ?? '(미기재)'}`,
        });
      }

      // 리스크 게이트 차단이 킬스위치 외 원인이면 별도 소견(현재는 킬스위치가 유일 차단원 —
      // 중복 발송 방지 위해 킬스위치 미발동일 때만 게이트 차단을 독립 보고).
      if (status.riskGate.blocked && !ksActive) {
        findings.push({
          check: 'risk-gate',
          channel: 'RISK',
          severity: 'ERROR',
          message: `리스크 게이트 차단 상태 — ${status.riskGate.blockedReason ?? '신규 주문 차단중'}`,
        });
      }

      return {
        killSwitchStatus: ksActive ? 'FAIL' : 'OK',
        riskGateStatus: status.riskGate.blocked ? 'FAIL' : 'OK',
        findings,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Preflight] 리스크 상태 점검 실패(graceful): ${reason}`);
      return {
        killSwitchStatus: 'SKIPPED',
        riskGateStatus: 'SKIPPED',
        findings: [],
      };
    }
  }

  /** 구조화 필드 → 한국어 평문 로그 다이제스트. */
  private renderSummary(r: PreMarketPreflightReport): string {
    const sessionLabel = r.isHalfDay ? ' (반일장/지연개장)' : '';
    const head = `장 시작 전 프리플라이트 (${r.tradingDateKst} KST)${sessionLabel}`;
    const statusLine =
      `토큰=${r.checks.kisToken} · 일봉정합=${r.checks.dailyPriceSanity} · ` +
      `킬스위치=${r.checks.killSwitch} · 리스크게이트=${r.checks.riskGate}`;
    if (r.findings.length === 0) {
      return `✅ ${head} — 이상 없음. ${statusLine}`;
    }
    const lines = [`⚠️ ${head} — 이상 ${r.findings.length}건`, statusLine];
    for (const f of r.findings) {
      lines.push(` · [${f.channel}/${f.severity}] ${f.message}`);
    }
    return lines.join('\n');
  }
}
