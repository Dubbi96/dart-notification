/**
 * asset-class.ts — 다자산 도메인 추상화의 단일 진입점 (DAR-77)
 *
 * cc-multi-asset-expansion.md §6-1 설계를 코드로 착지한 것.
 * ★범위: 추상화만. 미국·코인 실데이터/실주문은 M10 졸업 후 별도 항목에서 착수한다.
 * 본 파일은 자산군 무관 식별(assetClass + symbol)을 가산형으로 도입하되,
 * 현행 KR 경로는 기본값 KR_STOCK 으로 완전히 보존한다.
 */

/** 자산군 식별 enum. KR_STOCK 만 현행 구현이며 나머지는 후속 마일스톤(M13A/M13B) 예정. */
export enum AssetClass {
  /** 국내 주식 — 현행(DART corpCode 기준) */
  KR_STOCK = 'KR_STOCK',
  /** 미국 주식 — M13A 예정(미구현) */
  US_STOCK = 'US_STOCK',
  /** 암호화폐 — M13B 예정(미구현) */
  CRYPTO = 'CRYPTO',
}

/**
 * 기존 호출 동작 보존용 기본 자산군.
 * 포트 시그니처에 assetClass 를 가산할 때 이 값을 기본값으로 둬서
 * 자산군을 넘기지 않는 현행 KR 호출이 그대로 동작하도록 한다.
 */
export const DEFAULT_ASSET_CLASS: AssetClass = AssetClass.KR_STOCK;

/** 자산군별 기준 통화 (§6-1). 실손익은 KRW 환산 기준으로 통일 예정(추후 항목). */
export type AssetCurrency = 'KRW' | 'USD' | 'USDT';

/**
 * 자산 공통 식별자 (§6-1).
 * - KR_STOCK: primaryId = corpCode, displayTicker = 종목코드
 * - US_STOCK: primaryId = 'AAPL:NASDAQ'
 * - CRYPTO:   primaryId = 'BTC:USDT'
 */
export interface AssetIdentifier {
  assetClass: AssetClass;
  primaryId: string;
  displayTicker: string;
  currency: AssetCurrency;
}

/** 현재 실구현이 존재하는 자산군 집합. 후속 어댑터가 추가될 때만 확장한다. */
const IMPLEMENTED_ASSET_CLASSES: ReadonlySet<AssetClass> = new Set([
  AssetClass.KR_STOCK,
]);

/** 해당 자산군이 실제 어댑터로 구현되어 있는지 여부. */
export function isAssetClassImplemented(assetClass: AssetClass): boolean {
  return IMPLEMENTED_ASSET_CLASSES.has(assetClass);
}

/**
 * 미구현 자산군 접근 시 던지는 명시적 스텁 에러.
 * "조용한 오동작" 대신 후속 확장 지점을 분명히 드러낸다.
 */
export class AssetClassNotImplementedError extends Error {
  constructor(
    readonly assetClass: AssetClass,
    context?: string,
  ) {
    super(
      `AssetClass '${assetClass}' 은(는) 아직 구현되지 않았습니다` +
        (context ? ` (${context})` : '') +
        '. 추상화만 도입됨 — 실데이터/실주문은 M10 졸업 후 후속 항목에서 착수.',
    );
    this.name = 'AssetClassNotImplementedError';
  }
}

/**
 * 자산군이 지원(구현)되는지 가드. 미구현이면 AssetClassNotImplementedError.
 * KR 어댑터들이 비-KR 호출을 받았을 때 이 가드로 스텁 경계를 표시한다.
 */
export function assertSupportedAssetClass(
  assetClass: AssetClass,
  context?: string,
): void {
  if (!isAssetClassImplemented(assetClass)) {
    throw new AssetClassNotImplementedError(assetClass, context);
  }
}

/** KR 주식 식별자 헬퍼(현행 종목코드 → AssetIdentifier 가산 변환). */
export function krStock(corpCode: string, displayTicker?: string): AssetIdentifier {
  return {
    assetClass: AssetClass.KR_STOCK,
    primaryId: corpCode,
    displayTicker: displayTicker ?? corpCode,
    currency: 'KRW',
  };
}
