// backend/src/disclosure-events/extractors/index.ts
// 이벤트 타입별 파서 디스패치 진입점 (Rule 전용, AI 미사용)

import { EventType } from '@prisma/client';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import { Table } from '../../disclosure-documents/types/table.type';
import { extract as extractSupplyContract } from './supply-contract';
import {
  extract as extractShareBuyback,
  extractCancellation as extractShareCancellation,
} from './share-buyback';
import { extract as extractDividend } from './dividend';
import { extract as extractCapitalIncrease } from './capital-increase';
import { extract as extractCbBw } from './cb-bw';
import { extract as extractMajorShareholderChange } from './major-shareholder-change';
import { extract as extractEarnings } from './earnings';
// DAR-71: 고위험 공시 5종
import { extract as extractLawsuit } from './lawsuit';
import { extract as extractAuditOpinionRisk } from './audit-opinion-risk';
import { extract as extractTradingSuspension } from './trading-suspension';
import { extract as extractDelistingRisk } from './delisting-risk';
import { extract as extractContractCancellation } from './contract-cancellation';
// DAR-337: 대량보유(5%룰) 상황보고 — FAILED 최대 단일레버(611) 복구
import { extract as extractMajorHolder5Pct } from './major-holder-5pct';

// ─── 이벤트 타입별 필수 필드 목록 ────────────────────────────────────────────
// confidence 산출 기준: 필수 필드가 모두 존재하면 0.90, 일부 누락 시 0.60~0.89

const REQUIRED_FIELDS: Partial<Record<EventType, string[]>> = {
  [EventType.SUPPLY_CONTRACT]:          ['contractAmount'],
  [EventType.SHARE_BUYBACK]:            ['buybackShares', 'buybackAmount'],
  [EventType.SHARE_CANCELLATION]:       ['cancellationShares'],
  [EventType.DIVIDEND_INCREASE]:        ['dividendPerShare'],
  [EventType.DIVIDEND_CUT]:             ['dividendPerShare'],
  [EventType.PAID_IN_CAPITAL_INCREASE]: ['newShares', 'fundingAmount'],
  [EventType.THIRD_PARTY_ALLOTMENT]:    ['newShares', 'fundingAmount'],
  [EventType.CB_ISSUANCE]:              ['totalAmount', 'conversionPrice'],
  [EventType.BW_ISSUANCE]:              ['totalAmount'],
  // DAR-58: 신규 4종 — 구조화 필드 1종 충족 시 SUCCESS, 부재 시 0.0 → 상위에서 NEEDS_REVIEW(AI L1)
  [EventType.MAJOR_SHAREHOLDER_CHANGE]: ['ownershipRatio'],
  [EventType.EARNINGS_SURPRISE]:        ['operatingProfitYoY'],
  [EventType.EARNINGS_SHOCK]:           ['operatingProfitYoY'],
  // DAR-71: 고위험 5종 — 핵심 구조화 필드 1종 충족 시 SUCCESS, 부재 시 0.0 → NEEDS_REVIEW(AI L1)
  [EventType.LAWSUIT]:                  ['lawsuitAmount'],
  [EventType.AUDIT_OPINION_RISK]:       ['auditOpinion'],
  [EventType.TRADING_SUSPENSION]:       ['suspensionReason'],
  [EventType.DELISTING_RISK]:           ['delistingStage'],
  [EventType.CONTRACT_CANCELLATION]:    ['cancelledAmount'],
  // DAR-337: 대량보유(5%룰) — 보유비율 충족 시 SUCCESS, 부재 시 0.0 → 상위 NEEDS_REVIEW(AI L1/insider 보강)
  [EventType.MAJOR_HOLDER_5PCT]:        ['holdingRatio'],
};

/**
 * eventType에 맞는 파서를 선택해 parsedJson에서 수치를 추출한다.
 *
 * - 파서 구현 타입:
 *   SUPPLY_CONTRACT, SHARE_BUYBACK, SHARE_CANCELLATION,
 *   DIVIDEND_INCREASE/CUT, PAID_IN_CAPITAL_INCREASE/THIRD_PARTY_ALLOTMENT,
 *   CB_ISSUANCE, BW_ISSUANCE,
 *   MAJOR_SHAREHOLDER_CHANGE, EARNINGS_SURPRISE/SHOCK (DAR-58),
 *   LAWSUIT, AUDIT_OPINION_RISK, TRADING_SUSPENSION, DELISTING_RISK,
 *   CONTRACT_CANCELLATION (DAR-71),
 *   MAJOR_HOLDER_5PCT (DAR-337)
 * - 나머지 EventType: data = {}, confidence = 0.0
 *
 * @param tables DisclosureDocument.tables(원본 표). SHARE_BUYBACK 폴백 스캔(DAR-339)에만 사용.
 *   다른 파서는 미사용. 미전달 시 parsedJson 정형 키만으로 추출(기존 동작 보존).
 * @returns { data: Record<string, unknown>; confidence: number }
 *   confidence: 필수 필드 모두 추출 시 0.90, 일부 누락 시 0.60~0.89, 전체 누락/미지원 시 0.0
 */
