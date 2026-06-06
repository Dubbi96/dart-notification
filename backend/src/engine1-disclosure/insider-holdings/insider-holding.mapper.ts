// backend/src/engine1-disclosure/insider-holdings/insider-holding.mapper.ts
// DART 지분공시(majorstock/elestock) → InsiderHoldingChange 정규화 + EventType 매핑.
// 순수 함수(Rule 전용, AI 미개입). 결측은 graceful null. 멱등 upsert 입력 생성.

import { EventType } from '@prisma/client';
import {
  DartMajorStockItem,
  DartExecutiveStockItem,
} from '../dart-api/dart-api.service';

export type HoldingSource = 'MAJOR_STOCK' | 'EXECUTIVE';
export type TradeType = 'BUY' | 'SELL' | 'MIXED' | 'UNKNOWN';
export type Polarity = 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';

/** InsiderHoldingChange 멱등 upsert 입력 (Prisma create/update 공용 데이터). */
export interface InsiderHoldingChangeInput {
  source: HoldingSource;
  rcptNo: string;
  corpCode: string;
  reporter: string;
  relation: string | null;
  isExecutive: boolean | null;
  isRegistered: boolean | null;
  isMajorShareholder: boolean | null;
  sharesAfter: bigint | null;
  sharesChange: bigint | null;
  ratioAfter: number | null;
  ratioChange: number | null;
  tradeType: TradeType;
  unitPrice: number | null;
  reportReason: string | null;
  reportedAt: Date | null;
}

/**
 * DART 수치 문자열("1,234" / "-1,234" / "(1,234)" / "" / "-")을 숫자로 파싱.
 * 빈 값·'-'·비수치 → null. 괄호 표기는 음수.
 */
