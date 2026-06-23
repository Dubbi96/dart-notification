# 배포 가이드

## 1. 개발 환경 설정

### 1.1 필수 요구사항

**로컬 개발 환경**:
- Node.js 20+ (권장: 20.11.0 LTS)
- pnpm 9+
- PostgreSQL 15+
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
pnpm install

# 3. 모바일 설치
cd ../mobile
pnpm install
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

# JWT
JWT_SECRET="your-super-secret-key-change-in-production"
JWT_REFRESH_SECRET="your-refresh-secret-key-change-in-production"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

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

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  postgres:
    # DAR-378: TimescaleDB(pg15 기반) — 대규모 분봉/일봉 시계열 효율화.
    # pg15 호환 이미지라 기존 postgres_data(PG15) 볼륨을 그대로 사용한다(데이터 손실 0).
    image: timescale/timescaledb:2.17.2-pg15
    container_name: dart-notification-db
    restart: always
    # DAR-382: 확장 적재를 위해 shared_preload_libraries 를 영구 지정(이미지가 자동으로 conf 를 고치지 않음).
    command: postgres -c shared_preload_libraries=timescaledb
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: dart_notification
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

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
pnpm prisma generate

# 2. 마이그레이션 실행
pnpm prisma migrate dev --name init

# 3. 기업 마스터 데이터 시드 (선택)
pnpm prisma db seed
```

**시드 스크립트** (`backend/prisma/seed.ts`):
```typescript
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding companies...');

  // DART API에서 기업 목록 가져오기
  // (실제로는 XML 파싱 필요, 여기서는 샘플 데이터)
  const companies = [
    { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' },
    { corpCode: '00164779', corpName: '삼성물산', stockCode: '028260', market: 'KOSPI' },
    { corpCode: '00164742', corpName: '삼성SDI', stockCode: '006400', market: 'KOSPI' },
    // ... 더 많은 기업
  ];

  await prisma.company.createMany({
    data: companies,
    skipDuplicates: true,
  });

  console.log(`Seeded ${companies.length} companies`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

---

### 1.6 백엔드 실행

```bash
cd backend

# 개발 모드 (hot reload)
pnpm run start:dev

# 로그 확인
# [Nest] 12345  - 2026-03-07 12:00:00     LOG [NestFactory] Starting Nest application...
# [Nest] 12345  - 2026-03-07 12:00:00     LOG [InstanceLoader] AppModule dependencies initialized
# [Nest] 12345  - 2026-03-07 12:00:00     LOG [RoutesResolver] AuthController {/api/auth}: +3ms
# [Nest] 12345  - 2026-03-07 12:00:00     LOG Application is running on: http://localhost:3000
```

**API Health Check**:
```bash
curl http://localhost:3000/api/health
# Expected: {"status":"ok","timestamp":"2026-03-07T12:00:00.000Z"}
```

---

### 1.7 모바일 앱 실행

```bash
cd mobile

# Expo 개발 서버 시작
pnpm expo start

# 또는 특정 플랫폼으로 바로 실행
pnpm expo start --ios      # iOS 시뮬레이터
pnpm expo start --android  # Android 에뮬레이터
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

#### Backend Dockerfile

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# pnpm 설치
RUN npm install -g pnpm

# 의존성 설치
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 소스 복사 및 빌드
COPY . .
RUN pnpm prisma generate
RUN pnpm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

EXPOSE 3000

CMD ["pnpm", "run", "start:prod"]
```

#### docker-compose.staging.yml

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
    image: postgres:15-alpine
    container_name: dart-notification-db
    restart: always
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
docker exec dart-notification-backend pnpm prisma migrate deploy

# 4. 로그 확인
docker logs -f dart-notification-backend
```

---

### 2.3 모바일 앱 빌드 (Staging)

#### EAS Build 설정

```json
// mobile/eas.json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "http://localhost:3000/api",
        "EXPO_PUBLIC_APP_ENV": "development"
      }
    },
    "staging": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://staging-api.dart-notification.com/api",
        "EXPO_PUBLIC_APP_ENV": "staging"
      },
      "ios": {
        "simulator": false
      },
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.dart-notification.com/api",
        "EXPO_PUBLIC_APP_ENV": "production"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

#### 빌드 실행

```bash
cd mobile

# 1. EAS CLI 설치
npm install -g eas-cli

# 2. EAS 로그인
eas login

# 3. 프로젝트 설정
eas build:configure

# 4. Staging 빌드 (iOS)
eas build --profile staging --platform ios

# 5. Staging 빌드 (Android)
eas build --profile staging --platform android

# 빌드 완료 후 내부 테스터에게 공유
```

---

## 3. 프로덕션 배포

### 3.1 클라우드 서비스 선택

**권장 옵션**:

| 서비스 | 백엔드 | 데이터베이스 | 장점 |
|--------|--------|--------------|------|
| **AWS** | ECS / Elastic Beanstalk | RDS PostgreSQL | 안정성, 확장성 |
| **GCP** | Cloud Run | Cloud SQL | 간편한 배포, 자동 스케일링 |
| **Heroku** | Heroku Dynos | Heroku Postgres | 가장 빠른 배포 |
| **Fly.io** | Fly Apps | Fly Postgres | 저렴한 비용, 글로벌 배포 |

---

### 3.2 AWS 배포 예시

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

### 3.3 환경 변수 관리 (AWS Secrets Manager)

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

### 3.4 CI/CD 파이프라인 (GitHub Actions)

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

### 3.5 모바일 앱 스토어 배포

#### iOS App Store

```bash
# 1. Production 빌드
eas build --profile production --platform ios

# 2. App Store Connect에 제출
eas submit --platform ios
```

**App Store Connect 설정**:
- 앱 정보, 스크린샷, 설명 입력
- 개인정보 처리방침 URL
- 심사 노트

#### Google Play Store

```bash
# 1. Production 빌드
eas build --profile production --platform android

# 2. Google Play Console에 제출
eas submit --platform android
```

**Google Play Console 설정**:
- 앱 정보, 스크린샷, 설명 입력
- 개인정보 처리방침 URL
- 콘텐츠 등급

---

### 3.6 무료클라우드 배포 — Oracle Cloud Always Free (ARM64) · docker-compose.prod (DAR-427)

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

> A1 용량이 가끔 "Out of capacity" 면 다른 가용 도메인(AD)·리전으로 재시도하거나 잠시 후 재시도.

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

> (선택·권장) 외부에 80/443 만 노출하고 backend 3000 은 내부로 두려면 nginx + Let's Encrypt 역프록시를
> 앞단에 둔다. 위 2.2 staging compose 의 nginx 패턴 참고. 최소 구성은 3000 직노출로 충분하다.

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

**CloudWatch Logs** (AWS):
- ECS Task에서 자동으로 로그 수집
- 로그 그룹: `/ecs/dart-notification`

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

**자동 백업 (AWS RDS)**:
- RDS 자동 백업 활성화 (7일 보관)
- 매일 자정 스냅샷 생성

**수동 백업**:
```bash
# PostgreSQL 덤프
pg_dump -h db.example.com -U admin -d dart_notification > backup_$(date +%Y%m%d).sql

# S3에 업로드
aws s3 cp backup_$(date +%Y%m%d).sql s3://dart-notification-backups/
```

---

### 5.2 복구

```bash
# 1. S3에서 백업 다운로드
aws s3 cp s3://dart-notification-backups/backup_20260307.sql ./

# 2. 데이터베이스 복구
psql -h db.example.com -U admin -d dart_notification < backup_20260307.sql
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

**작성일**: 2026-03-07
**버전**: 1.0 (MVP)
