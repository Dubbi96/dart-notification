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
```

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
