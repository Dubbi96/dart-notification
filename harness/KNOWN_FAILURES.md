# 알려진 실패·함정

반복 실패를 구조화해 재발 방지. 새 실패 발견 시 항목 추가.

## 양식
| 증상 | 근본 원인 | 재발 방지 | 출처 |
|------|-----------|-----------|------|

## 초기 항목 (프로젝트 특성 기반, 확인 후 갱신)
| 증상 | 근본 원인 | 재발 방지 | 출처 |
|------|-----------|-----------|------|
| DART API 호출 실패/누락 | 레이트리밋 초과 | 호출 간 지연·재시도 큐 | - |
| 공시 파싱 깨짐 | 응답 구조 엣지케이스 | 파서에 케이스별 테스트 동반 | - |
| 동시 작업 머지 충돌 | 파일 경계 겹침 위임 | Orchestrator 비겹침 분배 | - |
| 스키마 변경 충돌 | Prisma 동시 변경 | 마이그레이션 직렬화 | - |
| 의도치 않은 자율 실행 | 이슈를 에이전트에 **할당하면 wakeOnDemand가 자동 트리거**되어 즉시 작업 시작 | 백로그만 쌓을 땐 미할당(assigneeAgentId 생략)으로 생성하거나, 등록 전 에이전트 pause | DAR 핸드오프 2026-06-04 |
| 선행조건 미충족 작업 착수 | 에이전트가 환경(DB/Redis/LLM키) 없는 이슈를 자율로 시작해 미완 WIP 발생 | 이슈 제목/본문에 BLOCKED 명시 + 선행조건 충족 전엔 미할당, 환경 준비 후 할당·깨움 | DAR-4/DAR-5 WIP |
| '크론 부재' 오진단 | cron 이 도메인 로그(*CollectionLog)에만 기록되고 CronRunLog 잡 목록엔 없어, 목록만 보면 '없는 것'처럼 보임(실제로는 존재·정상). 정체 원인은 cron 미가동(런타임)일 수 있음 | 진단 시 코드(@Cron 존재)·도메인 로그·데이터 소스(KRX/KIS 실프로브)를 분리 확인. cron 헬스는 CronRunLog 로 first-class 노출(분봉과 대칭) | DAR-428 |
| 배당 유형 HYBRID 미분류 (known-gap) | `engine1-disclosure/disclosure-events/extractors/dividend.ts`의 `inferDividendType`이 현금·주식 동시 배당에서도 'HYBRID'를 반환하지 못하는 분기 구조 (M2 QA MINOR-3, 미수정 잔존) | 배당 이벤트 HYBRID 케이스 테스트 추가 후 분기 수정. 원 기록: docs/archive/work/m2/qa-report.md | M2 QA 2026-06-03 |
| 날짜 하드코딩 시한부 테스트 | `engine2-ai-analyst/usage-log/ai-usage-log.service.spec.ts`(DAR-241 describe)가 집계 윈도우를 2026-06-01~06-30으로 하드코딩 → 2026-07부터 자동 실패 2건(코드 회귀 아님) | 스펙을 현재 시각 기준 상대 윈도우 또는 jest fake timer로 고정. 신규 테스트에 절대 날짜 하드코딩 금지 | 재개 감사 2026-07-02 |
