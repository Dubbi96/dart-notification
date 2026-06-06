> 상위 문서: [비전](./00-vision-and-principles.md) · [실행 로드맵](./01-execution-roadmap.md) · 작성: Agent Team

# 횡단 설계: 다자산 확장 로드맵 (국내 → 미국 → 코인)

> 작성일: 2026-06-06 · 상태: 설계 방향 초안 (M10 국내 MVP 졸업 후 착수)

---

## 1. 목적 & 범위

### 목적

국내 주식(KR_STOCK)에서 검증된 5엔진 분석·모의투자 파이프라인을 **미국 주식(US_STOCK)** 과 **암호화폐(CRYPTO)** 로 단계적으로 확장한다. 각 자산군은 데이터 소스·시장 구조·세금·리스크가 다르므로, **공통 도메인 추상화**를 먼저 정의한 뒤 자산별 어댑터를 교체하는 방식으로 구현한다.

### 포함

- 자산군별 진입 기준 및 단계 정의
- 자산군별 시장 특성·데이터 소스 비교
- 5엔진 재사용 vs 신규 설계 경계
- 공통 추상화 제안 (assetClass, 가격/캘린더 포트 분리)

### 제외

- 구체적인 API 코드 구현 (Phase 문서 담당)
- 증권사·거래소 API 구체 연동 명세 (별도 Phase 문서)
- 실자동매매 설계 (M12 제한적 자동매매 이후)

---

## 2. 자산군 단계 정의

### 진입 전제

**다자산 확장은 국내 M10 MVP 졸업(모의투자 실비용 검증 통과) 이후에만 착수한다.**
국내 파이프라인이 완성되기 전 다자산 추가는 기술 부채만 쌓는다.

### 단계 구조

```
① KR_STOCK (현행, M0~M12)
    국내 주식 5종 이벤트 공시 분석·모의투자·제한적 자동매매
    → 졸업 기준: M10 통과 (모의투자 실비용 검증)

② US_STOCK (M13A, 예정)
    미국 주식 공시·실적·이벤트 분석·모의투자
    → 진입 기준: M10 졸업 + KR 자동매매 안정 운영 3개월 이상

③ CRYPTO (M13B, 예정)
    BTC·ETH·주요 알트코인 24/7 분석·모의투자
    → 진입 기준: US_STOCK 모의투자 90일 검증 완료 후
```

---

## 3. 자산군별 시장 특성 비교

| 항목 | KR_STOCK (국내) | US_STOCK (미국) | CRYPTO (코인) |
|------|--------------|--------------|------------|
| **거래 시간** | 09:00~15:30 (KST) | 09:30~16:00 (ET) / 프리·애프터마켓 | 24/7 무휴 |
| **가격 제한** | ±30% 상하한가 | 없음 (서킷브레이커만) | 없음 |
| **공시 소스** | DART OpenAPI | SEC EDGAR / 기업 IR | 없음 (온체인 데이터·프로젝트 발표) |
| **이벤트 드라이버** | 공시 이벤트 5종 | 실적(EPS/Revenue), 가이던스, FDA, M&A | 온체인 이벤트, 규제, 기관 동향, 해킹 |
| **환율** | KRW 고정 | USD → KRW 환산 필요 | USD 기준 (USDT 쌍) |
| **세금** | 증권거래세 0.18% + 양도세(대주주만) | 양도소득세 (단기/장기 구분) + 주정부세 | 가상자산 양도소득세 (2025+ 시행) |
| **최소 거래 단위** | 1주 | 0.001주 (소수 주문 지원) | 소수점 단위 |
| **유동성 리스크** | 관리종목·거래정지 | 나스닥/NYSE 상장폐지 위험 | 거래소 해킹·유동성 위기·상폐 |

---

## 4. 데이터 소스 후보

### 4-1. US_STOCK 데이터 소스

