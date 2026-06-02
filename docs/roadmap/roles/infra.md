> 상위 문서: [역할 인덱스](./README.md) · [실행 로드맵](../01-execution-roadmap.md)

# 인프라·DevOps 역할 문서

> 작성일: 2026-06-02 · 상태: 기준선 확정

---

## 1. 역할 정의 & 책임 범위

### 이 파트가 소유하는 것

| 영역 | 소유 범위 |
|------|-----------|
| **AWS 인프라 (IaC)** | Terraform 코드 관리 — VPC·서브넷·ECR·ECS(Fargate)·RDS(PostgreSQL)·ALB·보안그룹·Secrets Manager |
| **컨테이너 빌드·배포** | Dockerfile·`.dockerignore` 관리, ECS 배포 파이프라인 |
| **CI/CD** | GitHub Actions 워크플로우 — 빌드·테스트·이미지 푸시·ECS 롤링 배포 |
| **큐·워커 인프라** | BullMQ/Redis 큐 인프라, 워커 프로세스(수집·분석·시세·체결) 분리 아키텍처 |
| **시계열 DB 관리** | `StockMinutePrice` 파티셔닝 정책·보존 정책, 자동 삭제 배치 환경 |
| **KRX 배치 인프라** | 시세·지수·종목상태 EOD 배치를 위한 스케줄 환경·환경변수·연결 설정 (M4) |
| **관측성** | 수집·AI·시세·체결 배치의 로그·메트릭·실패 알림(Slack webhook 등) 구성 |
| **비용 모니터링** | KRX/DART/LLM 호출량·비용 대시보드 (CloudWatch 또는 외부 APM) |
| **보안·시크릿 관리** | Secrets Manager 연동, 환경변수 주입 경로(ECS task), 평문 미커밋 규율 |
| **HTTPS·도메인** | ACM 인증서 + ALB HTTPS 리스너 전환 |
| **Kill Switch·자동중단 인프라** | Kill Switch 즉시 반영(< 5초) 위한 Redis 캐시 또는 인메모리 플래그 환경 |
| **마이그레이션 배포 규율** | `prisma migrate deploy` 재현 가능성, 마이그레이션 커밋 정합 확인 |

### 다른 파트와의 경계

- **BE(백엔드)** 가 애플리케이션 로직을 소유하고, **인프라** 는 그 로직이 실행되는 환경과 연결 설정을 소유한다.  
  예: BE가 `PriceBatchService.collectDailyPrices()` cron을 구현하면, 인프라는 그 워커가 실행될 ECS Task Definition·환경변수·Redis 엔드포인트를 책임진다.
- **DQ(데이터·Quant)** 가 `StockMinutePrice` 파티셔닝 *정책*(보존 기간·버킷 기준)을 결정하면, 인프라는 DDL 실행·RDS 파라미터·cron 삭제 배치 환경을 소유한다.
- **AI 파트** 가 `AIUsageLog` 비용 로그를 기록하면, 인프라는 그 데이터를 대시보드로 시각화하는 환경(CloudWatch Metrics 또는 Grafana)을 소유한다.
- **QA** 가 회귀 체크포인트 게이트를 운영하면, 인프라는 CI 파이프라인에서 테스트가 자동 실행되는 환경을 보장한다.

---

## 2. 마일스톤별 업무 (M0~M12)

### M0 — 기준선 & 수집 안정화 [협업 C]

M0에서 인프라는 기존 AWS 환경의 건강도 확인과 병행 트랙(CI/관측성) 초기 세팅을 담당한다.

