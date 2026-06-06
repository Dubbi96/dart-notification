// 공시 목록 카드의 고위험 이벤트 강조용 클라이언트 분류기 (DAR-97).
//
// 백엔드 `/disclosures` 목록 응답(Disclosure)에는 eventType이 포함되지 않으므로
// (eventType은 상세 `/disclosures/:rcpNo` 응답에만 동봉됨), 목록 화면에서는
// 보고서명(reportName)만으로 고위험 5종을 1차 식별한다.
//
// 규칙은 백엔드 event-classifier.ts의 REPORT_NAME_RULES 중 고위험(NEGATIVE) 5종과
// 1:1 정합한다. 단정이 아닌 "참고용 강조"이며, 정밀 분류는 상세 화면의
// useDisclosureEvent(GET /disclosure-events/:rcpNo)가 담당한다.

/** 고위험 이벤트 5종 (거래정지·상폐위험·감사의견·소송·계약해지) */
export type HighRiskEventType =
  | 'TRADING_SUSPENSION'
  | 'DELISTING_RISK'
  | 'AUDIT_OPINION_RISK'
  | 'LAWSUIT'
  | 'CONTRACT_CANCELLATION';

interface HighRiskRule {
  pattern: RegExp;
  eventType: HighRiskEventType;
  label: string;
}

// 우선순위: 위→아래 첫 매칭 채택 (백엔드 룰 순서와 동일 의미).
const HIGH_RISK_RULES: HighRiskRule[] = [
  {
    pattern: /거래정지|매매거래.*정지/,
    eventType: 'TRADING_SUSPENSION',
    label: '거래정지',
  },
  {
    pattern: /상장폐지|관리종목.*지정|투자경고|투자위험/,
    eventType: 'DELISTING_RISK',
    label: '상폐위험',
  },
  {
    pattern: /감사의견.*(거절|한정|부적정)|강조사항/,
    eventType: 'AUDIT_OPINION_RISK',
    label: '감사의견',
  },
  {
    pattern: /소송.*제기|소제기|횡령|배임/,
    eventType: 'LAWSUIT',
    label: '소송·횡령',
  },
  {
    // 계약 해제·해지·취소·종료 (체결과 구분되도록 해지 동사 명시).
    pattern: /(단일판매.*)?공급계약.*(해제|해지|취소|종료)|계약\s*(해제|해지)/,
    eventType: 'CONTRACT_CANCELLATION',
    label: '계약해지',
  },
];

export interface HighRiskInfo {
  eventType: HighRiskEventType;
  /** 칩/배지에 노출할 짧은 한글 라벨 */
  label: string;
}

/**
 * 보고서명으로 고위험 이벤트 5종 여부를 1차 판정한다.
 * 해당 없으면 null.
 */
export function getHighRiskInfo(reportName: string): HighRiskInfo | null {
  if (!reportName) return null;
  for (const rule of HIGH_RISK_RULES) {
    if (rule.pattern.test(reportName)) {
      return { eventType: rule.eventType, label: rule.label };
    }
  }
  return null;
}