| 항목 | 1차 후보 | 2차 후보 | 비고 |
|------|---------|---------|------|
| **일봉·분봉 시세** | Polygon.io (Free: 15분지연, Paid: 실시간) | Alpha Vantage (5 req/min free tier) | KRX 역할. REST + WebSocket |
| **실시간 현재가** | Polygon.io WebSocket | IEX Cloud | 증권사 API 역할 |
| **실적·가이던스 이벤트** | SEC EDGAR (무료) | Financial Modeling Prep (FMP) | DART 역할. 10-Q/10-K/8-K |
| **경제 캘린더** | Trading Economics API | Intrinio | 연준 FOMC·고용·CPI 일정 |
| **환율** | ExchangeRate-API (무료) | Open Exchange Rates | KRW/USD 일봉 |
| **기업 기본 정보** | SEC CIK → Ticker 매핑 | Polygon.io Tickers | DART `Company` 역할 |

### 4-2. CRYPTO 데이터 소스

| 항목 | 1차 후보 | 2차 후보 | 비고 |
|------|---------|---------|------|
| **가격 (BTC/ETH/알트)** | Binance REST + WebSocket | Upbit API (KRW 마켓) | 24/7, 분봉·일봉 |
| **온체인 데이터** | Glassnode (유료) | Dune Analytics (쿼리 기반) | 해시레이트·고래 이동·거래소 유입 |
| **공시·이벤트** | CoinMarketCal (이벤트 캘린더) | 공식 팀 블로그 RSS | 업그레이드·락업 해제·에어드랍 |
| **규제 뉴스** | CryptoPanic (뉴스 집계) | TheBlock, Decrypt RSS | AI 분류 필요 |
| **Fear & Greed Index** | Alternative.me API (무료) | — | 시장 심리 지표 |

---

## 5. 5엔진 재사용 vs 신규 설계

### 5-1. 재사용 가능 (자산 추상화 후)

| 엔진 | 재사용 전략 |
|------|-----------|
| **Engine 1 — Disclosure** | 수집 Scheduler/Parser 인터페이스 유지, SEC EDGAR·CoinMarketCal 어댑터 추가 |
| **Engine 2 — AI Analyst** | 4개 AI Task 구조 재사용, 미국·코인 공시 프롬프트만 교체 |
| **Engine 3 — Quant Market** | Buy Score 공식 재사용, 시세 수집 어댑터(Polygon·Binance)·캘린더(US/24h) 교체 |
| **Engine 4 — Portfolio Exit** | Portfolio/Position/ExitSignal 모델 재사용, 통화(`currency`) 필드 추가로 다통화 지원 |
| **Engine 5 — Trading Risk** | Risk 하드룰 재사용, 자산군별 한도 파라미터 분리 |

### 5-2. 신규 설계 필요

| 항목 | 이유 |
|------|------|
| **환율 변환 레이어** | US_STOCK/CRYPTO의 USD 기준 가격을 KRW 평가손익과 연결 |
| **24/7 수집 Scheduler** | CRYPTO는 장 마감 개념 없음. Cron 기반 → 이벤트 구독(WebSocket) 전환 필요 |
| **거래 캘린더 어댑터** | KR: KRX 공휴일 / US: NYSE 공휴일 / CRYPTO: 없음 |
| **자산별 세금 계산기** | 한국 증권거래세 / 미국 양도세(단기·장기 구분) / 가상자산세 별도 로직 |
| **CRYPTO 리스크 파라미터** | 변동성이 KR/US 대비 5~10배 → 포지션 한도, 손절 기준 별도 설정 |

---

## 6. 공통 추상화 제안

### 6-1. assetClass 도메인 확장

```typescript
enum AssetClass {
  KR_STOCK   = 'KR_STOCK',   // 국내 주식 (현행)
  US_STOCK   = 'US_STOCK',   // 미국 주식 (M13A 예정)
  CRYPTO     = 'CRYPTO',     // 암호화폐 (M13B 예정)
}
```

기존 `Company.corpCode` (DART 기준) → `Asset` 도메인으로 일반화:

