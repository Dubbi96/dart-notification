# 배포 가이드

> **현행 프로덕션(2026-07-02)**: OCI Always Free **AMD 2-micro** — backend **v0.1.1 라이브**
> (`https://168.138.198.152.nip.io/api`, Caddy + nip.io + Let's Encrypt HTTPS) +
> Android APK **공시온 v1.0.0**(EAS `oci` 프로파일).
> 실배포 런북 §3.1 · 모바일 배포 §3.5 · (대안) ARM A1 §3.6.

## 1. 개발 환경 설정

### 1.1 필수 요구사항

**로컬 개발 환경**:
- Node.js 20+ (권장: 20.11.0 LTS)
- npm 10+ (Node 20 동봉 — **pnpm/yarn 사용 금지**, 설치 시 `--legacy-peer-deps` 필수)
- PostgreSQL 15+ (TimescaleDB — Docker Compose 권장)
- Git
- Docker & Docker Compose (선택)

**에디터/도구**:
- VS Code (권장 확장: Prisma, ESLint, Prettier)
- Postman 또는 Insomnia (API 테스트)
- TablePlus 또는 DBeaver (DB 관리)

**계정 필요**:
- DART Open API 키: [https://opendart.fss.or.kr](https://opendart.fss.or.kr)
- Expo 계정: [https://expo.dev](https://expo.dev)

---

### 1.2 프로젝트 클론 및 설치

```bash
# 1. 프로젝트 클론
git clone https://github.com/your-org/dart-notification.git
cd dart-notification

# 2. 백엔드 설치
cd backend
npm install --legacy-peer-deps

# 3. 모바일 설치
cd ../mobile
npm install --legacy-peer-deps
```

---

### 1.3 환경 변수 설정

#### Backend (.env)

```bash
# backend/.env
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/dart_notification?schema=public"

# JWT (각 최소 16자 — env.validation.ts 가 부팅 시 강제)
# 토큰 만료는 코드 고정: access 15m · refresh 90d (backend/src/auth/auth.service.ts,
# RefreshToken.expiresAt = 발급 + 90d). 환경변수로 만료를 바꿀 수 없다.
JWT_SECRET="your-super-secret-key-change-in-production"
JWT_REFRESH_SECRET="your-refresh-secret-key-change-in-production"

# DART API
DART_API_KEY="your-dart-api-key"
DART_API_BASE_URL="https://opendart.fss.or.kr"

# Expo Push Notification
EXPO_PUSH_ACCESS_TOKEN="your-expo-access-token"

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=60

# 객체 스토리지 (DAR-395) — 공시 원문(rawText) 오프로드
# STORAGE_DRIVER=local 이면 로컬 파일(LOCAL_STORAGE_PATH/objects)에 저장(개발/기본).
# STORAGE_DRIVER=s3 + 아래 자격증명 설정 시 S3 로 오프로드. 미설정/SDK 부재면 로컬로 graceful 폴백(비차단).
STORAGE_DRIVER=local
# OBJECT_STORAGE_LOCAL_PATH=./storage/objects   # 로컬 객체 루트(미설정 시 LOCAL_STORAGE_PATH/objects)
# AWS_REGION=ap-northeast-2
# S3_BUCKET=dart-disclosure-rawtext
# AWS_ACCESS_KEY_ID=...        # 미지정 시 IAM 역할/인스턴스 프로파일(기본 자격증명 체인) 사용
# AWS_SECRET_ACCESS_KEY=...
# S3_PREFIX=prod               # (선택) 공유 버킷 환경 분리용 prefix
# S3_ENDPOINT=                 # (선택) S3 호환 스토리지(MinIO 등) 커스텀 엔드포인트
# S3_FORCE_PATH_STYLE=false    # (선택) path-style 강제(MinIO 등)

# 저장소 계층화·로컬 최소화 (DAR-397)
# PERSIST_RAW_FILES=false      # 다운로드 원시 HTML/XML 로컬 보존(읽는 코드 없음·기본 OFF). 감사/디버그 시만 true.
# LOCAL_DB_SIZE_WARN_BYTES=5368709120   # GET /storage/health 로컬 DB 크기 경고 임계(기본 5GB)
```

> S3 활성화 시 `cd backend && npm i @aws-sdk/client-s3 --legacy-peer-deps` 로 SDK 를 설치한다.
> SDK 가 없거나 자격증명이 미설정이면 기능을 차단하지 않고 로컬 파일로 폴백한다(자격증명만 후속 주입 가능).

#### Mobile (.env)

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=http://localhost:3000/api
EXPO_PUBLIC_APP_ENV=development
```

---

### 1.4 데이터베이스 설정

#### Option 1: Docker Compose (권장)

저장소 루트의 `docker-compose.dev.yml` 을 그대로 사용한다. 구성 요약(정본은 파일 자체):

- **postgres**: `timescale/timescaledb:2.17.2-pg15` (DAR-378 — 분봉/일봉 시계열 하이퍼테이블·압축).
  `command: postgres -c shared_preload_libraries=timescaledb` 로 확장 사전적재 영구 반영(DAR-382).
  포트 `5432`, 계정 `postgres/password`, DB `dart_notification`.
- **redis**: `redis:7-alpine` (BullMQ 큐), 포트 `6379`, appendonly 영속.

```bash
# Docker Compose 실행
docker-compose -f docker-compose.dev.yml up -d
```

#### TimescaleDB 적용 절차 (DAR-378, ★휴먼 게이트)

대규모 분봉/일봉 시계열을 위해 저장 엔진을 TimescaleDB 로 운용한다. **이미지 교체·확장 활성화·
스키마 운영 반영은 사용자 적용 단계**다(에이전트 자동 적용 금지):

```bash
# 1) 이미지 교체 후 컨테이너 재생성 (기존 PG15 볼륨 호환 — 데이터 손실 0)
docker-compose -f docker-compose.dev.yml up -d

# 2) 마이그레이션 적용 (휴먼 승인 ask). CREATE EXTENSION + 하이퍼테이블/압축/연속집계/보존 정책 생성
cd backend && npx prisma migrate deploy   # 20260620000000_dar378_timescaledb_hypertables

# 3) (선택) 정책·압축률 점검
psql "$DATABASE_URL" -c "SELECT * FROM timescaledb_information.jobs WHERE hypertable_name IS NOT NULL;"
psql "$DATABASE_URL" -c "SELECT * FROM chunk_compression_stats('stock_minute_prices');"
```

- 마이그레이션은 **순수 가산**(신규 `stock_minute_prices` 하이퍼테이블 + 확장 + 정책)이라 기존
  테이블/데이터(`stock_daily_prices` 등)를 건드리지 않는다.
- 일봉(`stock_daily_prices`) 하이퍼테이블 전환은 후순위(별도 마이그레이션).
- 실측: 86,400행 적재 후 압축률 **10.7×(90.6% 절감)**, 1d 연속집계 롤업이 원본-분봉 집계와 정확 일치.

##### ★ shared_preload_libraries 사전적재 (DAR-382, 필수)

`timescaledb` 확장은 **공유 라이브러리 사전적재(preload)** 가 선행돼야 `CREATE EXTENSION` 이 성공한다.
기존 PG15 볼륨에 timescaledb 이미지를 올려도 이미지가 `postgresql.conf` 를 자동 수정하지 않으므로,
설정을 명시하지 않으면 `SHOW shared_preload_libraries` 가 빈값이고 마이그레이션이
`extension "timescaledb" must be preloaded via shared_preload_libraries` 로 실패한다.

- **로컬/Docker**: `docker-compose.dev.yml` 의 postgres 서비스에 `command: postgres -c
  shared_preload_libraries=timescaledb` 를 지정해 영구 반영했다(신규/기존 볼륨 모두 적용·재생성만으로 충분).
  과거 `ALTER SYSTEM SET shared_preload_libraries='timescaledb'` + 재시작으로 임시조치한 dev DB 도
  이제 수동 개입 없이 동일하게 적재된다.
- **운영 DB(관리형 PostgreSQL)**: 컨테이너 `command` 가 적용되지 않으므로 **반드시 동등 설정을 별도로** 한다.
  - AWS RDS/Aurora: 파라미터그룹의 `shared_preload_libraries` 에 `timescaledb` 추가 후 인스턴스 **재부팅**.
  - 셀프호스트/매니지드 공통: `postgresql.conf`(또는 `ALTER SYSTEM SET shared_preload_libraries='timescaledb'`)
    설정 후 PostgreSQL **재시작**. 일부 관리형은 TimescaleDB 확장의 사전 허용(allowlist) 활성화도 필요.
- 검증: 컨테이너/인스턴스 재생성 후
  `psql "$DATABASE_URL" -c "SHOW shared_preload_libraries;"` 출력에 `timescaledb` 포함 →
  `CREATE EXTENSION IF NOT EXISTS timescaledb;` 성공.

#### 공시 원문(rawText) S3 오프로드 운영 (DAR-395)

대용량 콜드 데이터(`disclosure_documents.rawText`, 추출 시점에만 필요)를 로컬 DB 밖 객체
스토리지로 내보내 DB 를 경량화한다. 멀티이어 공시 백필 시 원문이 수십~수백 GB 로 폭증하는
것을 막는 용량 전략이다.

- **활성화**: `.env` 에 `STORAGE_DRIVER=s3` + `AWS_REGION`/`S3_BUCKET`(+ 자격증명) 설정,
  `npm i @aws-sdk/client-s3 --legacy-peer-deps`. 미설정 시 로컬 파일 폴백(기능 비차단).
- **쓰기 경로**: 신규 파싱 완료 시점에 rawText 를 gzip 압축해 객체(`disclosure-rawtext/{rcpNo}.txt.gz`)
  로 업로드하고 DB `rawText` 컬럼은 비운다(`rawTextS3Key` 포인터만 보유). 오프로드 실패는
  graceful — rawText 를 DB 에 보존해 데이터 손실/기능 차단을 막는다.
- **읽기 경로**: AI 재추출/excerpt 조회 시 포인터로 S3 에서 lazy fetch(소량 캐시). 추출 완료분은
  거의 재조회되지 않는 콜드 데이터.
- **기존분 마이그레이션**: `RawTextOffloadScheduler`(매 10분 cron) 또는
  `POST /api/pipeline/rawtext-offload?limit=200`(JWT, 멱등)가 과거 rawText 를 점진·재개가능하게
  S3 로 이전 후 컬럼을 비운다. 진척은 `GET /api/pipeline/rawtext-offload-progress`(잔여/완료율/드라이버).
- **S3 수명주기(비용)**: 콜드 원문이므로 버킷 수명주기 규칙으로 표준 → IA(예: 30일) → Glacier(예: 90일)
  전환을 권장한다. gzip 업로드로 저장/전송 비용을 추가 절감(실측 반복 텍스트 압축률 ≈ 99%).
- **★디스크 회수(VACUUM)**: 컬럼을 NULL 로 비워도 PostgreSQL 은 죽은 튜플 공간을 OS 로 즉시
  반환하지 않는다. autovacuum 은 공간을 재사용 대상으로만 표시한다. 물리 디스크를 회수하려면
  마이그레이션이 충분히 진행된 뒤 운영 점검창에서 수동 실행한다(휴먼 게이트):
  ```bash
  # 재사용 표시(논블로킹, 권장 1차):
  psql "$DATABASE_URL" -c "VACUUM (VERBOSE, ANALYZE) disclosure_documents;"
  # OS 로 물리 회수(★테이블 ACCESS EXCLUSIVE 락 — 저트래픽 점검창에서만):
  psql "$DATABASE_URL" -c "VACUUM (FULL, VERBOSE) disclosure_documents;"
  ```

#### 공시 파싱 표(tables) S3 오프로드 운영 (DAR-399)

rawText 오프로드(위) 후에도 `disclosure_documents` 의 TOAST 진짜 bulk 는 **`tables` JSONB(실측
약 1,619MB·58k 문서)** 였다(`parsedJson` 은 5MB뿐이라 DB 유지). rawText 와 동일 메커니즘으로 `tables`
도 오프로드해 멀티이어 백필 시 로컬 DB 비대를 막는다.

- **활성화**: rawText 와 동일(`STORAGE_DRIVER`/`S3_BUCKET`/자격증명 공유). 별도 설정 불요.
- **쓰기 경로**: 신규 파싱 완료 시점에 `tables` 를 JSON 직렬화 + gzip 해 객체(`disclosure-tables/{rcpNo}.json.gz`)
  로 업로드하고 DB `tables` 컬럼은 `Prisma.DbNull`(SQL NULL)로 비운다(`tablesS3Key` 포인터만 보유).
  실패는 graceful — `tables` 를 DB 에 보존(데이터 손실/기능 차단 방지).
- **읽기 경로**: SHARE_BUYBACK 폴백 스캔(재추출) 시 `tablesS3Key` 로 S3 lazy fetch(소량 캐시). 콜드 데이터.
- **기존분 마이그레이션**: `TablesOffloadScheduler`(매 10분 cron) 또는
  `POST /api/pipeline/tables-offload?limit=200`(JWT, 멱등)가 과거 `tables` 를 점진·재개가능하게 이전 후
  컬럼을 비운다. 진척은 `GET /api/pipeline/tables-offload-progress`(잔여/완료율/드라이버).
- **디스크 회수(VACUUM)**: 위 rawText 절차와 동일(`disclosure_documents` 대상). 오프로드가 충분히 진행된
  뒤 점검창에서 `VACUUM (FULL)` 수동 실행(휴먼 게이트). 실측 투영: tables 오프로드 + VACUUM 후
  `disclosure_documents` 1772MB → 약 85MB(heap 60 + index 18 + parsedJson 5).

#### 저장소 계층화·로컬 최소화 운영 (DAR-397)

목표: **대용량은 S3, 로컬 사용 용량은 최대한 줄인다.** 멀티이어 백필로 데이터가 폭증해도
로컬 DB·디스크가 비대해지지 않도록 계층화(hot=로컬, cold=S3)하고, 회수·모니터링을 자동화한다.
모든 `/storage/*` 엔드포인트는 JWT 필수(운영/내부 전용).

- **신규 문서 rawText·tables·원본 HTML 로컬 0(이미 시행)**: 파싱 추출 시점에 rawText(DAR-395),
  tables(DAR-399), 원본 HTML(DAR-401)을 즉시 S3 로 오프로드/고정하고 DB·로컬 디스크에 누적하지
  않는다. 본 계층화 PR 은 이 개별 오프로드들을 **중복 구현하지 않으며**, 그 결과 계층화 상태를
  운영·관측·회수하는 역할만 더한다.
- **잔존 레거시 로컬 원시 파일(rawFilePath) 회수**: 원본 HTML 의 로컬 write 는 DAR-401 에서 이미
  제거되어(`storage/{rcpNo}/index.html` 신규 기록 0) 신규 누적은 없다. DAR-401 이전에 쌓인 과거
  로컬 산출물만 아래 정리 엔드포인트로 회수한다(멱등·배치).
  ```bash
  # 기존 로컬 원시 파일 삭제 + rawFilePath 컬럼 비움(멱등·배치):
  curl -XPOST -H "Authorization: Bearer $JWT" \
    "$API/storage/cleanup-local-artifacts?limit=1000"
  ```
- **용량 모니터링** — `GET /api/storage/health`(read-only):
  - `database.sizeBytes` + 용량 상위 테이블(`pg_total_relation_size` desc),
  - `rawTextOffload`(잔여/완료/완료율), `objectStorage`(드라이버·객체수·총바이트),
  - `localArtifacts.rawFilesWithPath`, `thresholds.warnings`(로컬 DB 임계 초과 경고).
  - 로컬 DB 경고 임계는 `LOCAL_DB_SIZE_WARN_BYTES`(기본 5GB)로 조정.
- **디스크 회수(VACUUM, 자동화)** — 위 수동 psql 외에 운영 엔드포인트 제공(화이트리스트 테이블만):
  ```bash
  # VACUUM (FULL, ANALYZE) + 전후 크기/회수 바이트 리포트(★ACCESS EXCLUSIVE 락·오프피크):
  curl -XPOST -H "Authorization: Bearer $JWT" \
    "$API/storage/vacuum?table=disclosure_documents&full=true"
  # 락이 부담되면 pg_repack(온라인 재작성)을 대안으로:
  #   pg_repack -d dart_notification -t disclosure_documents
  ```
- **콜드 라이프사이클(S3, 비용↓)** — rawText 객체(`disclosure-rawtext/`)는 추출 후 콜드:
  `STANDARD_IA(30일) → GLACIER(90일)` 자동 강등. 적용은 엔드포인트(idempotent) 또는 IaC:
  ```bash
  # 앱에서 적용(S3 드라이버만 실적용·로컬 no-op):
  curl -XPOST -H "Authorization: Bearer $JWT" "$API/storage/lifecycle"
  ```
  AWS CLI(IaC) 등가 — `$S3_BUCKET`/`$S3_PREFIX` 치환:
  ```bash
  aws s3api put-bucket-lifecycle-configuration --bucket "$S3_BUCKET" \
    --lifecycle-configuration '{
      "Rules": [{
        "ID": "dar397-rawtext-cold-tiering",
        "Status": "Enabled",
        "Filter": { "Prefix": "disclosure-rawtext/" },
        "Transitions": [
          { "Days": 30, "StorageClass": "STANDARD_IA" },
          { "Days": 90, "StorageClass": "GLACIER" }
        ]
      }]
    }'
  ```
  Terraform 등가(`aws_s3_bucket_lifecycle_configuration`)도 동일 prefix/전환을 사용한다.
- **일봉/분봉(이번 범위 외)**: 자주 조회되는 hot 데이터로 DB 유지(TimescaleDB 압축으로 디스크↓).
  아주 오래된 분봉 콜드분의 S3/tiered 오프로드는 향후 별도 이슈로 검토한다(이번은 원문 우선).

> **실측(2026-06-20, 라이브 DB)**: 전체 4.30GB 중 `stock_daily_prices` 2018MB·
> `disclosure_documents` 1772MB(rawText) 가 대부분. 격리 throwaway 테이블 데모에서
> 컬럼 NULL 만으로는 56.93MB→56.93MB(회수 0%), `VACUUM (FULL)` 후 56.93MB→2.83MB(**회수 95%**).
> → rawText 전량 오프로드 + VACUUM FULL 시 `disclosure_documents` 가 1.7GB→수십MB 로 수렴한다.

#### Option 2: 로컬 PostgreSQL

```bash
# PostgreSQL 설치 (macOS)
brew install postgresql@15
brew services start postgresql@15

# 데이터베이스 생성
createdb dart_notification
```

---

### 1.5 Prisma 마이그레이션 및 시드

```bash
cd backend

# 1. Prisma Client 생성
npx prisma generate

# 2. 마이그레이션 실행
npx prisma migrate dev

# 3. 기업 마스터 데이터 시드 (선택 — DART_API_KEY 필요)
npm run prisma:seed
```

**시드 스크립트** (`backend/prisma/seed.ts`): DART Open API `corpCode.xml`(ZIP)을 내려받아
XML 파싱 후 **전체 기업 마스터**를 upsert 한다(샘플 데이터가 아니라 실데이터 전량 시드 —
`.env` 의 `DART_API_KEY` 필수). 보조 시드로 `npm run seed:notifications`(알림 샘플),
`npm run seed:philosophy`(투자철학) 도 있다.

> **투자철학 자동 시드(무인)**: `InvestorPhilosophy`(버핏·린치·그린블라트·드러켄밀러 4종)은
> 앱 부팅 시 테이블이 **비어 있을 때만** `PhilosophySeederService`(엔진2)가 멱등 자동 시드한다
> (`OnModuleInit` 훅). 공개 자료 기반 참조 데이터·AI 미개입·유저 데이터 아님 → 부재 시 자가 복구가
> 올바른 동작이며, 재배포·DB 리셋에도 자동 재수복된다. count>0 이면 no-op(기존 데이터 무변경),
> 시드 실패는 graceful(부팅 무중단). 수동 `npm run seed:philosophy` 는 무조건 재적재하는 운영 경로로
> 병행 유지(동일 로직 SSOT = `philosophy-seeder.core.ts`).

---

### 1.6 백엔드 실행

```bash
cd backend

# 개발 모드 (hot reload)
npm run start:dev

# 로그 확인
# [Nest] 12345  - 2026-03-07 12:00:00     LOG [NestFactory] Starting Nest application...
# [Nest] 12345  - 2026-03-07 12:00:00     LOG [InstanceLoader] AppModule dependencies initialized
# [Nest] 12345  - 2026-03-07 12:00:00     LOG [RoutesResolver] AuthController {/api/auth}: +3ms
# [Nest] 12345  - 2026-03-07 12:00:00     LOG Application is running on: http://localhost:3000
```

**API Health Check** (`/health` 는 글로벌 `api` prefix **제외** 경로 — `main.ts` DAR-111):
```bash
curl http://localhost:3000/health        # readiness
curl http://localhost:3000/health/live   # liveness
```

---

### 1.7 모바일 앱 실행

```bash
cd mobile

# Expo 개발 서버 시작
npx expo start

# 또는 특정 플랫폼으로 바로 실행
npx expo start --ios      # iOS 시뮬레이터
npx expo start --android  # Android 에뮬레이터
```

**Expo Go 앱 설치**:
- iOS: App Store에서 "Expo Go" 설치
- Android: Google Play에서 "Expo Go" 설치

**QR 코드 스캔**:
- 카메라로 터미널에 표시된 QR 코드 스캔
- Expo Go 앱에서 프로젝트 열림

---

## 2. 스테이징 환경 배포

### 2.1 환경 변수 설정

#### Backend (Staging)

```bash
# backend/.env.staging
NODE_ENV=staging
PORT=3000

DATABASE_URL="postgresql://user:password@staging-db.example.com:5432/dart_notification"

JWT_SECRET="staging-secret-key"
JWT_REFRESH_SECRET="staging-refresh-secret-key"

DART_API_KEY="staging-dart-api-key"
EXPO_PUSH_ACCESS_TOKEN="staging-expo-access-token"
```

#### Mobile (Staging)

```bash
# mobile/.env.staging
EXPO_PUBLIC_API_URL=https://staging-api.dart-notification.com/api
EXPO_PUBLIC_APP_ENV=staging
```

---

### 2.2 Docker 빌드 및 배포

#### Backend Dockerfile (실제 `backend/Dockerfile`)

```dockerfile
# backend/Dockerfile — npm 기반 2-stage 빌드 (정본은 파일 자체)
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# ------- production -------
FROM node:20-alpine

# tzdata + TZ: 컨테이너 기본 TZ(UTC) 고정 해소(DAR-199) — 시스템 TZ도 KST 일관.
RUN apk add --no-cache openssl tzdata
ENV TZ=Asia/Seoul

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --legacy-peer-deps --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/src/main"]
```

#### docker-compose.staging.yml (예시 — 저장소 미포함)

> 아래는 스테이징을 별도 구성할 때의 **예시**다(저장소에는 이 파일이 없다). 실제 운영 배포는
> §3.1(OCI 2-micro)·§3.6(단일 VM `docker-compose.prod.yml`)을 따른다.
> postgres 이미지는 마이그레이션의 `CREATE EXTENSION timescaledb` 때문에
> `timescale/timescaledb:2.17.2-pg15` + `shared_preload_libraries=timescaledb` 를 써야 한다(§1.4).

```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: dart-notification-backend
    restart: always
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=staging
      - DATABASE_URL=${DATABASE_URL}
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - DART_API_KEY=${DART_API_KEY}
      - EXPO_PUSH_ACCESS_TOKEN=${EXPO_PUSH_ACCESS_TOKEN}
    depends_on:
      - postgres
    networks:
      - dart-network

  postgres:
    image: timescale/timescaledb:2.17.2-pg15
    container_name: dart-notification-db
    restart: always
    command: postgres -c shared_preload_libraries=timescaledb
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: dart_notification
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - dart-network

  nginx:
    image: nginx:alpine
    container_name: dart-notification-nginx
    restart: always
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
    depends_on:
      - backend
    networks:
      - dart-network

networks:
  dart-network:
    driver: bridge

volumes:
  postgres_data:
```

#### 배포 명령

```bash
# 1. .env.staging 파일 준비
cp .env.example .env.staging
# 환경 변수 수정

# 2. Docker 이미지 빌드 및 실행
docker-compose -f docker-compose.staging.yml up -d --build

# 3. 마이그레이션 실행
docker exec dart-notification-backend npx prisma migrate deploy

# 4. 로그 확인
docker logs -f dart-notification-backend
```

---

### 2.3 모바일 앱 빌드 (EAS 프로파일)

#### EAS Build 설정 (실제 `mobile/eas.json`)

실제 프로파일은 4종이다 — `staging` 프로파일은 없다. **현행 배포 프로파일은 `oci`**(§3.5 참조).

```json
// mobile/eas.json (요약 — 정본은 파일 자체)
{
  "cli": { "version": ">= 18.0.0", "appVersionSource": "local" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": {
      "env": { "EXPO_PUBLIC_API_URL": "http://dart-notification-alb-....elb.amazonaws.com/api" },
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "oci": {
      "env": { "EXPO_PUBLIC_API_URL": "https://168.138.198.152.nip.io/api" },
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "env": { "EXPO_PUBLIC_API_URL": "http://dart-notification-alb-....elb.amazonaws.com/api" },
      "android": { "buildType": "app-bundle" }
    }
  }
}
```

> ⚠️ `preview`/`production` 의 `EXPO_PUBLIC_API_URL` 은 **(구) AWS ALB 잔재**다(해당 인프라 미사용).
> 스토어 제출 전 `production` 을 현행 엔드포인트(nip.io 또는 실도메인)로 갱신해야 한다.

#### 빌드 실행

```bash
cd mobile

# 1. EAS CLI 설치 + 로그인 (EAS 프로젝트: @duvbi/dart-alert)
npm install -g eas-cli
eas login

# 2. 개발/QA 빌드 (dev-client 포함 APK)
eas build --profile development --platform android

# 3. 현행 배포 빌드는 oci 프로파일 — §3.5 참조
```

---

## 3. 프로덕션 배포

### 3.1 현행 라이브 토폴로지 — OCI Always Free AMD 2-micro (★정본)

클라우드는 **Oracle Cloud Always Free** 로 결정·운영 중이다(비용 0원, 24/7).
백엔드 **v0.1.1 이 라이브**이며 공개 엔드포인트는 `https://168.138.198.152.nip.io/api` 다.

#### 토폴로지 (2026-06-24 배포, 라이브)

| 호스트 | 역할 | 접근 |
|--------|------|------|
| **micro1** (앱) | backend(NestJS, 3000) + Redis + **Caddy**(80/443 HTTPS 종단) | 공개 IP `168.138.198.152` |
| **micro2** (DB) | PostgreSQL(TimescaleDB) | 사설 `10.0.1.151:5432` (외부 비공개 — VCN 내부만) |

- 셰이프: Always Free AMD `VM.Standard.E2.1.Micro`(1GB RAM) × 2대.
- SSH 접속: `ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152` — **키 지정 필수**
  (`-i` 없이 접속하면 `Permission denied (publickey)`). 정본: `AGENTS.md` "배포 접속 (OCI 프로덕션)".
- ★**원격 실경로 정정**: micro1 의 compose·저장소 실경로는 **`/home/ubuntu/dano`** 다
  (과거 문서의 `dart-notification` 표기는 오기 — 아래 명령 예시도 `dano` 기준).
- 2-micro 분리 운영에서는 `docker-compose.prod.yml` 의 `postgres` 서비스(단일 VM용, §3.6) 대신
  micro1 의 `backend/.env.prod` `DATABASE_URL` 이 micro2 사설 IP(`10.0.1.151:5432`)를 가리킨다.

#### HTTPS — Caddy + nip.io + Let's Encrypt (비용 0)

- micro1 호스트의 **Caddy** 가 443 을 종단하고 backend `localhost:3000` 으로 역프록시한다.
- 도메인은 **nip.io**(`168.138.198.152.nip.io` — 공인 IP를 도메인으로 매핑해 주는 무료 DNS),
  인증서는 Caddy 가 **Let's Encrypt** 로 자동 발급·갱신한다.
- 카카오 OAuth redirect URI 도 이 도메인 기준: `https://168.138.198.152.nip.io/api/auth/kakao/callback`
  (`.env.prod` 의 `API_BASE_URL=https://168.138.198.152.nip.io/api` 와 일치).

#### 실배포 절차 — Mac amd64 크로스빌드 → ssh 스트리밍 load → compose

micro(1GB RAM)에서는 backend 이미지 빌드가 불가능하다(OOM). **Mac 에서 linux/amd64 로
크로스빌드해 이미지를 ssh 로 스트리밍 전송**하는 것이 정본 절차다.

> ⚠️ OCI 프로덕션 배포와 `prisma migrate deploy` 는 **휴먼 승인 대상**(`AGENTS.md`) — 실행 전 사용자 확인.

```bash
# ① (Mac) linux/amd64 크로스빌드 — compose 의 image 태그와 동일하게
docker buildx build --platform linux/amd64 \
  -t dart-notification-backend:prod ./backend --load

# ② 이미지 스트리밍 전송(중간 파일 없이 gzip 파이프로 바로 docker load)
docker save dart-notification-backend:prod | gzip | \
  ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152 'gunzip | docker load'

# ③ (micro1) 재기동 — 로드된 이미지를 그대로 사용(★--build 금지: micro 에서 빌드 불가)
#    ★원격 실경로는 /home/ubuntu/dano (dart-notification 아님)
ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152 \
  'cd /home/ubuntu/dano && docker compose -f docker-compose.prod.yml up -d backend'

# ④ 스키마 변경이 포함된 배포만 (휴먼 승인 후):
ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152 \
  'cd /home/ubuntu/dano && docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate'
```

#### 배포 검증 (헬스체크 + 데이터 신선도)

```bash
# HTTPS 헬스 (Caddy 경유 — /health 는 글로벌 prefix 제외 경로)
curl -i https://168.138.198.152.nip.io/health

# 데이터 신선도 — 최신 공시 rcpDt 가 당일(영업일)인지 확인. 1일 이상 정체면 수집 cron 점검.
curl -s "https://168.138.198.152.nip.io/api/disclosures?limit=1"

# 컨테이너 상태
ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152 \
  'docker compose -f /home/ubuntu/dano/docker-compose.prod.yml ps'
```

> 환경변수(`backend/.env.prod`)·방화벽(VCN Security List + iptables)·TimescaleDB preload 등
> 공통 세팅 절차는 §3.6 의 ⑤~⑧ 을 그대로 사용한다(단, DB 관련은 micro2 대상).

#### 리소스 하드닝 — OOM 단일장애점 완화 (OPS-3)

micro(1GB RAM)에서는 backend 메모리 폭주가 호스트 전체 OOM 으로 번질 수 있다.
`docker-compose.prod.yml` 에 다음 상한이 적용되어 있다(구조 변경 없음 — 리소스 제한만):

| 서비스 | 설정 | 의도 |
|--------|------|------|
| backend | `mem_limit: 640m` | 폭주 시 이 컨테이너만 OOM-kill → 호스트 보호 |
| backend | `NODE_OPTIONS=--max-old-space-size=448` | V8 힙 상한 — 컨테이너 kill 전에 GC 가 먼저 동작 |
| backend / redis | `restart: always` | OOM-kill·재부팅 후 무조건 자동 재기동 |
| redis | `--maxmemory 128mb --maxmemory-policy noeviction` | 상한 고정. **eviction 금지**(BullMQ 잡 메타 evict 시 큐 파손 — `allkeys-lru` 절대 금지) |

#### DB 자동 백업 — `scripts/backup-prod-db.sh` + cron (OPS-1)

수동 pg_dump(§5.1)를 대체하는 **자동 백업 스크립트**. micro1 에서 실행하며
`pg_dump -Fc`(nice/ionice) → gzip → **S3 업로드**(`s3://$S3_BUCKET/backups/dart_notification_YYYY-MM-DD.dump.gz`)
순서로 동작한다. 자격·버킷은 `backend/.env.prod` 의 기존 값(`DATABASE_URL`·`AWS_*`·`S3_BUCKET`)을 재사용한다.

```bash
# 수동 1회 실행 (micro1)
ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152 \
  'ENV_FILE=/home/ubuntu/dano/backend/.env.prod bash /home/ubuntu/dano/scripts/backup-prod-db.sh'

# crontab 설치 — 매일 03:30 KST (서버 시계는 UTC → 18:30 UTC = 익일 03:30 KST)
# crontab -e 후 아래 1줄 추가:
30 18 * * * ENV_FILE=/home/ubuntu/dano/backend/.env.prod bash /home/ubuntu/dano/scripts/backup-prod-db.sh >> /home/ubuntu/backup-prod-db.log 2>&1
```

- 실패 시 `exit 1` + stderr — cron 로그(`/home/ubuntu/backup-prod-db.log`)에서 즉시 발견 가능.
- 호스트에 `pg_dump`/`aws` CLI 가 없으면 docker 이미지 폴백으로 동작(별도 설치 불요).
- **보존 정책**은 S3 Lifecycle 로 관리(일 7 · 주 4 · 월 3 수준 롤링) — 규칙 예시는
  스크립트 말미 주석 참조. 복구 절차(TimescaleDB pre/post_restore 필수)는 §5.2.

---

### 3.2 (구) AWS 배포 예시 — 과거 경로 · 현재 미사용

> **(구) 2026-06 이전 검토·일부 사용된 AWS 경로다. 현재 프로덕션은 §3.1(OCI 2-micro)이며
> 이 절의 인프라(ECS/RDS/ALB)는 미사용이다.** `infra/*.tf`(Terraform)도 같은 시기의 레거시.
> ARM 확보 시 대안은 §3.6 참조.

#### 3.2.1 RDS PostgreSQL 생성

```bash
# AWS CLI를 통한 RDS 생성
aws rds create-db-instance \
  --db-instance-identifier dart-notification-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.3 \
  --master-username admin \
  --master-user-password SecurePassword123! \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxxxxxxxx \
  --db-subnet-group-name default
```

#### 3.2.2 ECS 배포

**ECR에 이미지 푸시**:
```bash
# 1. ECR 로그인
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.ap-northeast-2.amazonaws.com

# 2. Docker 이미지 빌드
docker build -t dart-notification-backend ./backend

# 3. 이미지 태그
docker tag dart-notification-backend:latest \
  123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/dart-notification:latest

# 4. 이미지 푸시
docker push 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/dart-notification:latest
```

**ECS Task Definition**:
```json
{
  "family": "dart-notification-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "backend",
      "image": "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/dart-notification:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" }
      ],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:..." }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/dart-notification",
          "awslogs-region": "ap-northeast-2",
          "awslogs-stream-prefix": "backend"
        }
      }
    }
  ]
}
```

---

### 3.3 (구) 환경 변수 관리 (AWS Secrets Manager) — 현재 미사용

> **(구)** §3.2 와 같은 과거 AWS 경로. 현행 시크릿 관리는 서버의 `backend/.env.prod`
> (gitignore, 저장소에는 `.env.prod.example` 만 커밋 — §3.6 ⑤ 참조).

```bash
# 시크릿 생성
aws secretsmanager create-secret \
  --name dart-notification/database-url \
  --secret-string "postgresql://admin:password@db.example.com:5432/dart_notification"

aws secretsmanager create-secret \
  --name dart-notification/jwt-secret \
  --secret-string "production-jwt-secret-key"
```

---

### 3.4 (구) CI/CD 파이프라인 (GitHub Actions → ECS) — 현재 미사용

> **(구)** ECS 배포 전제의 과거 예시. 현행 배포는 §3.1 의 수동 런북(휴먼 승인 게이트)이다.

```yaml
# .github/workflows/deploy-backend.yml
name: Deploy Backend to AWS ECS

on:
  push:
    branches:
      - main
    paths:
      - 'backend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-2

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build, tag, and push image to Amazon ECR
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: dart-notification
          IMAGE_TAG: ${{ github.sha }}
        run: |
          cd backend
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster dart-notification-cluster \
            --service backend-service \
            --force-new-deployment
```

---

### 3.5 모바일 앱 배포 — 현행: EAS Android APK (`oci` 프로파일)

현행 배포는 스토어가 아니라 **EAS 빌드 APK 직접 설치**다. 라이브 앱: **공시온 v1.0.0**
(`com.gongsion.app`, EAS 프로젝트 `@duvbi/dart-alert`, projectId 는 `mobile/app.json`
`extra.eas.projectId`).

#### google-services.json 주입 (FCM 푸시 — EAS 파일 시크릿 + app.config.js)

`google-services.json` 은 비밀 취급으로 `.gitignore` 되어 저장소에 없다. 빌드 배선(DAR-447):

- EAS **파일 환경변수(secret)** `GOOGLE_SERVICES_JSON` 으로 등록 → 빌드 시 임시 경로로
  materialize 되고 그 경로가 `process.env.GOOGLE_SERVICES_JSON` 에 들어온다.
- `mobile/app.config.js` 가 app.json 을 베이스로 `android.googleServicesFile` 에 이 경로를
  주입한다. 로컬(`expo start`)에선 env 미설정 → 작업트리의 `./google-services.json` 폴백.
- 잔여 작업: **FCM V1 서버키 등록**(Firebase 콘솔, 대화식) 후 standalone APK 푸시 토큰 검증.

#### APK 빌드·배포

```bash
cd mobile

# oci 프로파일 = 현행 prod API(https://168.138.198.152.nip.io/api) 고정 + buildType: apk
eas build --profile oci --platform android

# 빌드 완료 후 EAS 가 주는 URL/QR 로 기기에서 APK 다운로드·설치
# (또는 로컬: adb install -r <path>.apk)
```

#### (향후) 스토어 제출

Play Store 등록은 M10 졸업 전후 결정 사항(재개 계획 §4). 제출 시:

```bash
# production 프로파일(app-bundle) — ★제출 전 EXPO_PUBLIC_API_URL 을 현행 엔드포인트로 갱신(§2.3 주의)
eas build --profile production --platform android
eas submit --platform android   # eas.json submit.production (service account key)
```

- Google Play Console: 앱 정보·스크린샷·개인정보 처리방침 URL·콘텐츠 등급.
- iOS 는 미착수(현행 타깃은 Android APK).

---

### 3.6 (대안) ARM A1 확보 시 — 단일 VM 풀스택 배포 · docker-compose.prod (DAR-427)

> **현재 미확보.** Ampere A1 은 Tokyo 리전 용량 부족("Out of host capacity")이 지속되어
> `scripts/oci-arm-a1-retry.sh` 가 확보 루프를 돈다(4 OCPU/24GB → 2/12 → 1/6 폴백·지수 백오프,
> 성공 시 OCID/공개 IP 출력 — 동일 SSH 키 `~/.ssh/oci_instance` 사용).
> **확보 전까지 프로덕션 정본은 §3.1(AMD 2-micro)이다.** 확보 시 아래 절차로 단일 VM 에
> 풀스택(backend+Postgres+Redis)을 통합 이전한다 — A1 은 RAM 이 충분해 호스트 로컬 빌드가
> 가능하므로 §3.1 의 Mac 크로스빌드가 불필요해진다.

비용 0원으로 백엔드 + Postgres(TimescaleDB) + Redis 를 **단일 VM 에 24/7** 구동하는 절차다.
Oracle Cloud 의 **Always Free** 등급은 Ampere A1(ARM64) VM 을 영구 무료로 제공한다(최대 4 OCPU /
24GB RAM). 본 저장소의 `docker-compose.prod.yml` · `backend/.env.prod.example` 로 바로 띄운다.

> 사용 자산: `docker-compose.prod.yml`(repo 루트) · `backend/.env.prod.example`.
> 외부로 여는 포트는 backend `3000` 하나뿐(Postgres·Redis 는 컨테이너 내부 통신만 — 공격면 최소화).
> 시각/시간대는 backend 이미지에 `TZ=Asia/Seoul`(KST) 고정.

#### ① Oracle Cloud 계정 생성

1. <https://www.oracle.com/cloud/free/> 에서 가입(신용카드 본인확인 필요, **Always Free 자원은 과금 안 됨**).
2. 홈 리전(예: `Asia Pacific (Seoul)` / `ap-seoul-1` 또는 `Chuncheon`)을 선택한다.

#### ② Always Free ARM VM(Ampere A1 · Ubuntu) 생성

1. 콘솔 → **Compute → Instances → Create instance**.
2. **Image**: Ubuntu 22.04(LTS). **Shape**: `VM.Standard.A1.Flex`(Ampere, ARM64) — Always Free 한도 내
   예: **2 OCPU / 12GB RAM**(여유 있으면 4 OCPU / 24GB).
3. **SSH 키**: 로컬 공개키 업로드(또는 콘솔 생성 키 다운로드).
4. 생성 후 인스턴스의 **공인 IP(Public IP)** 를 기록한다.

> A1 용량이 "Out of capacity" 면 다른 가용 도메인(AD)·리전으로 재시도하거나
> `scripts/oci-arm-a1-retry.sh` 백오프 루프를 돌린다(`nohup bash scripts/oci-arm-a1-retry.sh > /tmp/oci-arm-retry.log 2>&1 &`).

#### ③ Docker / Docker Compose 설치 (VM 접속 후)

```bash
# 로컬에서 SSH 접속 (Ubuntu 기본 사용자 ubuntu)
ssh ubuntu@<공인IP>

# Docker Engine + compose plugin 설치 (공식 편의 스크립트)
curl -fsSL https://get.docker.com | sudo sh

# 현재 사용자를 docker 그룹에 추가 (sudo 없이 docker 사용) → 재로그인 필요
sudo usermod -aG docker $USER
exit
ssh ubuntu@<공인IP>

# 설치 확인 (arm64 / docker compose v2)
docker version
docker compose version
uname -m   # aarch64 → ARM64 확인
```

#### ④ 저장소 클론

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/your-org/dart-notification.git
cd dart-notification
```

#### ⑤ 운영 환경변수(.env.prod) 작성

```bash
# 템플릿 복사 후 실제 시크릿으로 채운다 (발급처는 파일 내 주석 참조)
cp backend/.env.prod.example backend/.env.prod

# 강한 시크릿 생성 예시
openssl rand -base64 48   # JWT_SECRET / JWT_REFRESH_SECRET / DB·Redis 비밀번호용

nano backend/.env.prod
```

채워야 하는 핵심 값:

- `POSTGRES_PASSWORD` 와 `DATABASE_URL` 의 비밀번호를 **동일하게** 맞춘다(불일치 시 DB 인증 실패).
- `JWT_SECRET` / `JWT_REFRESH_SECRET`(각 최소 16자), `DART_API_KEY`, `LLM_API_KEY`,
  `KAKAO_REST_API_KEY` 는 **부팅 필수**(누락 시 backend 가 부팅 단계에서 fail-fast).
- `REDIS_PASSWORD`(권장), `CORS_ALLOWED_ORIGINS`(운영 화이트리스트), `API_BASE_URL`(공인 IP/도메인).
- S3 오프로드 사용 시 `STORAGE_DRIVER=s3` + `AWS_REGION`/`S3_BUCKET`(+자격증명).

> `backend/.env.prod` 는 `.gitignore` 로 커밋되지 않는다(저장소에는 `.env.prod.example` 만 존재).

#### ⑥ 컨테이너 기동 (docker compose up -d)

```bash
# 이미지 빌드(arm64 호스트에서 backend 로컬 빌드) + 백그라운드 기동
docker compose -f docker-compose.prod.yml up -d --build

# 상태 확인 (postgres·redis 가 healthy 된 뒤 backend 가 뜬다)
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

> ★prod 이미지 빌드는 `src/e2e`(수동 게이트 E2E 스크립트)를 컴파일 대상에서 제외한다
> (`backend/tsconfig.build.json` exclude). 이 스크립트는 `.dockerignore` 로 제외된 `test/` 를
> import 하므로 Docker 빌드 컨텍스트에서 모듈 해소가 깨진다(DAR-442). 런타임/dist 어디서도
> 참조되지 않으며, 로컬에선 여전히 `npx ts-node src/e2e/integration-regression.ts` 로 직접 실행 가능하다.

#### ⑦ DB 스키마 반영 (prisma migrate deploy — 1회성, 운영 안전 분리)

자동 마이그레이션은 운영 안전을 위해 기동 경로에서 분리했다. **명시적으로 1회** 실행한다(스키마 변경 시 반복):

```bash
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
# → npx prisma migrate deploy 가 postgres(healthy) 에 대해 실행되고 컨테이너는 종료/삭제(--rm).
```

> ★TimescaleDB 확장: 본 compose 의 postgres 는 `shared_preload_libraries=timescaledb` 로 기동하므로
> `CREATE EXTENSION timescaledb` 마이그레이션이 그대로 성공한다(별도 조치 불요 · 위 1.4 DAR-382 절 참조).

#### ⑧ 방화벽 / 보안 목록에서 3000 포트 개방

Oracle 은 **두 겹**의 방화벽이 있다 — 둘 다 열어야 외부 접속이 된다.

1. **VCN Security List(또는 NSG) — 콘솔**: 인스턴스의 VCN → Security Lists → Default →
   **Ingress Rule 추가**: Source `0.0.0.0/0`, IP Protocol `TCP`, Destination Port `3000`.
2. **VM 내부 OS 방화벽**: Ubuntu(Oracle 이미지)는 iptables 에 기본 차단 규칙이 있다.

```bash
# Ubuntu(Oracle 이미지) — netfilter-persistent 로 3000 인바운드 허용 후 영구 저장
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

> (선택·권장) 외부에 80/443 만 노출하고 backend 3000 은 내부로 두려면 **Caddy + nip.io +
> Let's Encrypt** 역프록시를 앞단에 둔다 — 현행 2-micro 라이브에서 실사용 중인 패턴(§3.1 HTTPS 절).
> 최소 구성은 3000 직노출로 충분하다.

#### ⑨ 헬스체크 (배포 검증)

```bash
# VM 내부
curl -i http://localhost:3000/health
# → 200 OK (글로벌 prefix 제외 경로. liveness 는 /health/live)

# 로컬 PC / 모바일 — 공인 IP 로
curl -i http://<공인IP>:3000/health

# 컨테이너 헬스 상태(모두 healthy 여야 정상)
docker compose -f docker-compose.prod.yml ps
```

이후 모바일 앱의 `EXPO_PUBLIC_API_URL` 을 `http://<공인IP>:3000/api`(또는 도메인/HTTPS)로 가리키면 된다.

#### 운영 명령 모음

```bash
docker compose -f docker-compose.prod.yml up -d            # 기동(+--build 로 재빌드)
docker compose -f docker-compose.prod.yml down             # 정지(볼륨 postgres_data/redis_data 유지)
docker compose -f docker-compose.prod.yml logs -f backend  # 로그 추적
git pull && docker compose -f docker-compose.prod.yml up -d --build  # 코드 갱신 후 재배포
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate  # 스키마 재반영
```

> **실제 배포·시크릿 발급/입력은 사용자 몫**이다. 본 절은 복붙 가능한 절차/자산을 제공한다.

---

## 4. 모니터링 및 로깅

### 4.1 백엔드 모니터링 (향후)

**Sentry 통합**:
```typescript
// backend/src/main.ts
import * as Sentry from '@sentry/node';

if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
  });
}
```

**현행 로그 확인** (OCI micro1):
```bash
ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152 \
  'docker compose -f dart-notification/docker-compose.prod.yml logs -f backend'
```

---

### 4.2 모바일 앱 모니터링 (향후)

**Sentry 통합**:
```typescript
// mobile/app/_layout.tsx
import * as Sentry from 'sentry-expo';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enableInExpoDevelopment: false,
  debug: false,
});
```

---

## 5. 백업 및 복구

### 5.1 데이터베이스 백업

**현행: 자동 백업** — `scripts/backup-prod-db.sh` + cron(매일 03:30 KST). 상세·설치 절차는
**§3.1 "DB 자동 백업"** 참조 (pg_dump -Fc → gzip → S3 `backups/` 업로드, `.env.prod` 자격 재사용).

수동 1회 덤프가 필요할 때:

```bash
# PostgreSQL 덤프 (custom format 권장 — 병렬 복원·선택 복원 가능)
pg_dump -Fc -h <DB호스트> -U <사용자> -d dart_notification \
  -f dart_notification_$(date +%Y-%m-%d).dump
```

- 최근 검증 백업: `dart-db-backups/dart_notification_2026-06-27.dump` (복원 가능 검증 완료).
- (구) AWS RDS 자동 백업 절차는 폐기 — RDS 미사용(§3.2).

---

### 5.2 복구

> ★**TimescaleDB 주의**: 하이퍼테이블 포함 DB 복원은 `timescaledb_pre_restore()` →
> `pg_restore` → `timescaledb_post_restore()` 순서가 **필수**다. 상세 런북:
> `docs/roadmap/cc-pause-handoff-2026-06-28.md` §3.

```bash
psql "$DATABASE_URL" -c "SELECT timescaledb_pre_restore();"
pg_restore -h <DB호스트> -U <사용자> -d dart_notification dart_notification_2026-06-27.dump
psql "$DATABASE_URL" -c "SELECT timescaledb_post_restore();"
```

---

## 6. 보안 체크리스트

### 배포 전 확인사항

- [ ] 환경 변수에 하드코딩된 시크릿 없음
- [ ] HTTPS 적용 (SSL/TLS 인증서)
- [ ] CORS 설정 (허용된 도메인만)
- [ ] Rate Limiting 적용
- [ ] 헬멧(helmet) 미들웨어 적용
- [ ] SQL Injection 방지 (Prisma 사용)
- [ ] XSS 방지 (입력값 검증)
- [ ] JWT Secret 강력한 랜덤 문자열
- [ ] 비밀번호 해싱 (bcrypt)
- [ ] 데이터베이스 접근 제한 (VPC)
- [ ] 로그에 민감 정보 미포함

---

**작성일**: 2026-03-07 · **최종 수정일**: 2026-07-09
**버전**: 2.1 — OPS-1 백업 자동화(`scripts/backup-prod-db.sh`+cron)·OPS-3 리소스 하드닝
(mem_limit/NODE_OPTIONS/redis maxmemory)·원격 실경로 `/home/ubuntu/dano` 정정
