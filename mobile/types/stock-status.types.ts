/**
 * 종목 위험상태(관리종목·거래정지·상폐위험) 타입 (DAR-99).
 * 백엔드 StockRiskStatus 와 1:1. KRX 승인 전엔 DART 공시 폴백 도출분(근사값)이며
 * KRX 승인 후 데이터소스만 교체하고 이 계약은 불변.
 */

/** 데이터 출처 — 현재 DART 공시 폴백 */
export type StockStatusSource = 'DART_FALLBACK';

export interface StockRiskStatus {
  /** DART 고유번호(8자리) — 미상이면 null */
  corpCode: string | null;
  /** 종목코드(6자리) — 비상장/미상이면 null */
  stockCode: string | null;
  /** 기업명 — 미상이면 null */
  corpName: string | null;
  /** 관리종목 (DELISTING_RISK / AUDIT_OPINION_RISK 지정, 미해제) */
  isManagement: boolean;
  /** 거래정지 (TRADING_SUSPENSION 지정, 미해제) */
  isHalted: boolean;
  /** 상장폐지 위험 (DELISTING_RISK 지정, 미해제) — isManagement 의 부분집합 */
  isDelistingRisk: boolean;
  /** 사유 (예: "관리종목 지정 (DART 공시 폴백)") — 상태 없으면 null */
  statusNote: string | null;
  /** 근거 공시 접수번호 — 없으면 null */
  sourceRcpNo: string | null;
  /** 근거 공시 접수일 (YYYYMMDD) — 없으면 null */
  sourceRcpDt: string | null;
  /** 데이터 출처 */
  source: StockStatusSource;
  /** 근사값 여부 — DART 공시 기반이므로 항상 true. '근사값' 라벨 노출 근거. */
  approximate: boolean;
}