```typescript
// 자산 공통 식별자 제안 (KR_STOCK: corpCode, US_STOCK: ticker+exchange, CRYPTO: symbol+quote)
interface AssetIdentifier {
  assetClass: AssetClass;
  primaryId: string;   // KR: corpCode / US: 'AAPL:NASDAQ' / CRYPTO: 'BTC:USDT'
  displayTicker: string;
  currency: 'KRW' | 'USD' | 'USDT';
}
```

### 6-2. 가격·캘린더 포트 분리 (헥사고날 확장)

```typescript
// Engine 3 포트: 자산군에 무관한 인터페이스
interface IPriceDataPort {
  getDailyPrices(assetId: AssetIdentifier, from: string, to: string): Promise<DailyPrice[]>;
  getCurrentPrice(assetId: AssetIdentifier): Promise<number>;
}

interface IMarketCalendarPort {
  isTradingDay(assetClass: AssetClass, date: string): boolean;
  getNextTradingDay(assetClass: AssetClass, date: string): string;
}

// 어댑터 구현체 (자산군별)
class KrxPriceAdapter implements IPriceDataPort { ... }    // 현행
class PolygonPriceAdapter implements IPriceDataPort { ... } // US_STOCK (M13A)
class BinancePriceAdapter implements IPriceDataPort { ... } // CRYPTO (M13B)
```

---

## 7. 단계별 착수 기준 (진입 게이트)

### M13A — US_STOCK 확장 (예정)

**진입 조건** (모두 충족 필요):
- [ ] 국내 M10 MVP 졸업 (모의투자 실비용 검증 완료)
- [ ] 국내 제한적 자동매매(M12) 안정 운영 3개월
- [ ] Polygon.io 또는 Alpha Vantage API 키 확보 및 데이터 품질 검증
- [ ] SEC EDGAR 실적 이벤트 파이프라인 PoC 완료

**초기 분석 대상**: S&P 500 편입 + 애플·MS·알파벳·테슬라·NVIDIA 등 유동성 충분 대형주 30개
**초기 이벤트**: 분기 실적 발표(EPS/Revenue 서프라이즈) / FDA 신약 승인 / M&A 발표

### M13B — CRYPTO 확장 (예정)

**진입 조건** (모두 충족 필요):
- [ ] US_STOCK 모의투자 90일 실비용 검증 완료
- [ ] Binance API 연동 및 24/7 수집 안정성 PoC
- [ ] CRYPTO 변동성 대응 리스크 파라미터 설계 완료
- [ ] 가상자산 세금 계산 로직 검토 완료

**초기 대상**: BTC·ETH·BNB (시가총액 상위 3개, KRW 마켓)
**초기 이벤트**: 반감기 / 업그레이드 / 대형 프로젝트 상장·상폐 / 규제 발표

---

## 8. 리스크 & 고려사항

| 리스크 | 대응 |
|--------|------|
| 미국 API 비용 | Polygon free tier(15분 지연)로 시작, 모의투자 단계에서는 지연 데이터로 충분 |
| 환율 변동 손익 왜곡 | 기준환율(일봉 종가)로 고정, 실수익은 KRW 환산 기준으로 통일 |
| CRYPTO 변동성 | 단일 포지션 한도 KR/US 대비 1/3 수준으로 제한, Kill Switch 즉시 발동 조건 강화 |
| 24/7 운영 부하 | CRYPTO 단계에서 별도 `crypto-worker` ECS 서비스 분리 검토 |
| 세금 미신고 리스크 | 각 자산군 세금 계산기는 법무 자문 후 확정, 자동신고 기능은 미포함 |

---

## 9. 관련 문서 링크

- [5엔진 아키텍처](./cc-engine-architecture.md) — Engine3 가격 포트 추상화 위치
- [실행 로드맵](./01-execution-roadmap.md) — M13A/M13B 마일스톤 연결
- [비전](./00-vision-and-principles.md) — 3대 설계 원칙 (자동매매 마지막 원칙)
- [Persona 철학 엔진](./cc-persona-philosophy-engine.md) — 미국·코인에도 동일 Persona 적용
