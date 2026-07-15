// backend/src/disclosure-events/extractors/event-classifier.spec.ts
// 이벤트 분류기 단위 테스트 (네트워크/DB 없음, 순수 함수)

import { EventType } from '@prisma/client';
import { classifyEventType } from './event-classifier';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

// 최소 ParsedJson 픽스처 생성 헬퍼
function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount: 0,
    keyValueSource: 'none',
    ...overrides,
  } as ParsedJson;
}

describe('classifyEventType', () => {
  // ── 계약 ────────────────────────────────────────────────────────────────────

  it('단일판매·공급계약체결 → SUPPLY_CONTRACT', () => {
    const result = classifyEventType(
      '단일판매·공급계약체결',
      makeParsedJson(),
    );
    expect(result.eventType).toBe(EventType.SUPPLY_CONTRACT);
    expect(result.polarity).toBe('POSITIVE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('공급계약 체결 → SUPPLY_CONTRACT', () => {
    const result = classifyEventType('공급계약 체결', makeParsedJson());
    expect(result.eventType).toBe(EventType.SUPPLY_CONTRACT);
  });

  it('단일판매·공급계약 해제 → CONTRACT_CANCELLATION', () => {
    const result = classifyEventType(
      '단일판매·공급계약 해제',
      makeParsedJson(),
    );
    expect(result.eventType).toBe(EventType.CONTRACT_CANCELLATION);
    expect(result.polarity).toBe('NEGATIVE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('공급계약 취소 → CONTRACT_CANCELLATION', () => {
    const result = classifyEventType('공급계약 취소', makeParsedJson());
    expect(result.eventType).toBe(EventType.CONTRACT_CANCELLATION);
  });

  // ── 자기주식 ──────────────────────────────────────────────────────────────

  it('자기주식 취득 → SHARE_BUYBACK', () => {
    const result = classifyEventType(
      '자기주식 취득 결정',
      makeParsedJson({ docType: 'SHARE_BUYBACK' }),
    );
    expect(result.eventType).toBe(EventType.SHARE_BUYBACK);
    expect(result.polarity).toBe('POSITIVE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('자기주식 소각 → SHARE_CANCELLATION', () => {
    const result = classifyEventType(
      '자기주식 소각 결정',
      makeParsedJson({ docType: 'SHARE_CANCELLATION' }),
    );
    expect(result.eventType).toBe(EventType.SHARE_CANCELLATION);
    expect(result.polarity).toBe('POSITIVE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  // ── 배당 ──────────────────────────────────────────────────────────────────

  it('현금배당 결정 → DIVIDEND_INCREASE', () => {
    const result = classifyEventType(
      '현금배당 결정',
      makeParsedJson({ docType: 'DIVIDEND' }),
    );
    expect(result.eventType).toBe(EventType.DIVIDEND_INCREASE);
    expect(result.polarity).toBe('POSITIVE');
  });

  it('배당 중단 → DIVIDEND_CUT', () => {
    const result = classifyEventType('배당 중단', makeParsedJson());
    expect(result.eventType).toBe(EventType.DIVIDEND_CUT);
    expect(result.polarity).toBe('NEGATIVE');
  });

  // ── 유상증자 ──────────────────────────────────────────────────────────────

  it('유상증자(주주배정) → PAID_IN_CAPITAL_INCREASE', () => {
    const result = classifyEventType(
      '유상증자(주주배정) 결정',
      makeParsedJson({ docType: 'PAID_IN_CAPITAL_INCREASE' }),
    );
    expect(result.eventType).toBe(EventType.PAID_IN_CAPITAL_INCREASE);
    expect(result.polarity).toBe('NEGATIVE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('유상증자(제3자배정) → THIRD_PARTY_ALLOTMENT', () => {
    const result = classifyEventType(
      '유상증자(제3자배정) 결정',
      makeParsedJson(),
    );
    expect(result.eventType).toBe(EventType.THIRD_PARTY_ALLOTMENT);
    expect(result.polarity).toBe('NEGATIVE');
  });

  it('단순 유상증자 → PAID_IN_CAPITAL_INCREASE (confidence 낮음)', () => {
    const result = classifyEventType('유상증자 결의', makeParsedJson());
    expect(result.eventType).toBe(EventType.PAID_IN_CAPITAL_INCREASE);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  // ── CB/BW ─────────────────────────────────────────────────────────────────

  it('전환사채 발행 결정 → CB_ISSUANCE', () => {
    const result = classifyEventType(
      '전환사채 발행 결정',
      makeParsedJson({ docType: 'CB_BW_ISSUANCE', bondType: 'CB' }),
    );
    expect(result.eventType).toBe(EventType.CB_ISSUANCE);
    expect(result.polarity).toBe('NEGATIVE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('신주인수권부사채 발행 → BW_ISSUANCE', () => {
    const result = classifyEventType(
      '신주인수권부사채 발행 결정',
      makeParsedJson({ docType: 'CB_BW_ISSUANCE', bondType: 'BW' }),
    );
    expect(result.eventType).toBe(EventType.BW_ISSUANCE);
    expect(result.polarity).toBe('NEGATIVE');
  });

  // ── 리스크 이벤트 ─────────────────────────────────────────────────────────

  it('거래정지 → TRADING_SUSPENSION (confidence 높음)', () => {
    const result = classifyEventType('매매거래 정지', makeParsedJson());
    expect(result.eventType).toBe(EventType.TRADING_SUSPENSION);
    expect(result.polarity).toBe('NEGATIVE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('관리종목 지정 → DELISTING_RISK', () => {
    const result = classifyEventType('관리종목 지정', makeParsedJson());
    expect(result.eventType).toBe(EventType.DELISTING_RISK);
    expect(result.polarity).toBe('NEGATIVE');
  });

  it('최대주주 변경 → MAJOR_SHAREHOLDER_CHANGE', () => {
    const result = classifyEventType('최대주주 변경', makeParsedJson());
    expect(result.eventType).toBe(EventType.MAJOR_SHAREHOLDER_CHANGE);
    expect(result.polarity).toBe('MIXED');
  });

  it('소송 제기 → LAWSUIT', () => {
    const result = classifyEventType('소송 제기', makeParsedJson());
    expect(result.eventType).toBe(EventType.LAWSUIT);
    expect(result.polarity).toBe('NEGATIVE');
  });

  it('감사의견 거절 → AUDIT_OPINION_RISK', () => {
    const result = classifyEventType('감사의견 거절', makeParsedJson());
    expect(result.eventType).toBe(EventType.AUDIT_OPINION_RISK);
    expect(result.polarity).toBe('NEGATIVE');
  });

  // ── 2차 docType 보완 ──────────────────────────────────────────────────────

  it('보고서명 미매칭 → docType 보완으로 분류', () => {
    const result = classifyEventType(
      '주요사항보고서',
      makeParsedJson({ docType: 'SHARE_BUYBACK' }),
    );
    expect(result.eventType).toBe(EventType.SHARE_BUYBACK);
    expect(result.confidence).toBe(0.70);
  });

  it('CB_BW_ISSUANCE docType + BW bondType → BW_ISSUANCE', () => {
    const result = classifyEventType(
      '주요사항보고서',
      makeParsedJson({ docType: 'CB_BW_ISSUANCE', bondType: 'BW' }),
    );
    expect(result.eventType).toBe(EventType.BW_ISSUANCE);
    expect(result.confidence).toBe(0.70);
  });

  // ── 미매칭 → OTHER ────────────────────────────────────────────────────────

  it('불명확 보고서명 + docType 없음 → OTHER, confidence 0.40', () => {
    const result = classifyEventType(
      '기타 주요사항',
      makeParsedJson({ docType: '' }),
    );
    expect(result.eventType).toBe(EventType.OTHER);
    expect(result.confidence).toBe(0.40);
  });

  // ── confidence 범위 검증 ──────────────────────────────────────────────────

  it('모든 Rule 매칭 결과의 confidence는 0.0~1.0 범위', () => {
    const testCases = [
      '단일판매·공급계약체결',
      '자기주식 취득',
      '전환사채 발행',
      '유상증자',
      '상장폐지',
    ];
    for (const reportName of testCases) {
      const result = classifyEventType(reportName, makeParsedJson());
      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DAR-346: 미모델 공시유형 분류 확대 (OTHER 4225 축소)
// 라이브 reportName 전수조사 상위 유형이 더 이상 OTHER로 떨어지지 않음을 고정.
// 모든 fixture는 docType=''(2차 보완 비활성) → 순수 reportName 룰 동작만 검증.
// ════════════════════════════════════════════════════════════════════════════

describe('classifyEventType — DAR-346 미모델 공시유형 확대', () => {
  const noDocType = (): ParsedJson => makeParsedJson({ docType: '' });
  const classify = (reportName: string) =>
    classifyEventType(reportName, noDocType());

  // (reportName, 기대 eventType, 기대 polarity) — 라이브 상위 유형 1:1 매핑
  const cases: Array<[string, EventType, string]> = [
    // 임원·주요주주 특정증권등 (774건, 라이브 최대 OTHER)
    ['임원ㆍ주요주주특정증권등소유상황보고서', EventType.INSIDER_TRADING_REPORT, 'UNKNOWN'],
    ['임원ㆍ주요주주특정증권등거래계획보고서', EventType.INSIDER_TRADING_REPORT, 'UNKNOWN'],
    // 증권 발행/모집 서류 (1345건)
    ['투자설명서(일괄신고)', EventType.SECURITIES_OFFERING, 'UNKNOWN'],
    ['증권발행실적보고서', EventType.SECURITIES_OFFERING, 'UNKNOWN'],
    ['일괄신고추가서류(파생결합사채-주가연계파생결합사채)', EventType.SECURITIES_OFFERING, 'UNKNOWN'],
    ['[기재정정]증권신고서(지분증권)', EventType.SECURITIES_OFFERING, 'UNKNOWN'],
    // 정기/감사 보고
    ['감사보고서 (2025.12)', EventType.PERIODIC_DISCLOSURE, 'UNKNOWN'],
    ['[기재정정]사업보고서 (2025.12)', EventType.PERIODIC_DISCLOSURE, 'UNKNOWN'],
    ['[기재정정]분기보고서 (2026.03)', EventType.PERIODIC_DISCLOSURE, 'UNKNOWN'],
    ['연결감사보고서 (2025.12)', EventType.PERIODIC_DISCLOSURE, 'UNKNOWN'],
    // 주주총회·의결권·기준일
    ['주주총회소집공고', EventType.SHAREHOLDER_MEETING, 'UNKNOWN'],
    ['주주총회소집결의              (임시주주총회)', EventType.SHAREHOLDER_MEETING, 'UNKNOWN'],
    ['의결권대리행사권유참고서류', EventType.SHAREHOLDER_MEETING, 'UNKNOWN'],
    ['주주명부폐쇄기간또는기준일설정', EventType.SHAREHOLDER_MEETING, 'UNKNOWN'],
    // IR
    ['기업설명회(IR)개최', EventType.IR_EVENT, 'UNKNOWN'],
    ['기업설명회(IR)개최결과', EventType.IR_EVENT, 'UNKNOWN'],
    // 특수관계인 거래
    ['특수관계인으로부터자금차입', EventType.RELATED_PARTY_TRANSACTION, 'MIXED'],
    ['동일인등출자계열회사와의상품ㆍ용역거래', EventType.RELATED_PARTY_TRANSACTION, 'MIXED'],
    // 대규모기업집단
    ['[기재정정]대규모기업집단현황공시[연1회공시및1/4분기용(개별회사)]', EventType.AFFILIATE_GROUP_DISCLOSURE, 'UNKNOWN'],
    // 최대주주등 소유주식 변동 (지배변경 아님)
    ['최대주주등소유주식변동신고서', EventType.OWNERSHIP_DISCLOSURE, 'UNKNOWN'],
    // 채무보증·담보·대여·차입 (특수관계인 단서 없는 건)
    ['타인에대한채무보증결정', EventType.DEBT_GUARANTEE, 'NEGATIVE'],
    ['단기차입금증가결정', EventType.DEBT_GUARANTEE, 'NEGATIVE'],
    ['금전대여결정', EventType.DEBT_GUARANTEE, 'NEGATIVE'],
    // 투자 결정
    ['타법인주식및출자증권취득결정', EventType.INVESTMENT_DECISION, 'MIXED'],
    ['신규시설투자등', EventType.INVESTMENT_DECISION, 'MIXED'],
    ['주요사항보고서(유형자산양수결정)', EventType.INVESTMENT_DECISION, 'MIXED'],
    // 감자·주식병합
    ['[기재정정]주요사항보고서(감자결정)', EventType.CAPITAL_REDUCTION, 'NEGATIVE'],
    ['주식병합결정', EventType.CAPITAL_REDUCTION, 'NEGATIVE'],
    // 무상증자
    ['주요사항보고서(무상증자결정)', EventType.BONUS_ISSUE, 'POSITIVE'],
    // 합병·분할·양수도
    ['합병등종료보고서(합병)', EventType.MERGER_SPLIT, 'MIXED'],
    ['[기재정정]주요사항보고서(회사합병결정)', EventType.MERGER_SPLIT, 'MIXED'],
    ['[기재정정]자산양도등의등록신청서', EventType.MERGER_SPLIT, 'MIXED'],
    // 스톡옵션
    ['[기재정정]주식매수선택권부여에관한신고', EventType.STOCK_OPTION, 'UNKNOWN'],
    // 임원 변경
    ['대표이사변경', EventType.EXECUTIVE_CHANGE, 'UNKNOWN'],
    ['사외이사의선임ㆍ해임또는중도퇴임에관한신고', EventType.EXECUTIVE_CHANGE, 'UNKNOWN'],
    // 조회공시·풍문해명
    ['조회공시요구(현저한시황변동)에대한답변(미확정)', EventType.INQUIRY_DISCLOSURE, 'MIXED'],
    ['풍문또는보도에대한해명(미확정)', EventType.INQUIRY_DISCLOSURE, 'MIXED'],
    // 전환청구권 행사·가액조정
    ['전환청구권행사(제1회차)', EventType.CONVERTIBLE_EXERCISE, 'UNKNOWN'],
    ['전환가액ㆍ신주인수권행사가액ㆍ교환가액의조정(안내공시)', EventType.CONVERTIBLE_EXERCISE, 'UNKNOWN'],
    // 거래소 기타 시장안내
    ['기타시장안내(금일NXT경쟁매매대상종목지정으로인한KRX시간외단일가매매제외종목안내(유가증권시장))', EventType.MARKET_NOTICE, 'UNKNOWN'],
    // 주식소각(자기주식 명시 없음) → SHARE_CANCELLATION 보강
    ['주식소각결정', EventType.SHARE_CANCELLATION, 'POSITIVE'],
    // 신탁계약 자기주식 매입 라이프사이클 → SHARE_BUYBACK 보강
    ['신탁계약에의한취득상황보고서', EventType.SHARE_BUYBACK, 'POSITIVE'],
    ['신탁계약해지결과보고서', EventType.SHARE_BUYBACK, 'POSITIVE'],
  ];

  it.each(cases)(
    '%s → %s 로 분류되어 더 이상 OTHER가 아니다',
    (reportName, expectedType, expectedPolarity) => {
      const result = classify(reportName);
      expect(result.eventType).toBe(expectedType);
      expect(result.eventType).not.toBe(EventType.OTHER);
      expect(result.polarity).toBe(expectedPolarity);
      expect(result.confidence).toBeGreaterThanOrEqual(0.60); // NEEDS_REVIEW 이상 라우팅 보장
    },
  );

  // ── 우선순위(직렬) 보장: 기존 시그널 룰이 항상 신규 룰을 이긴다 ──────────────
  it('기존 시그널 룰 우선: "자기주식 소각" 은 신규 "주식 소각" 룰보다 먼저 매칭(둘 다 SHARE_CANCELLATION이나 conf 유지)', () => {
    const result = classify('자기주식 소각 결정');
    expect(result.eventType).toBe(EventType.SHARE_CANCELLATION);
    expect(result.confidence).toBe(0.95); // 기존 룰 conf — 신규 0.88이 덮어쓰지 않음
  });

  it('기존 시그널 룰 우선: "단일판매·공급계약" 은 신규 어떤 룰보다 먼저 SUPPLY_CONTRACT', () => {
    const result = classify('단일판매·공급계약체결');
    expect(result.eventType).toBe(EventType.SUPPLY_CONTRACT);
  });

  it('INSIDER_TRADING_REPORT 가 EXECUTIVE_CHANGE 보다 먼저: "임원…특정증권" 은 임원 변경이 아님', () => {
    const result = classify('임원ㆍ주요주주특정증권등소유상황보고서');
    expect(result.eventType).toBe(EventType.INSIDER_TRADING_REPORT);
  });

  it('RELATED_PARTY 가 DEBT_GUARANTEE 보다 먼저: "특수관계인으로부터자금차입" 은 특수관계인 거래', () => {
    const result = classify('특수관계인으로부터자금차입');
    expect(result.eventType).toBe(EventType.RELATED_PARTY_TRANSACTION);
  });

  it('"유무상증자" 는 유상증자 토큰 미포함 → BONUS_ISSUE(무상증자)로 도달', () => {
    const result = classify('[기재정정]주요사항보고서(유무상증자결정)');
    expect(result.eventType).toBe(EventType.BONUS_ISSUE);
  });

  // ── 음성 대조: 정말 미상인 공시는 여전히 OTHER ───────────────────────────────
  it('완전 미상 보고서명은 여전히 OTHER(0.40) — 무차별 회수 아님', () => {
    const result = classify('기타 알 수 없는 임의 보고서 제목 XYZ');
    expect(result.eventType).toBe(EventType.OTHER);
    expect(result.confidence).toBe(0.40);
  });

  // ── 정형/절차성 공시는 0.80 (FAILED 라우팅), 재료성 행위는 0.85 (AI L1) ──────
  it('정형·절차성 공시 confidence = 0.80 (AI 자동 라우팅 제외)', () => {
    for (const rn of ['감사보고서 (2025.12)', '주주총회소집공고', '기업설명회(IR)개최']) {
      expect(classify(rn).confidence).toBe(0.80);
    }
  });

  it('재료성 행위 confidence = 0.85 (AWAITING_AI_L1)', () => {
    for (const rn of ['주요사항보고서(무상증자결정)', '[기재정정]주요사항보고서(감자결정)']) {
      expect(classify(rn).confidence).toBe(0.85);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W9: 실적 가이던스(자사 전망 공정공시) — EARNINGS_GUIDANCE 신설
// 현재 OTHER로 버려지던 '영업실적 등에 대한 전망'·'장래사업·경영계획' 계열이
// EARNINGS_GUIDANCE 로 분류되고, 확정 실적(잠정실적) 룰과 상호 오염이 없음을 고정.
// ════════════════════════════════════════════════════════════════════════════

describe('classifyEventType — W9 EARNINGS_GUIDANCE (자사 전망)', () => {
  const noDocType = (): ParsedJson => makeParsedJson({ docType: '' });
  const classify = (reportName: string) =>
    classifyEventType(reportName, noDocType());

  // 실제 DART 보고서명 샘플(공백 유무·기재정정·중점 문자 변형 포함)
  const guidanceTitles: string[] = [
    '연결재무제표기준영업실적등에대한전망(공정공시)',
    '연결재무제표 기준 영업실적 등에 대한 전망(공정공시)',
    '영업실적등에대한전망(공정공시)',
    '[기재정정]연결재무제표기준영업실적등에대한전망(공정공시)',
    '장래사업ㆍ경영계획(공정공시)', // U+318D 한글 중점
    '장래사업·경영계획(공정공시)', // U+00B7 가운뎃점
    '[기재정정]장래사업 · 경영계획(공정공시)',
    '장래사업 및 경영계획(공정공시)',
  ];

  it.each(guidanceTitles)(
    '%s → EARNINGS_GUIDANCE (MIXED, confidence ≥ 0.85)',
    (reportName) => {
      const result = classify(reportName);
      expect(result.eventType).toBe(EventType.EARNINGS_GUIDANCE);
      expect(result.polarity).toBe('MIXED');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    },
  );

  // ── 상호 오염 없음: 확정 실적(잠정실적)은 여전히 EARNINGS_SURPRISE 계열 ──────
  it('회귀: 연결재무제표기준영업(잠정)실적(공정공시) → EARNINGS_SURPRISE (가이던스 아님)', () => {
    const result = classify('연결재무제표기준영업(잠정)실적(공정공시)');
    expect(result.eventType).toBe(EventType.EARNINGS_SURPRISE);
    expect(result.eventType).not.toBe(EventType.EARNINGS_GUIDANCE);
  });

  it('회귀: 매출액또는손익구조30%(대규모법인은15%)이상변동 → EARNINGS_SURPRISE (가이던스 아님)', () => {
    const result = classify('매출액또는손익구조30%(대규모법인은15%)이상변동');
    expect(result.eventType).toBe(EventType.EARNINGS_SURPRISE);
  });

  it('회귀: 실적 악화(쇼크) 보고서명은 여전히 EARNINGS_SHOCK', () => {
    const result = classify('영업실적 적자전환');
    expect(result.eventType).toBe(EventType.EARNINGS_SHOCK);
  });

  // ── 음성 대조: 전망 토큰 없는 공정공시는 가이던스가 아니다 ────────────────────
  it('음성 대조: 수시공시의무관련사항(공정공시) 은 EARNINGS_GUIDANCE 가 아님', () => {
    const result = classify('수시공시의무관련사항(공정공시)');
    expect(result.eventType).not.toBe(EventType.EARNINGS_GUIDANCE);
  });
});