- [ ] **현행 인프라 회귀 점검** — ECS/RDS/ALB 정상 동작 확인 (카카오 로그인·알림 파이프라인 스키마 변경 후 연결 이상 없는지)
- [ ] **마이그레이션 배포 재현성 확인** — 기존 5개 마이그레이션이 `prisma migrate deploy`로 클린 환경에서 재현 가능한지 검증
- [ ] **시크릿 관리 감사** — DART API 키·Kakao 클라이언트·JWT 시크릿이 Secrets Manager 또는 ECS task env로 안전하게 주입되는지 확인. `.env` 평문 커밋 여부 전수 점검
- [ ] **`infra/.gitignore` 확인** — `tfplan`(시크릿 포함 가능) 제외 규칙 확인, `tfstate`가 S3 백엔드에만 존재하는지 확인
- [ ] **GitHub Actions CI 뼈대 구성** — PR 빌드 체크, `npm test` (현재 테스트 없으나 빈 파이프라인 등록), ECS 배포 워크플로우 draft
- [ ] **CollectionLog 로그·알림 기반 구성** — 수집 실패 시 Slack/알림 webhook 연결 준비 (BE가 `DisclosureCollectionLog`를 완성하면 즉시 연결 가능한 구조)
- [ ] **확인할 점:** `Company.market` KOSPI/KOSDAQ 미완 상태가 M4 KRX 배치에 필요한 시드 보완 작업의 선행 조건임을 BE와 조율

---

### M1 — 공시 원문 파싱 [협업 C]

- [ ] **파싱 실패 재처리 큐 인프라** — BE가 BullMQ 기반 파싱 재처리 큐를 구현할 경우, Redis 인스턴스(ElastiCache 또는 ECS 사이드카) 프로비저닝·환경변수 주입
- [ ] **원문 파일 저장소** — `rawFilePath` 경로 기준으로 S3 버킷 생성 및 ECS Task에 접근 권한(IAM Role) 부여 검토
- [ ] **CI 파이프라인 확장** — M1 파서 단위 테스트가 추가되는 시점에 CI가 자동 실행되는지 확인

**받아야 할 입력:** BE로부터 BullMQ/Redis 사용 여부 결정. Redis를 사용한다면 ElastiCache 티어 선정 기준(메모리 크기)을 BE와 협의.

---

### M2 — 이벤트·수치 추출 [해당 없음 (·)]

해당 없음 (BE/DQ 산출물 대기). 인프라 관점 확인 항목:
- M2에서 추가되는 `DisclosureEvent` 마이그레이션이 CI/CD 파이프라인에서 자동 `migrate deploy`로 처리되는지 확인

---

### M3 — AI Analyst + 비용 계측 토대 [협업 C]

AI 파트(R)와 BE(R)의 산출물인 `AIUsageLog`·비용 게이트(L0~L3)가 실제로 관측 가능하도록 인프라를 준비한다.

- [ ] **LLM API 시크릿 등록** — 외부 LLM API 키를 Secrets Manager에 등록, ECS Task Definition에 환경변수(`LLM_API_KEY`) 주입 설정
- [ ] **AI 비용 모니터링 기반 구성** — `AIUsageLog` 테이블 기록을 CloudWatch Metrics 또는 외부 APM으로 집계할 수 있는 스크립트·경보 임계값 설정 (L0 비율 < 70% 또는 일 비용 한도 초과 시 알림)
- [ ] **AI 워커 프로세스 분리 검토** — AI Task 호출 워커를 별도 ECS Task(또는 별도 컨테이너)로 분리할지 BE와 협의. 분리 시 Task Definition 추가
- [ ] **비용 대시보드 초안** — CloudWatch 대시보드에 `AIUsageLog.totalCost` 집계 위젯 추가

---

### M4 — 시세·시장 데이터 (KRX) [주담당 R]

M4는 인프라가 주담당인 유일한 대규모 데이터 인프라 구축 단계다. KRX EOD 배치를 위한 환경 전체를 소유한다.

