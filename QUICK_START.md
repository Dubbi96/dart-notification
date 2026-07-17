# 빠른 시작 가이드

DART 공시 알림 서비스를 로컬 환경에서 실행하기 위한 단계별 안내입니다.

---

## 전제 조건

- **Node.js 20+** 설치됨
- **npm** 설치됨
- **Docker Desktop** 설치됨 (PostgreSQL 실행용)
- **카카오 개발자 계정** (OAuth 앱 등록 필요)

---

## 1단계: 프로젝트 클론

```bash
git clone https://github.com/your-org/dart-notification.git
cd dart-notification
```

---

## 2단계: 카카오 개발자 설정

1. [카카오 개발자](https://developers.kakao.com)에 로그인
2. "내 애플리케이션" > "애플리케이션 추가하기"
3. 앱 생성 후 **REST API 키** 복사
4. "카카오 로그인" 활성화
5. "Redirect URI" 설정: `http://localhost:3000/auth/kakao/callback`
6. "동의항목" 설정: 닉네임, 프로필 사진, 이메일 등 필요한 항목 설정

---

## 3단계: 데이터베이스 실행

```bash
# Docker Compose로 PostgreSQL 실행
docker-compose -f docker-compose.dev.yml up -d

# 실행 확인
docker ps
```

---

## 4단계: 백엔드 설정 및 실행

### 4.1 환경 변수 설정

```bash
cd backend

# .env 파일 생성/수정
# 최소한 다음 항목을 설정하세요:
```

```env
DATABASE_URL="postgresql://user:password@localhost:5432/dart_notification"
JWT_SECRET="your-jwt-secret-key"
JWT_REFRESH_SECRET="your-jwt-refresh-secret-key"
DART_API_KEY="your-dart-api-key"
EXPO_PUSH_ACCESS_TOKEN="your-expo-push-access-token"
KAKAO_REST_API_KEY="your-kakao-rest-api-key"   # 모바일 EXPO_PUBLIC_KAKAO_REST_API_KEY 와 동일 앱의 REST API 키
KAKAO_CLIENT_SECRET=""                          # 카카오 로그인 > 보안 > Client Secret 사용 시에만 (미사용 시 빈 값)
```

> Redirect URI(`http://localhost:3000/auth/kakao/callback`)는 백엔드 `.env`가 아니라 2단계의 **카카오 개발자 콘솔**에 등록한다. 전체 예시는 `backend/.env.example` 참조.

### 4.2 의존성 설치 및 DB 마이그레이션

```bash
npm install
npx prisma generate
npx prisma migrate dev
```

### 4.3 백엔드 실행

```bash
npm run start:dev

# 정상 실행 시:
# Application is running on: http://localhost:3000
# Swagger 문서: http://localhost:3000/api/docs
```

---

## 5단계: 모바일 앱 설정 및 실행

### 5.1 환경 변수 설정

```bash
cd mobile

# .env 파일 확인/수정
# EXPO_PUBLIC_API_URL=http://localhost:3000/api
```

### 5.2 의존성 설치 및 실행

```bash
npm install
npx expo start

# 실행 옵션:
# - i: iOS 시뮬레이터
# - a: Android 에뮬레이터
# - w: 웹 브라우저
```

**QR 코드 스캔** (실제 디바이스):
- iOS: 카메라 앱으로 QR 코드 스캔
- Android: Expo Go 앱에서 "Scan QR Code"

---

## 6단계: 동작 확인

### 백엔드 확인

```bash
# Swagger 문서 확인
open http://localhost:3000/api/docs

# API 테스트
curl http://localhost:3000
```

### 모바일 앱 확인

- 앱 시작 시 카카오 로그인 화면 표시
- 카카오 계정으로 로그인 가능
- 탭 네비게이션 (홈, 알림, 설정) 동작

---

## 문제 해결

### Docker 컨테이너가 시작되지 않음

```bash
# 주의: `down -v`는 DB 볼륨(축적 데이터)을 삭제한다 — 절대 습관적으로 쓰지 말 것.
# 컨테이너 재시작만 필요하면:
docker-compose -f docker-compose.dev.yml restart
```

### Prisma 마이그레이션 실패

```bash
npx prisma generate        # 스키마 변경 후 클라이언트 재생성
npx prisma migrate dev     # 개발용 마이그레이션 적용
```

> ⚠️ `prisma migrate reset`은 전체 데이터를 삭제하는 파괴 명령으로 하네스에서 차단(deny)된다.
> DB가 깨졌으면 초기화 대신 백업 복원 절차(`docs/roadmap/cc-pause-handoff-2026-06-28.md` §3)를 따를 것.

### 포트 충돌 (3000번 포트)

```bash
# .env 파일에서 PORT 변경
PORT=3001

# 또는 기존 프로세스 종료
lsof -ti:3000 | xargs kill -9
```

### Expo 앱이 연결되지 않음

```bash
npx expo start --clear
npx expo start --tunnel   # 방화벽 문제 시
```

---

## 추가 자료

- [프로젝트 구조](./PROJECT_STRUCTURE.md)
- [시스템 아키텍처](./docs/architecture.md)
- [데이터베이스 스키마](./docs/database-schema.md)
- [API 명세서](./docs/api-specification.md)
- [실행 로드맵](./docs/roadmap/01-execution-roadmap.md)

---

**마지막 업데이트**: 2026-07-17 (DAR-548 정본 동기화 감사 — 백엔드 `.env` 카카오 키 이름 실코드 정합: `KAKAO_CLIENT_ID`/`KAKAO_REDIRECT_URI` → `KAKAO_REST_API_KEY`/`KAKAO_CLIENT_SECRET`, `EXPO_PUSH_ACCESS_TOKEN` 추가) / 이전: 2026-07-02
