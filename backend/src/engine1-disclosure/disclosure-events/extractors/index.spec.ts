// backend/src/engine1-disclosure/disclosure-events/extractors/index.spec.ts
// extractEventData 디스패치 배선 테스트 — DAR-71 고위험 5종 배선 검증 중심

import { EventType } from '@prisma/client';
import { extractEventData } from './index';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as lawsuitFixture from '../__fixtures__/lawsuit-sample.json';
import * as auditFixture from '../__fixtures__/audit-opinion-risk-sample.json';
import * as suspensionFixture from '../__fixtures__/trading-suspension-sample.json';
import * as delistingFixture from '../__fixtures__/delisting-risk-sample.json';
import * as cancellationFixture from '../__fixtures__/contract-cancellation-sample.json';

const EMPTY: ParsedJson = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;

describe('extractEventData — DAR-71 고위험 5종 배선', () => {
  it('LAWSUIT → lawsuit 파서 + confidence 0.90', () => {
    const { data, confidence } = extractEventData(EventType.LAWSUIT, lawsuitFixture as ParsedJson, '소송 등의 제기');
    expect(data.lawsuitAmount).toBe(5_000_000_000);
    expect(data.companyRole).toBe('DEFENDANT');
    expect(confidence).toBe(0.9);
  });

  it('AUDIT_OPINION_RISK → audit 파서 + confidence 0.90', () => {
    const { data, confidence } = extractEventData(EventType.AUDIT_OPINION_RISK, auditFixture as ParsedJson, '감사보고서');
    expect(data.auditOpinion).toBe('DISCLAIMER');
    expect(confidence).toBe(0.9);
  });

  it('TRADING_SUSPENSION → suspension 파서 + confidence 0.90', () => {
    const { data, confidence } = extractEventData(EventType.TRADING_SUSPENSION, suspensionFixture as ParsedJson, '매매거래 정지');
    expect(data.suspensionType).toBe('AUDIT');
    expect(data.suspensionStartDate).toBe('2024-03-21');
    expect(confidence).toBe(0.9);
  });

  it('DELISTING_RISK → delisting 파서 + confidence 0.90', () => {
    const { data, confidence } = extractEventData(EventType.DELISTING_RISK, delistingFixture as ParsedJson, '실질심사');
    expect(data.delistingStage).toBe('SUBSTANTIVE_REVIEW');
    expect(confidence).toBe(0.9);
  });

  it('CONTRACT_CANCELLATION → cancellation 파서 + confidence 0.90', () => {
    const { data, confidence } = extractEventData(EventType.CONTRACT_CANCELLATION, cancellationFixture as ParsedJson, '공급계약 해제');
    expect(data.cancelledAmount).toBe(30_000_000_000);
    expect(data.cancelledRatio).toBe(25.0);
    expect(confidence).toBe(0.9);
  });

  describe('필수 필드 결측 → confidence 0.0 (NEEDS_REVIEW 경로)', () => {
    it.each([
      EventType.LAWSUIT,
      EventType.AUDIT_OPINION_RISK,
      EventType.TRADING_SUSPENSION,
      EventType.DELISTING_RISK,
      EventType.CONTRACT_CANCELLATION,
    ])('%s: 빈 parsedJson → 0.0', (eventType) => {
      const { confidence } = extractEventData(eventType, EMPTY, '');
      expect(confidence).toBe(0.0);
    });
  });

  // DAR-337: 대량보유(5%룰) 배선 — FAILED 최대 단일레버 복구
  it('MAJOR_HOLDER_5PCT → major-holder-5pct 파서 + 보유비율 존재 시 confidence 0.90', () => {
    const parsed = {
      docType: 'OTHER',
      rawTableCount: 1,
      keyValueSource: 'table_0',
      holdingRatio: 8.52,
      previousHoldingRatio: 6.31,
    } as ParsedJson;
    const { data, confidence } = extractEventData(
      EventType.MAJOR_HOLDER_5PCT,
      parsed,
      '주식등의 대량보유상황보고서',
    );
    expect(data.holdingRatio).toBe(8.52);
    expect(data.changeDirection).toBe('INCREASE');
    expect(confidence).toBe(0.9);
  });

  it('MAJOR_HOLDER_5PCT: 보유비율 부재 → 0.0 (상위 NEEDS_REVIEW 경로)', () => {
    const { confidence } = extractEventData(EventType.MAJOR_HOLDER_5PCT, EMPTY, '대량보유상황보고');
    expect(confidence).toBe(0.0);
  });

  it('회귀: 기존 7종(SUPPLY_CONTRACT) 배선 유지', () => {
    const parsed = { docType: 'SUPPLY_CONTRACT', rawTableCount: 1, keyValueSource: 'table_0', contractAmount: 1_000 } as ParsedJson;
    const { data, confidence } = extractEventData(EventType.SUPPLY_CONTRACT, parsed, '단일판매·공급계약체결');
    expect(data.contractAmount).toBe(1_000);
    expect(confidence).toBe(0.9);
  });

  it('미지원 EventType(OTHER) → data {} + confidence 0.0', () => {
    const { data, confidence } = extractEventData(EventType.OTHER, EMPTY, '');
    expect(data).toEqual({});
    expect(confidence).toBe(0.0);
  });

  // DAR-340: 유상증자 필수 수치(newShares·fundingAmount) 전부 부재 FAILED 회수
  describe('DAR-340 PAID_IN_CAPITAL_INCREASE 부분 confidence(0.70) 회수', () => {
    it('docType=PAID_IN_CAPITAL_INCREASE + 수치 전부 부재 → 0.0 아닌 0.70 (NEEDS_REVIEW 경로)', () => {
      const parsed = { docType: 'PAID_IN_CAPITAL_INCREASE', rawTableCount: 1, keyValueSource: 'table_0' } as ParsedJson;
      const { data, confidence } = extractEventData(
        EventType.PAID_IN_CAPITAL_INCREASE,
        parsed,
        '주요사항보고서(유상증자결정)',
      );
      expect(data.newShares).toBeNull();
      expect(data.fundingAmount).toBeNull();
      expect(data.partialFieldsPresent).toBe(true);
      expect(confidence).toBe(0.7);
    });

    it('THIRD_PARTY_ALLOTMENT도 동일 회수', () => {
      const parsed = { docType: 'THIRD_PARTY_ALLOTMENT', rawTableCount: 1, keyValueSource: 'table_0' } as ParsedJson;
      const { confidence } = extractEventData(EventType.THIRD_PARTY_ALLOTMENT, parsed, '유상증자(제3자배정)');
      expect(confidence).toBe(0.7);
    });

    it('newShares만 존재(부분필드) → 0.75 (회수 floor보다 위, 기존 보간 유지)', () => {
      const parsed = { docType: 'PAID_IN_CAPITAL_INCREASE', rawTableCount: 1, keyValueSource: 'table_0', newShares: 1_000 } as ParsedJson;
      const { confidence } = extractEventData(EventType.PAID_IN_CAPITAL_INCREASE, parsed, '유상증자');
      expect(confidence).toBe(0.75);
    });

    it('음성 대조군: 단서 전무(docType=OTHER, 수치·발행방식 부재) → 0.0 유지 (FAILED 천장 보존)', () => {
      const parsed = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      const { confidence } = extractEventData(EventType.PAID_IN_CAPITAL_INCREASE, parsed, '');
      expect(confidence).toBe(0.0);
    });
  });
});
