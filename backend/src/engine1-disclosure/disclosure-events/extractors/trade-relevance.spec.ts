// backend/src/engine1-disclosure/disclosure-events/extractors/trade-relevance.spec.ts
// DAR-394: 보고서명 메타데이터만으로 거래대상(신호 생산) 후보를 정확히 식별하는지 검증.
//   문서 fetch 전에 한정 DART 쿼터를 신호 공시에 집중하는 선별의 정확도가 핵심 DoD.

import { EventType } from '@prisma/client';
import {
  TRADE_RELEVANT_EVENT_TYPES,
  TRADE_RELEVANT_REPORT_NAME_KEYWORDS,
  isTradeRelevantReportName,
  tradeRelevantReportNameFilter,
} from './trade-relevance';
import { classifyByReportName } from './event-classifier';

describe('trade-relevance (DAR-394 거래대상 메타 선별)', () => {
  describe('isTradeRelevantReportName — 거래대상 식별 정확', () => {
    // 거래대상(신호 생산) 보고서명 대표 표본 — 실제 DART reportName 형식.
    const TRADE_RELEVANT_SAMPLES: ReadonlyArray<[string, EventType]> = [
      ['단일판매ㆍ공급계약체결', EventType.SUPPLY_CONTRACT],
      ['단일판매ㆍ공급계약 해제ㆍ취소', EventType.CONTRACT_CANCELLATION],
      ['주요사항보고서(자기주식취득결정)', EventType.SHARE_BUYBACK],
      ['주요사항보고서(자기주식소각결정)', EventType.SHARE_CANCELLATION],
      ['현금ㆍ현물배당결정', EventType.DIVIDEND_INCREASE],
      ['주요사항보고서(유상증자결정)', EventType.PAID_IN_CAPITAL_INCREASE],
      ['유상증자결정(제3자배정)', EventType.THIRD_PARTY_ALLOTMENT],
      ['주요사항보고서(전환사채권발행결정)', EventType.CB_ISSUANCE],
      ['주요사항보고서(신주인수권부사채권발행결정)', EventType.BW_ISSUANCE],
      ['최대주주변경', EventType.MAJOR_SHAREHOLDER_CHANGE],
      ['영업(잠정)실적(공정공시)', EventType.EARNINGS_SURPRISE],
      ['매출액또는손익구조30%(대규모법인은15%)이상변동', EventType.EARNINGS_SURPRISE],
      ['소송등의제기ㆍ신청(경영권분쟁소송)', EventType.LAWSUIT],
      ['감사보고서제출(감사의견 거절)', EventType.AUDIT_OPINION_RISK],
      ['매매거래정지및정지해제(불성실공시법인지정)', EventType.TRADING_SUSPENSION],
      ['상장폐지에관한안내(상장폐지사유발생)', EventType.DELISTING_RISK],
    ];

    it.each(TRADE_RELEVANT_SAMPLES)(
      '%s → 거래대상(%s)으로 식별한다',
      (reportName, expectedType) => {
        expect(classifyByReportName(reportName)?.eventType).toBe(expectedType);
        expect(TRADE_RELEVANT_EVENT_TYPES.has(expectedType)).toBe(true);
        expect(isTradeRelevantReportName(reportName)).toBe(true);
      },
    );

    // 비거래대상(신호 0) 보고서명 — fetch 해도 신호가 안 나오는 절차성/정기 공시.
    const NON_TRADE_SAMPLES: readonly string[] = [
      '분기보고서',
      '반기보고서',
      '사업보고서',
      '기업설명회(IR)개최(안내공시)',
      '주주총회소집결의',
      '임원ㆍ주요주주특정증권등소유상황보고서',
      '대규모기업집단현황공시',
      '타법인주식및출자증권취득결정', // INVESTMENT_DECISION(비거래대상)
      '주식매수선택권부여결정', // STOCK_OPTION(비거래대상)
      '기타경영사항(자율공시)', // 미매칭 → null → 비거래
    ];

    it.each(NON_TRADE_SAMPLES)('%s → 비거래대상으로 본다', (reportName) => {
      expect(isTradeRelevantReportName(reportName)).toBe(false);
    });

    it('null/빈 보고서명은 비거래대상(graceful)', () => {
      expect(isTradeRelevantReportName(null)).toBe(false);
      expect(isTradeRelevantReportName(undefined)).toBe(false);
      expect(isTradeRelevantReportName('')).toBe(false);
    });
  });

  describe('TRADE_RELEVANT_EVENT_TYPES ↔ persona-view 정합', () => {
    it('거래대상 집합은 17종(FAVORED 6 ∪ DILUTIVE 4 ∪ NEGATIVE 7)', () => {
      // persona-view.rule 의 신호 생산 집합과 1:1 — 발산하면 우선순위 누락.
      expect(TRADE_RELEVANT_EVENT_TYPES.size).toBe(17);
    });
  });

  describe('TRADE_RELEVANT_REPORT_NAME_KEYWORDS — SQL prefilter 상위집합 불변식', () => {
    it('모든 거래대상 대표 보고서명은 최소 1개 키워드에 매칭된다(거짓음성 0)', () => {
      // 키워드 prefilter 가 거래대상을 놓치면(거짓음성) 우선순위에서 빠진다.
      const samples = [
        '단일판매ㆍ공급계약체결',
        '주요사항보고서(자기주식취득결정)',
        '주요사항보고서(자기주식소각결정)',
        '현금ㆍ현물배당결정',
        '주요사항보고서(유상증자결정)',
        '주요사항보고서(전환사채권발행결정)',
        '주요사항보고서(신주인수권부사채권발행결정)',
        '최대주주변경',
        '영업(잠정)실적(공정공시)',
        '소송등의제기ㆍ신청',
        '감사보고서제출(감사의견 거절)',
        '매매거래정지및정지해제',
        '상장폐지에관한안내',
      ];
      for (const name of samples) {
        const matched = TRADE_RELEVANT_REPORT_NAME_KEYWORDS.some((kw) =>
          name.includes(kw),
        );
        expect(matched).toBe(true);
      }
    });

    it('tradeRelevantReportNameFilter 는 키워드 OR contains(insensitive) where 를 만든다', () => {
      const filter = tradeRelevantReportNameFilter();
      expect(filter.OR).toHaveLength(TRADE_RELEVANT_REPORT_NAME_KEYWORDS.length);
      expect(filter.OR[0]).toEqual({
        reportName: {
          contains: TRADE_RELEVANT_REPORT_NAME_KEYWORDS[0],
          mode: 'insensitive',
        },
      });
    });
  });
});