- [ ] **KRX 데이터마켓플레이스 접근 설정** — KRX API 키(`KRX_BASE_URL`, 필요 시 `KRX_API_KEY`)를 Secrets Manager 등록·ECS 환경변수 주입
- [ ] **시세 수집 워커 분리** — `price-batch.service.ts` 실행 환경을 기존 공시 수집 워커와 별도 ECS Task로 분리 (cron 충돌 방지·자원 격리)
- [ ] **`StockMinutePrice` 파티셔닝 전략 결정 & 적용** — DQ와 협의 후 PostgreSQL 파티셔닝 DDL 실행 (예: 월별 파티션). RDS 파라미터 조정
- [ ] **`StockMinutePrice` 보존 정책 배치** — 1년 초과 분봉 데이터 자동 삭제 cron 환경 구성 (ECS 스케줄 태스크 또는 Lambda)
- [ ] **`Company.market` 시드 보완** — KRX 상장 메타 데이터로 KOSPI/KOSDAQ 구분 보완 스크립트 실행 환경 제공
- [ ] **KRX 배치 cron 타임존 검증** — ECS 태스크 타임존이 KST(Asia/Seoul)로 설정됐는지 확인 (18:30 cron이 UTC 기준으로 잘못 실행되는 버그 예방)
- [ ] **백필 배치 실행 환경** — 초기 250거래일 × 500종목 백필을 ECS 원샷 태스크로 실행하는 스크립트·IAM Role 준비
- [ ] **배치 실패 알림** — 시세 수집 배치 실패(3회 재시도 소진) 시 Slack webhook 경보 발동
- [ ] **DB 용량 모니터링** — RDS 스토리지 CloudWatch 알람 설정 (StockMinutePrice 증가 추적)
- [ ] **진입 게이트 확인:** 관심 50종목 일봉 결측률 < 2%, 지표 계산 정상 확인 — DB 직접 쿼리로 검증

---

### M5 — Event Study [해당 없음 (·)]

해당 없음 (DQ 주담당). 인프라 관점 확인 항목:
- M4에서 구축한 파티셔닝/보존 정책이 Event Study 과거 데이터 접근을 방해하지 않는지(삭제 정책과 분석 기간 충돌 여부) DQ와 확인

---

### M6 — 매수 Signal Engine [해당 없음 (·)]

해당 없음 (BE/FE/DQ 주담당). 인프라 관점 확인 항목:
- `TradingSignal` 생성이 실시간 공시 이벤트에 반응해야 한다면, 이벤트 큐(BullMQ) 처리 레이턴시가 허용 범위 내인지 모니터링 확인

---

### M7 — Position Thesis [해당 없음 (·)]

해당 없음 (BE/FE 주담당). 추가 인프라 변동 없음.

---

### M8 — Portfolio & Exit Engine [해당 없음 (·)]

해당 없음 (BE/FE/DQ 주담당). 인프라 관점 확인 항목:
- 하루 3회 점검 스케줄(09:00/13:00/16:30 KST)이 ECS cron 타임존 설정상 정확히 발동하는지 확인

---

### M9 — 백테스트 [협업 C]

백테스트는 대용량 과거 데이터를 순회하는 연산 집약적 작업이다.

- [ ] **백테스트 워커 자원 계획** — `BacktestRun` 실행 시 ECS Fargate CPU/메모리 스펙 임시 상향 필요 여부 DQ와 협의 (예: vCPU 2→4, 메모리 4GB→8GB 일시 조정)
- [ ] **백테스트 실행 격리** — 백테스트 연산이 실시간 수집·AI 분석 워커를 방해하지 않도록 별도 ECS Task로 실행
- [ ] **결과 저장 용량** — `BacktestRun`/`BacktestTrade` 대량 삽입 시 RDS IOPS 제한 확인

---

### M10 — 모의투자 + 비용 거버넌스 완성 ★ MVP 졸업 게이트 [주담당 R]

M10은 실서비스 투입 전 마지막 준비 단계다. 인프라가 주담당으로서 **병행 트랙(HTTPS·비용 대시보드·관측성)을 완성**해야 M11 진입이 허가된다.

