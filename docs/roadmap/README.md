# 확장 로드맵 문서 (공시 알림 → 투자판단·포트폴리오·자동매매)

이 디렉터리는 현재 **공시 알림 MVP**를 **공시 기반 투자판단·포트폴리오 추적·(제한적) 자동매매 시스템**으로 확장하기 위한 설계 문서 모음이다.

## 읽는 순서

1. [00 · 시스템 비전 및 설계 원칙](./00-vision-and-principles.md) — **먼저 읽을 것 (SSOT)**
2. [01 · 실행 로드맵 (개발 순서 + 회귀 체크포인트)](./01-execution-roadmap.md) — **개발 착수 시 정본**
3. **[cc-resume-plan-2026-07-02](./cc-resume-plan-2026-07-02.md) — 현재 위치·재개 계획 정본 (M0~M12 상태 매트릭스 포함)**
4. 횡단 설계 문서 (Cross-cutting)
5. Phase별 상세 준비 문서 (0~14)

## 현행 운영·판정 문서 (세션 산출 정본)

| 문서 | 내용 |
|------|------|
| [cc-resume-plan-2026-07-02](./cc-resume-plan-2026-07-02.md) | **재개 계획 + M0~M12 상태 매트릭스 + 문서/브랜치 위생 감사 결과** |
| [cc-pause-handoff-2026-06-28](./cc-pause-handoff-2026-06-28.md) | 일시중단 복원 런북 (DB 복원·서비스 재기동) |
| [cc-ux-review-2026-07-02](./cc-ux-review-2026-07-02.md) | **UI/UX 정밀 리뷰 — 현행 UX 백로그 정본** (확정 76건, UXR-1~ 이슈 분해) |
| [cc-ui-ux-audit-2026-06-27](./cc-ui-ux-audit-2026-06-27.md) | UI/UX 전수 감사 — 24건 처리 완료(W1·W5·W7 잔여는 위 리뷰로 이관) |
| [cc-trading-fix-roadmap-2026-06-26](./cc-trading-fix-roadmap-2026-06-26.md) | 트레이딩 결함 13건 수정 기록 (전부 v0.1.1 배포됨) |
| [buy-logic-validation-baseline](./buy-logic-validation-baseline.md) | 매수논리 재검증 프로토콜 (baseline -14.5%) |
| [rsi-strategy-backtest-2026-06-26](./rsi-strategy-backtest-2026-06-26.md) | RSI 단독전략 엣지 없음 → 제품화 보류 근거 |
| [cc-multi-asset-expansion](./cc-multi-asset-expansion.md) | 다자산 확장 설계 (M12 이후, 미착수) |
| [cc-persona-philosophy-engine](./cc-persona-philosophy-engine.md) | Persona·투자철학 엔진 설계 |

> 완료·대체된 세션 문서(구 핸드오프, 패널 백로그, M10 졸업 스냅샷 등)는 [docs/archive/](../archive/README.md)로 이동됨(2026-07-02).

> **데이터 소스 정책:** 시세·통계 기준 데이터는 **KRX 데이터마켓플레이스(공기업)** 가 1차 소스다. 실시간 현재가/분봉 및 주문 체결만 증권사 OpenAPI(KIS 등)로 보완한다. (개별 문서에 남은 'KIS' 언급 중 *일봉/통계*는 KRX로 읽을 것)

---

## 횡단 설계 문서

| 문서 | 내용 |
|------|------|
| [cc-engine-architecture](./cc-engine-architecture.md) | 5개 엔진 아키텍처, 모듈 경계, 데이터 흐름, AI 배치 |
| [cc-data-model](./cc-data-model.md) | 전체 DB 확장 설계 (모델·관계·인덱스·마이그레이션 전략) |
| [cc-mvp-definition](./cc-mvp-definition.md) | 현실적 MVP 정의, 검증 질문, 완료 기준 |

## Phase별 상세 준비 문서

| Phase | 문서 | 핵심 |
|-------|------|------|
| 0 | [phase-00-baseline-scope](./phase-00-baseline-scope.md) | 초기 범위 제한·기준선 |
| 1 | [phase-01-disclosure-collection](./phase-01-disclosure-collection.md) | 수집 안정화·`DisclosureCollectionLog` |
| 2 | [phase-02-document-parsing](./phase-02-document-parsing.md) | 원문 파싱·`DisclosureDocument` |
| 3 | [phase-03-event-extraction](./phase-03-event-extraction.md) | 이벤트·수치 추출·`DisclosureEvent` |
| 4 | [phase-04-ai-analyst-engine](./phase-04-ai-analyst-engine.md) | AI Analyst 4 Task |
| 5 | [phase-05-market-data](./phase-05-market-data.md) | 시세·차트·지표 결합 |
| 6 | [phase-06-buy-signal-engine](./phase-06-buy-signal-engine.md) | Buy Score·`TradingSignal` |
| 7 | [phase-07-position-thesis](./phase-07-position-thesis.md) | `PositionThesis` |
| 8 | [phase-08-portfolio-exit-engine](./phase-08-portfolio-exit-engine.md) | Exit Score·`ExitSignal` |
| 9 | [phase-09-event-study](./phase-09-event-study.md) | 과거 반응 통계·`EventStudyResult` |
| 10 | [phase-10-backtest](./phase-10-backtest.md) | 백테스트 엔진 |
| 11 | [phase-11-ai-cost-governance](./phase-11-ai-cost-governance.md) | AI 비용 통제·`AIUsageLog` |
| 12 | [phase-12-paper-trading](./phase-12-paper-trading.md) | 모의투자·`PaperTrade` |
| 13 | [phase-13-semi-auto-trading](./phase-13-semi-auto-trading.md) | 반자동매매·주문 승인 |
| 14 | [phase-14-limited-auto-trading](./phase-14-limited-auto-trading.md) | 제한적 자동매매·Risk Engine |

---

## 각 상세 문서의 공통 구조 (템플릿)

모든 Phase/횡단 문서는 다음 골격을 따른다:

1. **목적 & 범위** — 이 단계가 해결하는 문제, 포함/제외
2. **현재 코드베이스 연결점** — 지금 존재하는 무엇 위에 쌓는가 (모듈/스키마/엔드포인트)
3. **선행 조건 & 의존성** — 어떤 Phase·데이터가 먼저 필요한가
4. **상세 설계** — 데이터 모델(Prisma sketch), API 엔드포인트, 알고리즘/점수 공식, 의사코드
5. **작업 분해** — 체크리스트형 태스크
6. **AI 사용 정책** — 해당 시 Level/입출력 JSON/금지선
7. **비용·성능 고려사항**
8. **리스크 & 엣지 케이스**
9. **완료 기준 (DoD)**

> 상태: Phase별 상세 문서는 Agent Team이 병렬 작성한다. 이 인덱스의 링크가 살아있으면 해당 문서가 준비된 것이다.
