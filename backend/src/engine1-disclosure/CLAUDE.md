# Engine 1 — Disclosure Intelligence (공시 수집·파싱·이벤트추출)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/cc-engine-architecture.md` · 로드맵: `docs/roadmap/01-execution-roadmap.md`(M0~M2)
> 이 폴더는 **공시 인텔리전스 도메인**(Bounded Context)이다. 작업 시 이 컨텍스트만 들고 격리 작업한다.

## 책임 (모듈 지도)

| 하위 영역 | 현재 모듈 | 책임 |
|---|---|---|
| DART 클라이언트 | `dart-api/` | DART OpenAPI 호출 + **일일 쿼터 가드 3단 분할(DAR-445 → 2026-07 라이브 파싱 기아 후속)**: 예산 19,000콜 = 라이브 목록수집 예약 2,000 + 라이브(비백필) 문서 fetch 예약 3,000 + 벌크 상한 14,000. `downloadDocument(rcpNo, { priority: 'live'\|'bulk' })` — 벌크(백필 문서·지분·재무)는 14,000에서, 라이브 문서는 17,000에서 사전 차단. 야간 벌크가 라이브 수집·파싱 둘 다 굶기지 못함 |
| 수집(collection) | `scheduler/` | DART 폴링(평일 08~18시 10분 간격, KST)·중복락·재시도, 투자이벤트 5종 1차 게이트(보고서명 정규식), 과거 연속 백필(continuous-backfill, 알림 스킵), `DisclosureCollectionLog` |
| 원문 파싱(parsing) | `disclosure-documents/` | rcpNo 원문 fetch, HTML/XML/표 추출(`parsers/`), 정정공시 감지·diff(`mappers/`), 파싱 재시도 claim 스케줄러, 정형 사실 추출(`facts/` → `DartFiledFact`), rawText 스토리지 오프로드(`storage/`), `DisclosureDocument` |
| 이벤트 추출(event-extraction) | `disclosure-events/` | report_nm/본문→eventType 분류(event-classifier) + **수치 추출기 13종**(`extractors/`: 공급계약·자사주·배당·유증·CB/BW·실적·소송·감사의견·거래정지·상폐위험·최대주주변경·5%보유·계약해지), trade-relevance 판정, 실패 이벤트 복구 스케줄러, `DisclosureEvent` |
| 재무(financials) | `financials/` | DART 재무제표 수집(전종목 벌크·실적시즌·정기보고서 EVENT 크론) + 조회 서비스 — Persona/BuyScore가 DB 경유로 읽는 진입점 (`CompanyFinancial`·`FinancialCollectionLog`, DAR-52/55) |
| 지분변동(insider) | `insider-holdings/` | 임원·주요주주 소유보고 + 5% 대량보유 수집 → `InsiderHoldingChange`, INSIDER_BUY/SELL·MAJOR_HOLDER_5PCT 이벤트 (DAR-87/88) |
| 파이프라인 무결성 | `pipeline/` | 수집→파싱→이벤트→AI 폐루프 무결성 점검·드레인(체이닝 누락 회수), 이벤트 백필(rcpDt 시간순), rawText/tables **S3 오프로드**(DB 경량화) — DAR-126/391/395/399 |
| 조회 | `disclosures/` | `GET /disclosures` 등 HTTP 조회, 공시 7유형 분류 상수, 검색 유틸 |

> SSOT의 목표 구조는 `collection/`·`parsing/`·`event-extraction/` 하위 폴더 + `DisclosureIntelligenceModule` 집약이다.
> 현재는 기능 모듈을 도메인 폴더로 **물리 통합**한 형태로 운용 중이며, 하위 폴더 재명명·집약 모듈은 후속(선택).

## 소유 모델 (자연키)

`Disclosure`(rcpNo PK) · `DisclosureDocument`(rcpNo) · `DartFiledFact` · `DisclosureEvent`(rcpNo FK) · `DisclosureCollectionLog` · `InsiderHoldingChange` · `CompanyFinancial` · `FinancialCollectionLog`.
모든 신규 모델은 `rcpNo`(공시) 또는 `corpCode`(기업)로 연결. 마이그레이션은 `backend/prisma/CLAUDE.md` 준수.

## AI 정책 (이 엔진은 거의 전부 L0 = Rule 기반)

- 공시 수집·저장: **AI 금지**(L0).
- 이벤트 타입 **1차 분류: 정규식·키워드(L0)**. 모호한 공시만 타입 보정에 L1 보조 허용.
- 원문 전문을 AI에 통째로 넘기지 않는다 — 파싱 산출물에서 핵심 수치·텍스트만 추출(Engine2 입력 최소화 계약).

## 마일스톤 상태 & 하류 연결

- **M0 수집 안정화 ✅ / M1 원문 파싱 ✅ / M2 이벤트·수치 추출 ✅** — 라이브 운용 중(OCI prod).
- 하류 연결 **가동 중**: 이벤트 추출 완료 시 `event.extracted` 잡을 `AI_ANALYZE` 큐로 발행 → Engine2(AI Analyst, M3 ✅)가 소비. 재시도·DLQ 정책은 `common/queues/queue.constants.ts`(DAR-89).
- 회귀 게이트(매 작업): 수집 성공률 ≥95% · 중복 저장 0 · 이벤트 분류 정확도 ≥90% · 수치 추출 ≥85% · 파싱→추출 체이닝 누락은 `pipeline/` 드레인이 회수하는지 점검.

## DoD

`npx tsc --noEmit` 0 · `npm test` 그린(M1·M2 extractor 스펙 포함) · 자연키 FK 정합 · 문서 동기화.

---
*최종 수정: 2026-07-15*