- [ ] **HTTPS 전환 (필수, 실서비스 전)** — 도메인 등록 + ACM 인증서 발급 + ALB HTTPS(443) 리스너 추가 + HTTP(80) → HTTPS 리다이렉트 설정
- [ ] **비용 대시보드 완성** — AI비용/모의순익 비율 실시간 추적 위젯 (KRX API·DART API·LLM API 비용 합산), 일/주/월 집계
- [ ] **전체 파이프라인 관측성 완성** — M0~M8 전 구간(수집→파싱→이벤트→AI→시세→Signal→Thesis→Exit) 각 배치의 성공/실패 메트릭을 단일 대시보드에서 확인 가능하도록
- [ ] **실시간 현재가 API 연동 환경** — 모의투자 체결 시뮬레이션에 필요한 KIS 실시간 현재가 API 환경변수(`KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL`) Secrets Manager 등록
- [ ] **스케일 점검** — ECS Task CPU/메모리가 전 파이프라인 동시 실행 시 충분한지 로드 테스트 수준 점검
- [ ] **누적 CI/CD 회귀 그린 확인** — M0~M10까지 추가된 단위·통합 테스트가 전부 CI에서 통과하는지 확인
- [ ] **MVP 졸업 게이트 인프라 항목 확인:**
  - [ ] HTTPS 전환 완료 (HTTP 평문 배포 0)
  - [ ] 시크릿 평문 커밋 0 확인 (git log 감사)
  - [ ] `AIUsageLog` 기록 누락 0 확인 (DB count vs AI 호출 수 대조)
  - [ ] AI 금지영역(주문승인·하드룰·한도·수량·리스크우회) 코드 개입 없음 — 인프라 레벨 설정(환경변수 등)에서도 우회 경로 없는지 확인

---

### M11 — 반자동매매 [주담당 R]

실주문 경로가 열리는 첫 단계. 인프라는 증권사 연동 시크릿 관리와 주문 경로 보안을 책임진다.

- [ ] **KIS OpenAPI 시크릿 관리** — `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL` 및 모의계좌/실계좌 구분 환경변수를 Secrets Manager에 등록, ECS Task Role로 안전하게 주입 (평문 절대 금지)
- [ ] **주문 경로 보안 강화** — `/orders/**`, `/auto-trading/**` 엔드포인트가 HTTPS에서만 접근 가능한지 ALB 리스너 규칙 확인
- [ ] **주문 워커 프로세스 분리** — 체결 워커를 별도 ECS Task로 분리하여 공시 수집·AI 분석 워커와 자원 격리
- [ ] **멱등 주문키 중복 감지 인프라** — Redis를 이용한 주문 idempotencyKey 중복 방지 캐시 설정
- [ ] **체결 감사 로그 저장 보장** — `TradingAuditLog`의 비동기 저장이 주문 전송을 블로킹하지 않으면서도 누락 없이 저장되는지 RDS 쓰기 레이턴시 확인
- [ ] **증권사 API 오류 알림** — KIS API N회 연속 오류 시 즉시 Slack 알림 + Kill Switch 자동 활성화 트리거 환경 확인 (BE가 로직 구현, 인프라는 알림 채널 연결)

---

### M12 — 제한적 자동매매 [주담당 R]

자동매매의 모든 안전장치가 인프라 레벨에서도 보장되어야 한다.

- [ ] **Kill Switch 즉시 반영 인프라** — Kill Switch 활성화 후 < 5초 내 주문 차단 반영을 위해 Redis 인메모리 플래그(캐시 키: `kill_switch:{userId}`) 설계 및 ECS Task에 Redis 접근 환경 보장
- [ ] **자동중단 조건 모니터링** — 연속 손실 N회·시장 급락(-3%)·API 오류 N회 발생 시 Kill Switch 자동 활성화가 정상 발동하는지 CloudWatch 알람으로 이중 모니터링
- [ ] **하드 리스크 룰 불변성 보장** — `RISK_HARD_RULES` 상수가 환경변수·외부 설정으로 덮어쓰기 불가한 구조인지 확인 (코드 상수이므로 인프라 설정으로 우회 불가한지 최종 확인)
- [ ] **자동매매 워커 전용 IAM Role** — 자동매매 워커가 최소 권한 원칙(Least Privilege)으로 RDS·Secrets Manager·KIS API에만 접근 가능하도록 별도 IAM Role 설정
- [ ] **롤아웃 레벨 관리 환경** — `AutoTradingConfig.rolloutLevel` 레벨 업그레이드 API가 관리자 전용으로 접근 제어되는지 ALB/API Gateway 레벨 인증 확인
- [ ] **감사 로그 불변성** — `AutoTradingAuditLog` 테이블에 대해 UPDATE/DELETE 권한을 애플리케이션 DB 사용자에서 제거 (SELECT·INSERT만 허용)

