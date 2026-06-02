// backend/src/disclosure-events/extractors/event-classifier.ts
// 보고서명 + parsedJson 기반 이벤트 타입 1차 분류기 (Rule 전용, AI 미사용)

import { EventType } from '@prisma/client';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

// ─── 보고서명 → eventType 정규식 룰 테이블 ──────────────────────────────────
// 우선순위: 위에서 아래 순서대로 적용, 첫 번째 매칭 채택

interface ReportNameRule {
  pattern: RegExp;
  eventType: EventType;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  confidence: number;
}

export const REPORT_NAME_RULES: ReportNameRule[] = [
  // ── 계약 ──────────────────────────────────────────────────────────────────
  // 계약 해제·취소를 체결보다 먼저 검사해야 오매핑 방지
  {
    pattern: /단일판매.*공급계약.*(해제|취소|종료)|공급계약.*(해제|취소)/,
    eventType: EventType.CONTRACT_CANCELLATION,
    polarity: 'NEGATIVE',
    confidence: 0.93,
  },
  {
    pattern: /단일판매[·\s]*공급계약|공급계약\s*체결|판매계약\s*체결/,
    eventType: EventType.SUPPLY_CONTRACT,
    polarity: 'POSITIVE',
    confidence: 0.92,
  },

  // ── 자기주식 ──────────────────────────────────────────────────────────────
  {
    pattern: /자기주식\s*소각|자사주\s*소각/,
    eventType: EventType.SHARE_CANCELLATION,
    polarity: 'POSITIVE',
    confidence: 0.95,
  },
  {
    pattern: /자기주식\s*(취득|처분)|자사주\s*취득/,
    eventType: EventType.SHARE_BUYBACK,
    polarity: 'POSITIVE',
    confidence: 0.95,
  },

  // ── 배당 ──────────────────────────────────────────────────────────────────
  // 배당 축소·중단 패턴을 먼저 검사
  {
    pattern: /배당\s*(축소|중단|감소|취소)/,
    eventType: EventType.DIVIDEND_CUT,
    polarity: 'NEGATIVE',
    confidence: 0.90,
  },
  {
    pattern: /현금배당|현물배당|배당\s*결정|배당금\s*지급/,
    eventType: EventType.DIVIDEND_INCREASE,
    polarity: 'POSITIVE',
    confidence: 0.88,
  },

  // ── 유상증자 ──────────────────────────────────────────────────────────────
  // 제3자배정 유상증자를 주주배정·일반공모보다 먼저 검사
  {
    pattern: /유상증자.*제3자\s*배정|제3자\s*배정.*증자/,
    eventType: EventType.THIRD_PARTY_ALLOTMENT,
    polarity: 'NEGATIVE',
    confidence: 0.93,
  },
  {
    pattern: /유상증자.*(주주배정|일반공모)|주주배정\s*증자|일반공모\s*증자/,
    eventType: EventType.PAID_IN_CAPITAL_INCREASE,
    polarity: 'NEGATIVE',
    confidence: 0.93,
  },
  // 단순 "유상증자" (위 두 패턴에 걸리지 않은 나머지)
  {
    pattern: /유상증자/,
    eventType: EventType.PAID_IN_CAPITAL_INCREASE,
    polarity: 'NEGATIVE',
    confidence: 0.87,
  },

  // ── 전환사채·신주인수권부사채 ─────────────────────────────────────────────
  {
    pattern: /전환사채.*발행|CB.*발행/i,
    eventType: EventType.CB_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.94,
  },
  {
    pattern: /신주인수권부사채.*발행|BW.*발행/i,
    eventType: EventType.BW_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.94,
  },
  // 단순 "전환사채" / "신주인수권부사채" 매칭 (발행 명시 없는 경우)
  {
    pattern: /전환사채|CB[\s(]/,
    eventType: EventType.CB_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.86,
  },
  {
    pattern: /신주인수권부사채|BW[\s(]/,
    eventType: EventType.BW_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.86,
  },

  // ── 최대주주 변경 ─────────────────────────────────────────────────────────
  {
    pattern: /최대주주.*(변경|교체)/,
    eventType: EventType.MAJOR_SHAREHOLDER_CHANGE,
    polarity: 'MIXED',
    confidence: 0.90,
  },

  // ── 소송·횡령·배임 ────────────────────────────────────────────────────────
  {
    pattern: /소송.*제기|횡령|배임|소제기/,
    eventType: EventType.LAWSUIT,
    polarity: 'NEGATIVE',
    confidence: 0.91,
  },

  // ── 감사의견 리스크 ───────────────────────────────────────────────────────
  {
    pattern: /감사의견.*(거절|한정|부적정)|강조사항/,
    eventType: EventType.AUDIT_OPINION_RISK,
    polarity: 'NEGATIVE',
    confidence: 0.95,
  },

  // ── 거래정지 ──────────────────────────────────────────────────────────────
  {
    pattern: /거래정지|매매거래.*정지/,
    eventType: EventType.TRADING_SUSPENSION,
    polarity: 'NEGATIVE',
    confidence: 0.97,
  },

  // ── 상장폐지·관리종목 ────────────────────────────────────────────────────
  {
    pattern: /상장폐지|관리종목.*지정|투자경고|투자위험/,
    eventType: EventType.DELISTING_RISK,
    polarity: 'NEGATIVE',
    confidence: 0.97,
  },
];

/**
 * 보고서명 + parsedJson 기반 1차 이벤트 타입 분류
 *
 * 1. reportName 정규식 룰 테이블 순차 적용 (첫 매칭 채택)
 * 2. 매칭 실패 시 parsedJson.docType 활용 2차 보완
 * 3. 여전히 null → EventType.OTHER, confidence 0.40
 *
 * @returns { eventType, polarity, confidence }
 *   confidence: Rule 직접 매칭 ≥ 0.85, docType 보완 0.70, 미매칭 0.40
 */
export function classifyEventType(
  reportName: string,
  parsedJson: ParsedJson,
): {
  eventType: EventType;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  confidence: number;
} {
  // 1차: reportName 정규식 룰 테이블 순차 적용
  for (const rule of REPORT_NAME_RULES) {
    if (rule.pattern.test(reportName)) {
      return {
        eventType: rule.eventType,
        polarity: rule.polarity,
        confidence: rule.confidence,
      };
    }
  }

  // 2차: parsedJson.docType 보완
  if (parsedJson.docType) {
    const docType = parsedJson.docType;

    const docTypeMapping: Record<
      string,
      { eventType: EventType; polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN' }
    > = {
      SUPPLY_CONTRACT:          { eventType: EventType.SUPPLY_CONTRACT,          polarity: 'POSITIVE' },
      SHARE_BUYBACK:            { eventType: EventType.SHARE_BUYBACK,            polarity: 'POSITIVE' },
      SHARE_CANCELLATION:       { eventType: EventType.SHARE_CANCELLATION,       polarity: 'POSITIVE' },
      DIVIDEND:                 { eventType: EventType.DIVIDEND_INCREASE,        polarity: 'POSITIVE' },
      PAID_IN_CAPITAL_INCREASE: { eventType: EventType.PAID_IN_CAPITAL_INCREASE, polarity: 'NEGATIVE' },
    };

    // CB_BW_ISSUANCE는 bondType으로 CB/BW 구분 (BLOCKER 수정: 항상 CB로 매핑하던 버그)
    if (docType === 'CB_BW_ISSUANCE') {
      const isBw = String(parsedJson.bondType ?? '').toUpperCase() === 'BW';
      return {
        eventType: isBw ? EventType.BW_ISSUANCE : EventType.CB_ISSUANCE,
        polarity: 'NEGATIVE',
        confidence: 0.7,
      };
    }

    const mapped = docTypeMapping[docType];
    if (mapped) {
      return {
        eventType: mapped.eventType,
        polarity: mapped.polarity,
        confidence: 0.70,
      };
    }
  }

  // 3차: 미매칭 → OTHER
  return {
    eventType: EventType.OTHER,
    polarity: 'UNKNOWN',
    confidence: 0.40,
  };
}
