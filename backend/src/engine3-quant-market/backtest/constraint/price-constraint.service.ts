import { Injectable } from '@nestjs/common';
import { DailyPrice } from '../ports/backtest.types';

/** 유동성 부족 판정 임계 거래량 (주) */
const MIN_LIQUIDITY_VOLUME = 10000;

/**
 * 현실 제약 판정 서비스
 * 상한가·하한가·거래정지·관리종목·유동성 체크
 */
@Injectable()
export class PriceConstraintService {
  /** 진입 불가 여부 판정 (상한가, 거래정지, 관리종목) */
  canEnter(price: DailyPrice): boolean {
    if (price.isTradingSuspended) return false;
    if (price.isAdminStock) return false;
    if (price.isLimitUp) return false;
    return true;
  }

  /** 부분체결 시뮬 — 상한가 접근 시 fillRate 감소 */
  simulateFillRate(price: DailyPrice, requestedShares: number): number {
    if (!this.canEnter(price)) return 0;
    if (price.isLimitUp) return 0;
    const volumeFactor = price.volume > 0 ? Math.min(1, price.volume / (requestedShares * 10)) : 1;
    return Math.max(0.1, Math.min(1, volumeFactor));
  }

  /** 유동성 부족 경고 */
  isLowLiquidity(price: DailyPrice): boolean {
    return price.volume < MIN_LIQUIDITY_VOLUME;
  }

  /**
   * 슬리피지 적용 가격
   * 진입 시: open * (1 + slippagePct)
   * 청산 시: price * (1 - slippagePct)
   */
  applySlippage(price: number, slippagePct: number, isBuy: boolean): number {
    return isBuy ? price * (1 + slippagePct) : price * (1 - slippagePct);
  }

  /** 수수료 계산 (매수·매도 각각 적용) */
  calcCommission(value: number, commissionRate: number): number {
    return value * commissionRate;
  }

  /** 매도 세금 계산 */
  calcTax(value: number, taxRate: number): number {
    return value * taxRate;
  }
}