---

## 3. 다른 역할과의 인터페이스 & 핸드오프

### 인프라가 받는 것 (입력)

| 제공 파트 | 산출물 | 수신 타이밍 |
|-----------|--------|------------|
| **BE** | BullMQ/Redis 사용 여부·큐 설계 | M1 착수 전 |
| **BE** | 새 환경변수 목록 (API 키 이름 등) | 각 마일스톤 착수 전 |
| **BE** | ECS Task 메모리/CPU 요구량 변화 | M4·M9·M11 착수 전 |
| **DQ** | `StockMinutePrice` 파티셔닝·보존 정책 결정 | M4 착수 전 |
| **AI** | LLM API 키 이름, 비용 집계 방식 | M3 착수 전 |
| **QA** | CI에서 실행해야 할 테스트 명령어·환경 | M0부터 점진 |

### 인프라가 내보내는 것 (출력)

| 수신 파트 | 산출물 | 전달 타이밍 |
|-----------|--------|------------|
| **BE·DQ·AI** | Redis 엔드포인트·환경변수 주입 완료 확인 | 각 워커 배포 전 |
| **BE** | Secrets Manager 키 이름 목록 | 각 마일스톤 전 |
| **QA** | CI 파이프라인 YAML 및 테스트 실행 결과 | M0부터 점진 |
| **전 파트** | CloudWatch/Grafana 대시보드 URL (관측성) | M3 이후 |
| **전 파트** | HTTPS 엔드포인트 주소 | M10 완료 시 |

### 회귀 체크포인트(↩︎)에서 인프라가 재확인할 항목

| 마일스톤 | 재확인 항목 |
|----------|------------|
| M0 → M1 | 마이그레이션 재현성, 시크릿 평문 미커밋 |
| M3 → M4 | AI 워커 Redis 연결 정상, AI 비용 경보 임계값 적정 |
| M4 → M5 | `StockMinutePrice` 보존 정책이 Event Study 과거 기간을 삭제하지 않는지 |
| M9 → M10 | CI 전체 테스트 그린, HTTPS 전환 완료, 비용 대시보드 실측 가능 |
| M10 → M11 | KIS 시크릿 Secrets Manager 등록, 주문 경로 HTTPS 전용, 평문 미커밋 |
| M11 → M12 | Kill Switch Redis 캐시 < 5초 반영, 감사 로그 INSERT-only 권한 |

---

## 4. 산출물 목록

| 산출물 | 형태 | 마일스톤 |
|--------|------|---------|
| Terraform IaC (VPC·ECS·RDS·ALB·ECR 확장) | `.tf` 파일 | M0~M12 점진 |
| GitHub Actions CI/CD 워크플로우 | `.github/workflows/*.yml` | M0 뼈대, M10 완성 |
| ECS Task Definition 추가 (시세워커·주문워커 등) | `infra/ecs/*.json` 또는 Terraform | M4·M11 |
| ElastiCache(Redis) Terraform 모듈 | `.tf` 파일 | M1 결정 시 |
| Secrets Manager 키 등록 목록·주입 설정 | `infra/secrets/README.md` + Terraform | M3·M11 |
| `StockMinutePrice` 파티셔닝 DDL + 보존 배치 스크립트 | SQL / ECS schedule task | M4 |
| CloudWatch 대시보드 JSON (관측성·비용) | `infra/monitoring/*.json` | M3(AI비용)·M10(통합) |
| Slack webhook 알림 설정 (배치 실패·Kill Switch) | Terraform·Lambda 또는 ECS cron | M0(수집)·M11(주문) |
| HTTPS 전환 설정 (ACM+ALB 리스너) | Terraform | M10 |
| Kill Switch Redis 캐시 설계 문서 + 환경 설정 | `infra/redis/kill-switch.md` + ECS env | M12 |
| 감사 로그 INSERT-only 권한 DDL | SQL | M12 |

