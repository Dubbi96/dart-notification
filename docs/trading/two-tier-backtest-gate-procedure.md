# 2단 프레임 신규 2트랙 백테스트 엣지 게이트 — 실행 절차 (DAR-493 [견고화 W1·P16])

> 신규 2트랙(코어 듀얼모멘텀 §9.2 · 위성 변동성 돌파 §9.1)의 **forward 활성 선행 조건**.
> 코드(계산·리포트)는 P16 범위이고, **게이트 판정·활성 결정은 통합자·사용자 소관**이다(do-no-harm).
> 정본 룰: `docs/trading/strategy-rulebook.md §9.3`.

## 요약

비용 반영 백테스트에서 두 트랙의 **엣지가 양수**(`totalReturn > 0 && > 벤치마크`)임을 확인하기 전에는
forward 트랙(P13 코어 배선 · P15 위성 배선)을 활성화하지 않는다. RSI 엣지 없음 기각 전례를 존중한다.

## 선행 조건 (환경)

- 로컬 dev DB(PostgreSQL/TimescaleDB) 가동 + KIS API 키(`.env`).
- ETF 일봉 이력(`EtfDailyPrice`)이 3년 목표 구간으로 백필되어 있어야 한다. **360750(TIGER 미국S&P500)은 2020-08 상장** — 그 이전 구간은 없다(리포트가 note 로 고지).
- dev DB 미가동/미백필이면 서비스는 **커버리지만 반환**(report=null)하고 실행은 통합자가 수행한다.

## 절차

1. **백필** (P11 수동 러너):
   ```bash
   # ETF 유니버스 4종(360750/069500/153130/273130) 일봉 백필
   # (러너/엔드포인트는 DAR-490 P11 참조: POST /api/.../backfill/etf-daily)
   ```
2. **커버리지 확인**:
   ```bash
   # GET /api/.../coverage 또는 아래 게이트 러너의 coverage 필드 확인
   ```
3. **게이트 백테스트 실행** — 둘 중 하나:
   - 수동 스크립트:
     ```bash
     npx ts-node -r dotenv/config \
       src/engine3-quant-market/two-tier-backtest/two-tier-backtest.manual.ts \
       [startDate:YYYYMMDD] [endDate:YYYYMMDD]
     ```
   - JWT API(무거운 계산):
     ```
     POST /api/paper-trading/backtest/two-tier-gate
     { "startDate": "20200801", "endDate": "20260703", "initialCapital": 10000000 }
     ```
4. **게이트 리포트 해석**:
   - 트랙별: `totalReturnPct` · `winRatePct` · `profitFactor` · `mddPct` · `totalTrades`/`sampleCount`.
   - `edgePositive` = 비용 반영 후 `totalReturn > 0 && > 벤치마크(KODEX200 매수후보유)`.
   - `verdict` = `EDGE_POSITIVE` | `NO_EDGE` | `LOW_SAMPLE`.
   - `overallEdgePositive` = 두 트랙 모두 양수(보수적).
   - **코어는 월단위 관측 ≈12회/년 → 통계 검증력 낮음**(문헌 엣지 참조 불가피 — 정직 표기).
5. **기록·결정**: 리포트를 리뷰 산출물로 기록한다. 활성 여부는 통합자·사용자가 결정한다.
   **불합격(NO_EDGE/LOW_SAMPLE) 시 파라미터 튜닝은 룰북 §8 변경 절차로만**(문서 개정→재검증→사람 승인). **AI 자동 파라미터 조정 금지**(§8.4).

## 비용 모델

| 자산클래스 | 수수료 | 거래세 | 슬리피지 | 비고 |
|---|---|---|---|---|
| 개별주(STOCK) | 0.015% | **0.18%** | 0.3% | 기존 4전략 백테스트 — 무변경 |
| ETF | 0.015% | **0%(면제)** | 0.3% | 신규 2트랙 |

코드: `two-tier-backtest/etf-cost-profile.ts`. 개별주 프로파일은 `DEFAULT_REPLAY_COSTS` 와 동일함을 스펙이 회귀 고정한다.

## 체결·룩어헤드 규약

- 코어: 월말 마지막 거래일 판정(asOf 절단, P09 `lastTradingDayOfMonth`) → **익일 시가** 집행(매도→매수 순서).
- 위성: 당일 고가 ≥ 목표가(장중 터치 근사) 진입 → **익일 시가** 청산. 변동성 조절 사이징.
- 자산곡선은 종가 마크투마켓. 미청산 최종 포지션은 마크만(청산 비용 미반영).

## 안전 경계

- **측정 트랙 무접촉**: `BacktestRun`/`PaperTrade` 영속 0. 이 게이트는 휘발 리포트다.
- **상시 크론 아님**: 수동/JWT 트리거 전용.
- **AI 개입 0**: 전 판정이 P12/P14 순수 수식.