export function extractEventData(
  eventType: EventType,
  parsedJson: ParsedJson,
  reportName: string,
  tables?: Table[],
): {
  data: Record<string, unknown>;
  confidence: number;
} {
  try {
    let data: Record<string, unknown>;

    switch (eventType) {
      case EventType.SUPPLY_CONTRACT:
        data = extractSupplyContract(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.SHARE_BUYBACK:
        // DAR-339: tables 폴백 스캔으로 취득금액·주식수 회수(FAILED 복구)
        data = extractShareBuyback(parsedJson, reportName, tables) as unknown as Record<string, unknown>;
        break;
      case EventType.SHARE_CANCELLATION:
        data = extractShareCancellation(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.DIVIDEND_INCREASE:
      case EventType.DIVIDEND_CUT:
        data = extractDividend(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.PAID_IN_CAPITAL_INCREASE:
      case EventType.THIRD_PARTY_ALLOTMENT:
        data = extractCapitalIncrease(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.CB_ISSUANCE:
      case EventType.BW_ISSUANCE:
        data = extractCbBw(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.MAJOR_SHAREHOLDER_CHANGE:
        data = extractMajorShareholderChange(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.EARNINGS_SURPRISE:
      case EventType.EARNINGS_SHOCK:
        data = extractEarnings(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      // DAR-71: 고위험 공시 5종
      case EventType.LAWSUIT:
        data = extractLawsuit(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.AUDIT_OPINION_RISK:
        data = extractAuditOpinionRisk(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.TRADING_SUSPENSION:
        data = extractTradingSuspension(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.DELISTING_RISK:
        data = extractDelistingRisk(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      case EventType.CONTRACT_CANCELLATION:
        data = extractContractCancellation(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      // DAR-337: 대량보유(5%룰) 상황보고
      case EventType.MAJOR_HOLDER_5PCT:
        data = extractMajorHolder5Pct(parsedJson, reportName) as unknown as Record<string, unknown>;
        break;
      default:
        // 미지원 이벤트 타입 — extractionStatus = NEEDS_REVIEW
        return { data: {}, confidence: 0.0 };
    }

    const confidence = calcConfidence(eventType, data);
    return { data, confidence };
  } catch {
    // 파서 예외 발생 시 빈 결과 반환 (throw 금지)
    return { data: {}, confidence: 0.0 };
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 추출 결과에서 필수 필드 충족 여부로 confidence 산출
 *
 * 로직:
 *   - 필수 필드가 정의되지 않은 이벤트 타입: 0.0
 *   - 필수 필드 모두 non-null: 0.90
 *   - 일부 누락: 0.90 - (누락 수 / 전체 수) * 0.30 → 최소 0.60
 *   - 전체 누락: 0.0
 */
function calcConfidence(
  eventType: EventType,
  data: Record<string, unknown>,
): number {
  // DAR-343: 거래정지는 사유 텍스트가 결측이어도 reportName으로 suspensionType(악재)을
  //   추론할 수 있다. 사유 추출 시 0.90, 유형만 추론 시 0.0(=FAILED 유발) 대신 부분 0.70
  //   (NEEDS_REVIEW 경로)을 부여해 보유종목 리스크 경보 누락을 막는다.
  if (eventType === EventType.TRADING_SUSPENSION) {
    const hasReason = data.suspensionReason !== null && data.suspensionReason !== undefined;
    if (hasReason) return 0.90;
    if (data.reasonInferred === true) return 0.70;
    return 0.0;
  }

  const requiredFields = REQUIRED_FIELDS[eventType];
  if (!requiredFields || requiredFields.length === 0) return 0.0;

  const presentCount = requiredFields.filter(
    (field) => data[field] !== null && data[field] !== undefined,
  ).length;

  if (presentCount === 0) return 0.0;
  if (presentCount === requiredFields.length) return 0.90;

  // 일부 누락: 0.60 ~ 0.89 범위에서 선형 보간
  const ratio = presentCount / requiredFields.length;
  return Math.max(0.60, Math.round((0.60 + ratio * 0.30) * 100) / 100);
}