---

## 5. 역할 특화 표준·체크리스트

### 5-1. 시크릿 관리 규약 (전 마일스톤 절대 원칙)

- [ ] 모든 API 키·JWT 시크릿·DB 비밀번호는 **Secrets Manager 또는 ECS Task 환경변수**로만 주입. `.env` 파일은 로컬 개발 전용이며 `.gitignore`에 등록
- [ ] `git log --all -S "<민감문자열>"` 으로 평문 미커밋 정기 감사 (각 마일스톤 완료 시)
- [ ] `infra/tfplan` 은 git 추적 금지 (`infra/.gitignore` 에 등재). `terraform.tfstate`는 S3 원격 백엔드만 사용
- [ ] Secrets Manager 키 이름 컨벤션: `dart-notification/{env}/{service}-{key}` (예: `dart-notification/prod/kis-app-key`)

### 5-2. 마이그레이션 배포 규율

- [ ] 새 Prisma 모델이 추가될 때마다 `prisma migrate dev` → 마이그레이션 파일 커밋 → CI에서 `prisma migrate deploy` 자동 실행
- [ ] 마이그레이션 파일이 `backend/prisma/migrations/` 경로에 커밋되었는지 PR 리뷰 체크리스트에 포함
- [ ] 각 마일스톤 완료 시 클린 RDS 환경에서 전체 마이그레이션 재현 가능한지 확인

### 5-3. CI/CD 게이트

- [ ] PR 머지 전 조건: 빌드 성공 + 단위·통합 테스트 전부 그린 + `prisma migrate deploy` dry-run 성공
- [ ] 배포 후 ECS Health Check 통과 확인 (ALB Target Group healthy count ≥ 1)
- [ ] 테스트 없는 파일 배포는 허용하되, 핵심 경로(스케줄러·인증·주문)는 테스트 존재 여부를 PR 템플릿 체크리스트에서 확인

### 5-4. AI 금지영역 관련 인프라 원칙

인프라 설정이 3대 원칙·AI 금지영역을 우회하는 통로가 되어선 안 된다:

- **주문 승인 환경변수 금지** — `AUTO_APPROVE_ORDER=true` 같은 환경변수로 Risk Engine veto를 무력화하는 구조 금지
- **하드룰 오버라이드 금지** — `RISK_HARD_RULES`의 수치를 환경변수로 덮어쓰는 구조 금지 (코드 상수 only)
- **Kill Switch 우회 금지** — 인프라 레벨(ECS env 등)에서 Kill Switch를 강제 비활성화하는 메커니즘 금지

### 5-5. 관측성 최소 기준 (M4 이후 유지)

각 배치 워커는 아래 메트릭을 CloudWatch 또는 동등한 시스템에 기록해야 한다:

| 메트릭 | 경보 임계값 | 적용 워커 |
|--------|------------|----------|
| 배치 실패율 | 연속 3회 실패 → Slack 알림 | 수집·시세·AI |
| 처리 지연(P99) | 15분 초과 → 알림 | 수집 배치 |
| AI Cost/일 | 설정 한도 초과 → 알림 | AI 워커 |
| DB 스토리지 잔량 | 20% 이하 → 알림 | RDS |
| Kill Switch 상태 변화 | 활성화 즉시 → Slack 알림 | 자동매매 워커 |

### 5-6. 병행 트랙 관리 원칙

비전 §4 병행 트랙(테스트·CI/HTTPS/관측성/비용)은 마일스톤 종료를 기다리지 않고 상시 진행한다:

- **테스트·CI**: M0 뼈대 → 각 마일스톤 산출물 추가 시 즉시 CI에 편입
- **HTTPS·보안**: M10 완료 전 반드시 완성 (실서비스·실주문 전 필수 게이트)
- **관측성**: M0 CollectionLog → M3 AIUsageLog → M4 시세 배치 → M10 통합 대시보드 순으로 점진 확대
- **비용 모니터링**: M3 AIUsageLog 등록 시작 → M10 실측 비용 검증 완성
