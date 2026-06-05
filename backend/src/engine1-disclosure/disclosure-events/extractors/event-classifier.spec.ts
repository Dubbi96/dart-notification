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