export function parseDartNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed === '-') return null;
  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[(),%\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

/** 정수 수량 파싱 → BigInt(null 허용). 소수점은 버림. */
export function parseDartBigInt(raw: string | undefined | null): bigint | null {
  const n = parseDartNumber(raw);
  if (n == null) return null;
  return BigInt(Math.trunc(n));
}

/** DART 일자(YYYYMMDD 또는 YYYY.MM.DD 등)를 Date로. 파싱 불가 → null. */
export function parseDartDate(raw: string | undefined | null): Date | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // UTC 자정 고정 — 타임존 표류 방지.
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 증감 수량/비율 부호로 취득·처분 방향 판정. */
export function deriveTradeType(
  sharesChange: bigint | null,
  ratioChange: number | null,
): TradeType {
  // 수량 증감 우선, 결측 시 비율 증감으로 폴백.
  if (sharesChange != null && sharesChange !== 0n) {
    return sharesChange > 0n ? 'BUY' : 'SELL';
  }
  if (ratioChange != null && ratioChange !== 0) {
    return ratioChange > 0 ? 'BUY' : 'SELL';
  }
  if (sharesChange === 0n || ratioChange === 0) {
    // 증감 0 명시 — 변동 없음(보유 현황 보고). 방향 없음.
    return 'MIXED';
  }
  return 'UNKNOWN';
}

/** majorstock.json 행 → 정규화 입력 (5%룰 대량보유). */
export function mapMajorStockItem(
  item: DartMajorStockItem,
): InsiderHoldingChangeInput | null {
  const rcptNo = (item.rcept_no ?? '').trim();
  const corpCode = (item.corp_code ?? '').trim();
  const reporter = (item.repror ?? '').trim();
  // 자연키(rcptNo·corpCode) 결측이면 적재 불가 — graceful skip.
  if (!rcptNo || !corpCode) return null;

  const sharesAfter = parseDartBigInt(item.stkqy);
  const sharesChange = parseDartBigInt(item.stkqy_irds);
  const ratioAfter = parseDartNumber(item.stkrt);
  const ratioChange = parseDartNumber(item.stkrt_irds);

  return {
    source: 'MAJOR_STOCK',
    rcptNo,
    corpCode,
    reporter: reporter || '(미상)',
    relation: cleanText(item.report_tp),
    isExecutive: null,
    isRegistered: null,
    isMajorShareholder: null,
    sharesAfter,
    sharesChange,
    ratioAfter,
    ratioChange,
    tradeType: deriveTradeType(sharesChange, ratioChange),
    unitPrice: null,
    reportReason: cleanText(item.report_resn),
    reportedAt: parseDartDate(item.rcept_dt),
  };
}

/** elestock.json 행 → 정규화 입력 (임원·주요주주 내부자). */
export function mapExecutiveStockItem(
  item: DartExecutiveStockItem,
): InsiderHoldingChangeInput | null {
  const rcptNo = (item.rcept_no ?? '').trim();
  const corpCode = (item.corp_code ?? '').trim();
  const reporter = (item.repror ?? '').trim();
  if (!rcptNo || !corpCode) return null;

  const sharesAfter = parseDartBigInt(item.sp_stock_lmp_cnt);
  const sharesChange = parseDartBigInt(item.sp_stock_lmp_irds_cnt);
  const ratioAfter = parseDartNumber(item.sp_stock_lmp_rate);
  const ratioChange = parseDartNumber(item.sp_stock_lmp_irds_rate);

  const registeredRaw = (item.isu_exctv_rgist_at ?? '').trim();
  const isRegistered = registeredRaw
    ? /등기/.test(registeredRaw) && !/비등기/.test(registeredRaw)
    : null;
  const ofcps = cleanText(item.isu_exctv_ofcps);
  const isExecutive = ofcps != null ? true : registeredRaw ? true : null;
  const mainShrholdr = (item.isu_main_shrholdr ?? '').trim();
  const isMajorShareholder = mainShrholdr ? !/해당\s*없음|없음|아니/.test(mainShrholdr) : null;

  return {
    source: 'EXECUTIVE',
    rcptNo,
    corpCode,
    reporter: reporter || '(미상)',
    relation: ofcps ?? cleanText(item.isu_main_shrholdr),
    isExecutive,
    isRegistered,
    isMajorShareholder,
    sharesAfter,
    sharesChange,
    ratioAfter,
    ratioChange,
    tradeType: deriveTradeType(sharesChange, ratioChange),
    unitPrice: null,
    reportReason: null,
    reportedAt: parseDartDate(item.rcept_dt),
  };
}

/**
 * 정규화 행 → DisclosureEvent용 (eventType, polarity) 매핑.
 * - EXECUTIVE(내부자): 순매수=INSIDER_BUY/POSITIVE, 순매도=INSIDER_SELL/NEGATIVE, 변동없음=UNKNOWN.
 * - MAJOR_STOCK(5%): MAJOR_HOLDER_5PCT, 지분 증가=POSITIVE/감소=NEGATIVE/변동없음=UNKNOWN.
 */
export function mapHoldingChangeToEvent(record: {
  source: HoldingSource;
  tradeType: TradeType;
}): { eventType: EventType; polarity: Polarity } {
  if (record.source === 'EXECUTIVE') {
    switch (record.tradeType) {
      case 'BUY':
        return { eventType: EventType.INSIDER_BUY, polarity: 'POSITIVE' };
      case 'SELL':
        return { eventType: EventType.INSIDER_SELL, polarity: 'NEGATIVE' };
      default:
        // 변동없음/미상 — 내부자 보고이나 방향 불명.
        return { eventType: EventType.INSIDER_BUY, polarity: 'UNKNOWN' };
    }
  }

  // MAJOR_STOCK (5% 대량보유)
  switch (record.tradeType) {
    case 'BUY':
      return { eventType: EventType.MAJOR_HOLDER_5PCT, polarity: 'POSITIVE' };
    case 'SELL':
      return { eventType: EventType.MAJOR_HOLDER_5PCT, polarity: 'NEGATIVE' };
    default:
      return { eventType: EventType.MAJOR_HOLDER_5PCT, polarity: 'UNKNOWN' };
  }
}

/** 빈 문자열/'-' → null, 그 외 trim 문자열. */
function cleanText(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  return t === '' || t === '-' ? null : t;
}
