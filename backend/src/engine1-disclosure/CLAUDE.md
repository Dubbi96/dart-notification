# Engine 1 — Disclosure Intelligence (공시 수집·파싱·이벤트추출)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/cc-engine-architecture.md` · 로드맵: `docs/roadmap/01-execution-roadmap.md`(M0~M2)
> 이 폴더는 **공시 인텔리전스 도메인**(Bounded Context)이다. 작업 시 이 컨텍스트만 들고 격리 작업한다.

## 책임 (3단 파이프라인)

| 하위 영역 | 현재 모듈 | 책임 |
|---|---|---|
| 수집(collection) | `scheduler/` + `dart-api/` | DART 폴링·중복락·재시도, 공시 7→5종 게이트, `DisclosureCollectionLog` |
| 원문 파싱(parsing) | `disclosure-documents/` | rcpNo 원문 fetch, HTML/XML/표 추출, 정정공시 diff, `DisclosureDocument` |
| 이벤트 추출(event-extraction) | `disclosure-events/` | report_nm/본문→eventType, 수치 추출(extractors), `DisclosureEvent` |
| 조회 | `disclosures/` | `GET /disclosures` 등 HTTP 조회 |

> SSOT의 목표 구조는 `collection/`·`parsing/`·`event-extraction/` 하위 폴더 + `DisclosureIntelligenceModule` 집약이다.
> 현재는 기존 모듈을 도메인 폴더로 **물리 통합**한 단계이며, 하위 폴더 재명명·집약 모듈은 후속 작업(점진적).

## 소유 모델 (자연키)

`Disclosure`(rcpNo PK) · `DisclosureDocument`(rcpNo) · `DisclosureEvent`(rcpNo FK) · `DisclosureCollectionLog`.
모든 신규 모델은 `rcpNo`로 `Disclosure`에 연결. 마이그레이션은 `backend/prisma/CLAUDE.md` 준수.

## AI 정책 (이 엔진은 거의 전부 L0 = Rule 기반)

- 공시 수집·저장: **AI 금지**(L0).
- 이벤트 타입 **1차 분류: 정규식·키워드(L0)**. 모호한 공시만 타입 보정에 L1 보조 허용.
- 원문 전문을 AI에 통째로 넘기지 않는다 — 파싱 산출물에서 핵심 수치·텍스트만 추출(Engine2 입력 최소화 계약).

## 마일스톤 상태 & 다음 핸드오프

- **M0 수집 안정화 ✅ / M1 원문 파싱 ✅ / M2 이벤트·수치 추출 ✅**
- 다음: 이벤트 추출 결과를 **`event.extracted` 큐**로 Engine2(AI Analyst, M3)에 넘긴다.
- 회귀 게이트(매 작업): 수집 성공률 ≥95% · 중복 저장 0 · 5종 분류 정확도 ≥90% · 수치 추출 ≥85% · 표 누락→추출실패 전파율 점검.

## DoD

`npx tsc --noEmit` 0 · `npm test` 그린(M1·M2 extractor 스펙 포함) · 자연키 FK 정합 · 문서 동기화.
