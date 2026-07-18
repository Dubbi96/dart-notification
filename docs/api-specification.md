# API 명세서

## 목차
1. [인증 (Auth)](#1-인증-auth) — 카카오 OAuth(정식) + 이메일(dev/test)
2. [사용자 (Users)](#2-사용자-users)
3. [디바이스 (Devices)](#3-디바이스-devices)
4. [기업 (Companies)](#4-기업-companies)
5. [관심 목록 (WatchList)](#5-관심-목록-watchlist)
6. [알림 설정 (Notification Settings)](#6-알림-설정-notification-settings)
7. [공시 (Disclosures)](#7-공시-disclosures)
8. [알림 히스토리 (Notifications)](#8-알림-히스토리-notifications)
9. [에러 코드](#9-에러-코드)
10. [AI 비용 거버넌스 (AI Cost Governance)](#10-ai-비용-거버넌스-ai-cost-governance)
11. [Persona 모의운용 + 현재 장 적합 추천 (DAR-130)](#11-persona-모의운용--현재-장-적합-추천-dar-130)
12. [매매 신호 (Signals, Engine3)](#12-매매-신호-signals-engine3)
13. [종목 최신 시세 (Market Data Quote, DAR-158)](#13-종목-최신-시세-market-data-quote--dar-158)
14. [포트폴리오 리스크 스냅샷 (Portfolio Risk, DAR-163)](#14-포트폴리오-리스크-스냅샷-portfolio-risk--dar-163)
15. [시장지수 (Market Index, DAR-160)](#15-시장지수-market-index-dar-160)
16. [이벤트 스터디 (Event Study)](#16-이벤트-스터디-event-study)
17. [구간 캔들 (Candles — TimescaleDB)](#17-구간-캔들-candles--timescaledb-dar-378)
18. [시스템 트레이딩 전략 변형 트랙 (Strategy Tracks)](#18-시스템-트레이딩-전략-변형-트랙-strategy-tracks-dar-404)
19. [분봉 단타 모의전략 트랙 (Intraday Scalp)](#19-분봉-단타-모의전략-트랙-intraday-scalp-dar-411)
20. [라이브 페이퍼 체결 알림 (Trade Notifications)](#20-라이브-페이퍼-체결-알림-trade-notifications-dar-424)
21. [시스템 모의운용 (Paper Simulation, Engine5)](#21-시스템-모의운용-paper-simulation-engine5)
22. [포트폴리오·포지션 (Portfolio, Engine4)](#22-포트폴리오포지션-portfolio-engine4)
23. [저장한 공시 (Saved Disclosures)](#23-저장한-공시-saved-disclosures)
24. [투자 철학 (Philosophy, Engine2)](#24-투자-철학-philosophy-engine2)
25. [재무지표·내부자 지분 (Financials·Insider Holdings, Engine1)](#25-재무지표내부자-지분-financialsinsider-holdings-engine1)
26. [공시 원문 파싱·정량 팩트·이벤트 (Engine1)](#26-공시-원문-파싱정량-팩트이벤트-engine1)
27. [수집 파이프라인·스케줄러 운영 (Engine1)](#27-수집-파이프라인스케줄러-운영-engine1)
28. [시세 수집·지표·종목상태 운영 (Engine3)](#28-시세-수집지표종목상태-운영-engine3)
29. [백테스트·신호 정확도·신호 생성 (Engine3)](#29-백테스트신호-정확도신호-생성-engine3)
30. [졸업 게이트·감사 로그 (Engine5)](#30-졸업-게이트감사-로그-engine5)
31. [운영·관측 (Ops·Health·Storage)](#31-운영관측-opshealthstorage)
32. [운영·리스크 감지점 알림 배선 (Ops/Risk Alert Wiring, DAR-476 P02)](#32-운영리스크-감지점-알림-배선-opsrisk-alert-wiring-dar-476-p02)
33. [시장 파생 데이터 — 기술지표·수급·공매도 조회 (Market Data, 갭분석 W13·W16)](#33-시장-파생-데이터--기술지표수급공매도-조회-market-data-갭분석-w13w16)
34. [공개 웹 표면 — 랜딩·공유 페이지·시스템 상태·법적 고지 (비인증)](#34-공개-웹-표면--랜딩공유-페이지시스템-상태법적-고지-비인증)
- [부록 A. Rate Limiting](#부록-a-rate-limiting) / [부록 B. 푸시 알림 Payload](#부록-b-푸시-알림-payload)

---

## 공통 사항

### Base URL
```
Development: http://localhost:3000/api
Production:  https://168.138.198.152.nip.io/api
```

- Production은 OCI 2-micro(micro1 앱 + micro2 DB) 위에서 Caddy + Let's Encrypt(nip.io 도메인)로 HTTPS 서빙한다 (v0.1.1 라이브).
- Swagger 문서: `{BaseURL 호스트}/api/docs`

### 인증 방식
- **JWT Bearer Token** (쓰기·개인화 API)
- Authorization Header: `Bearer {accessToken}`
- 정식 로그인 수단은 **카카오 OAuth**(§1.5~1.7). 이메일 회원가입/로그인(§1.1~1.2)은 dev/test 전용.
- 다수의 읽기 전용·비개인 데이터 API는 `OptionalJwt`(게스트 열람 가능) 또는 무가드(공개)다 — 각 엔드포인트에 표기.

### 공통 Response Format

**성공 응답**:
```json
{
  "success": true,
  "data": { ... },
  "message": "Success message (optional)"
}
```

**에러 응답**:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { ... }
  }
}
```

### HTTP Status Codes
- `200 OK`: 성공
- `201 Created`: 생성 성공
- `204 No Content`: 성공 (응답 본문 없음)
- `400 Bad Request`: 잘못된 요청
- `401 Unauthorized`: 인증 실패
- `403 Forbidden`: 권한 없음
- `404 Not Found`: 리소스 없음
- `409 Conflict`: 중복 또는 충돌
- `422 Unprocessable Entity`: 유효성 검증 실패
- `429 Too Many Requests`: Rate Limit 초과
- `500 Internal Server Error`: 서버 오류

---

## 1. 인증 (Auth)

> **정식 로그인은 카카오 OAuth**(§1.5~1.7, Kakao OAuth + JWT Access/Refresh). 이메일 회원가입/로그인(§1.1~1.2)은 **dev/test 전용**(테스트 계정·개발 편의·dev-login 딥링크)으로 유지한다.

### 1.1 회원가입 (dev/test 전용)

**Endpoint**: `POST /auth/signup`

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecureP@ssw0rd!",
  "name": "홍길동"
}
```

**Validation**:
- `email`: 이메일 형식, 필수
- `password`: 최소 8자, 영문/숫자/특수문자 포함, 필수
- `name`: 최소 2자, 선택

**Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "name": "홍길동",
      "createdAt": "2026-03-07T12:00:00Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 900
    }
  }
}
```

**Errors**:
- `409 Conflict`: 이미 존재하는 이메일
- `422 Unprocessable Entity`: 유효성 검증 실패

---

### 1.2 로그인 (dev/test 전용)

**Endpoint**: `POST /auth/login`

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecureP@ssw0rd!"
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "name": "홍길동"
    },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "expiresIn": 900
    }
  }
}
```

**Errors**:
- `401 Unauthorized`: 잘못된 이메일 또는 비밀번호

---

### 1.3 토큰 갱신

**Endpoint**: `POST /auth/refresh`

**Request Body**:
```json
{
  "refreshToken": "eyJ..."
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresIn": 900
  }
}
```

**Errors**:
- `401 Unauthorized`: 유효하지 않거나 만료된 Refresh Token

---

### 1.4 로그아웃

**Endpoint**: `POST /auth/logout`

**Headers**: `Authorization: Bearer {accessToken}`

**Request Body**:
```json
{
  "deviceToken": "ExponentPushToken[...]"  // optional
}
```

**특징**:
- `deviceToken`을 전달하면 해당 디바이스의 푸시 토큰을 서버에서 삭제하여 로그아웃 후 알림이 오지 않도록 처리

**Response**: `204 No Content`

---

### 1.5 카카오 로그인 (인가 코드 교환)

**Endpoint**: `POST /auth/kakao`

**Rate Limit**: 10 requests / 분 (IP 기준)

**Request Body**:
```json
{
  "code": "카카오 인가 코드",
  "redirectUri": "인가 코드 발급에 사용한 리다이렉트 URI"
}
```

**처리 흐름**: 카카오 인가 코드 → 카카오 access token 교환(`kauth.kakao.com/oauth/token`) → 카카오 사용자 조회(`kapi.kakao.com/v2/user/me`) → `provider='kakao'` 사용자 find-or-create → JWT Access/Refresh 토큰 발급.

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "name": "홍길동",
      "createdAt": "2026-03-07T12:00:00Z"
    },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "expiresIn": 900
    },
    "isNewUser": true
  }
}
```

**특징**:
- 카카오가 이메일을 제공하지 않으면 `kakao_{kakaoId}@kakao.user` 합성 이메일로 생성.
- 신규 가입 시 알림 설정(`NotificationSettings`)을 기본값으로 자동 생성. 기존 사용자는 카카오 닉네임 변경 시 이름 동기화.
- `isNewUser`: 신규 생성이거나 **관심 기업이 0개**(온보딩 필요)면 `true`.

**Errors**:
- `401 Unauthorized`: 카카오 인증 실패 (인가 코드 만료·redirectUri 불일치 등)

---

### 1.6 카카오 OAuth 콜백 (브라우저 → 앱 복귀)

**Endpoint**: `GET /auth/kakao/callback?code={인가코드}&state={state}`

모바일 `openAuthSessionAsync` 흐름의 서버 사이드 콜백(정본 패턴, DAR-443). 카카오 개발자 콘솔의 redirect URI는 prod 기준 `https://168.138.198.152.nip.io/api/auth/kakao/callback`.

- **`state` 형식**: `{nonce}~{encodeURIComponent(returnUrl)}` — `returnUrl`은 모바일이 만든 앱 복귀 딥링크(Expo Go `exp://.../--/kakao`, 빌드 `gongsion://kakao`). 파싱 실패 시 `gongsion://kakao` 폴백.
- **처리**: `code`를 서버 redirectUri(`{API_BASE_URL}/auth/kakao/callback`) 기준으로 교환·로그인 처리 → 결과를 `state` 키로 **5분 TTL 임시 저장** → **HTTP 302 redirect**.
  - 성공: `Location: {returnUrl}?state={state}` — 앱이 §1.7로 결과를 회수.
  - 실패: `Location: {returnUrl}?error={사유}` — 로그인 화면이 실패 사유를 표면화.
- 302 redirect가 정본인 이유: `openAuthSessionAsync`는 returnUrl로의 네비게이션(302 Location 포함)을 OS 레벨에서 가로채 인앱 브라우저를 자동 종료하고 앱으로 복귀시킨다 (HTML+JS custom-scheme 자동 이동은 인앱 브라우저가 차단).

**Response**: `302 Found` (Location: 앱 딥링크)

---

### 1.7 카카오 로그인 결과 조회

**Endpoint**: `GET /auth/kakao/result?state={state}`

콜백(§1.6)이 `state` 키로 저장해둔 로그인 결과를 앱이 회수한다. **일회성**(조회 즉시 삭제)·TTL 5분.

**Response**: `200 OK` (결과 존재 시 — §1.5와 동일한 `{ user, tokens, isNewUser }`)
```json
{
  "success": true,
  "data": {
    "user": { "...": "..." },
    "tokens": { "...": "..." },
    "isNewUser": false
  }
}
```

결과 없음(만료·미존재·이미 소비):
```json
{ "success": false, "data": null }
```

---

## 2. 사용자 (Users)

### 2.1 현재 사용자 조회

**Endpoint**: `GET /users/me`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "email": "user@example.com",
    "name": "홍길동",
    "createdAt": "2026-03-07T12:00:00Z"
  }
}
```

---

### 2.2 프로필 수정

**Endpoint**: `PATCH /users/me`

**Headers**: `Authorization: Bearer {accessToken}`

**Request Body**:
```json
{
  "name": "김철수"
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "email": "user@example.com",
    "name": "김철수",
    "updatedAt": "2026-03-07T13:00:00Z"
  }
}
```

---

### 2.3 Pro 사전신청 여부 조회 (갭분석 W1)

**Endpoint**: `GET /users/pro-waitlist`

**Headers**: `Authorization: Bearer {accessToken}`

Pro 출시 알림 사전신청(`ProWaitlistEntry`) 여부를 본인 기준으로 조회한다. 서버 영속화로 수요 계측의 데이터 소스가 된다(구 로컬 저장 방식은 화면 진입 시 서버로 1회 마이그레이션).

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "optedIn": true,
    "createdAt": "2026-07-16T02:00:00Z"
  }
}
```

- `optedIn`: 사전신청 여부. 미신청이면 `false`, `createdAt`은 `null`.

---

### 2.4 Pro 사전신청 등록 (갭분석 W1)

**Endpoint**: `POST /users/pro-waitlist`

**Headers**: `Authorization: Bearer {accessToken}`

**Request Body**: 없음

**Response**: `200 OK` — §2.3과 동일한 상태 객체(`optedIn: true`)

- **멱등** — 재호출해도 사용자당 1행 유지(`userId` unique upsert). 상태코드도 항상 200.

---

### 2.5 Pro 사전신청 철회 (갭분석 W1)

**Endpoint**: `DELETE /users/pro-waitlist`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `200 OK` — §2.3과 동일한 상태 객체(`optedIn: false`)

- **멱등** — 미신청 상태여도 no-op 후 200.

---

### 2.6 계정 삭제 — 회원 탈퇴 (갭분석 W3, Play 컴플라이언스)

**Endpoint**: `DELETE /users/me`

**Headers**: `Authorization: Bearer {accessToken}`

계정과 모든 개인 데이터(관심기업·알림·저장 공시·포트폴리오·디바이스 토큰 등)를 **즉시 하드 삭제**하고 refresh 토큰을 전부 폐기한다(탈퇴 즉시 토큰 재발급 불가). Google Play 스토어 계정 삭제 하드 요구사항 대응 — 삭제 방법 안내 공개 페이지는 §34.4 참조.

**Response**: `200 OK`
```json
{
  "success": true,
  "data": { "deleted": true }
}
```

- FK Cascade 전수(`USER_CASCADE_DELETE_RELATIONS`)가 개인 데이터를 함께 삭제하며, 스키마에 User 참조가 늘면 DMMF 스키마 가드 스펙이 실패해 누락(개인정보 잔존)을 차단한다.
- FK 미강결합 계측 모델(`SearchMissLog`·`FunnelEvent`)은 행을 통계용으로 남기되 `userId`를 `null`로 익명화한다.
- 법령상 보존(5년/3년) 분리 보관 로직은 없음 — 현재 결제·거래 기록 미취급(과금 도입 시 재설계 필요).

---

## 3. 디바이스 (Devices)

### 3.1 디바이스 등록

**Endpoint**: `POST /devices/register`

**Headers**: `Authorization: Bearer {accessToken}`

**Request Body**:
```json
{
  "deviceToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "ios"
}
```

**Validation**:
- `deviceToken`: Expo Push Token 형식, 필수
- `platform`: "ios" | "android", 필수

**Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "deviceToken": "ExponentPushToken[...]",
    "platform": "ios",
    "createdAt": "2026-03-07T12:00:00Z"
  }
}
```

**특징**:
- 같은 deviceToken이 이미 있으면 lastUsedAt만 업데이트

---

### 3.2 디바이스 삭제

**Endpoint**: `DELETE /devices/:deviceId`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `204 No Content`

---

## 4. 기업 (Companies)

### 4.1 기업 검색 (자동완성)

**Endpoint**: `GET /companies/search`

**인증**: 불요 (게스트 열람 가능)

**Query Parameters**:
- `query` (required): 검색어 (예: "삼성")
- `limit` (optional): 결과 개수 (기본: 10, 최대: 20)

**Request Example**:
```
GET /companies/search?query=삼성&limit=5
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "corpCode": "00126380",
      "corpName": "삼성전자",
      "stockCode": "005930",
      "market": "KOSPI"
    },
    {
      "id": "clx...",
      "corpCode": "00164779",
      "corpName": "삼성물산",
      "stockCode": "028260",
      "market": "KOSPI"
    },
    {
      "id": "clx...",
      "corpCode": "00164742",
      "corpName": "삼성SDI",
      "stockCode": "006400",
      "market": "KOSPI"
    }
  ]
}
```

---

### 4.2 기업 상세 조회

**Endpoint**: `GET /companies/:corpCode`

**인증**: 불요 (게스트 열람 가능)

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "corpCode": "00126380",
    "corpName": "삼성전자",
    "stockCode": "005930",
    "market": "KOSPI"
  }
}
```

**Errors**:
- `404 Not Found`: 존재하지 않는 기업

---

### 4.3 인기 기업 목록 (온보딩용)

**Endpoint**: `GET /companies/popular`

**인증**: 불요 (게스트 열람 가능)

온보딩 화면에서 관심 기업 첫 등록을 돕는 인기 기업 목록을 반환한다. 응답 형태는 4.1 검색 결과와 동일한 기업 배열.

> 기업별 이벤트 스터디 통계 `GET /companies/:corpCode/event-study`(OptionalJwt)는 §16.3 참조.

---

## 5. 관심 목록 (WatchList)

### 5.1 관심 기업 목록 조회

**Endpoint**: `GET /watchlist`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "corpCode": "00126380",
      "corpName": "삼성전자",
      "stockCode": "005930",
      "market": "KOSPI",
      "lastDisclosureDate": "20260307",
      "newDisclosureCount": 3,
      "createdAt": "2026-03-07T12:00:00Z"
    },
    {
      "id": "clx...",
      "corpCode": "00164779",
      "corpName": "삼성물산",
      "stockCode": "028260",
      "market": "KOSPI",
      "lastDisclosureDate": "20260306",
      "newDisclosureCount": 0,
      "createdAt": "2026-03-06T10:00:00Z"
    }
  ],
  "meta": {
    "total": 2,
    "limit": 30
  }
}
```

- `newDisclosureCount`(DAR-165): 마지막 조회(`lastViewedAt`, 없으면 등록 시각) 이후 접수된 신규 공시 수. `0`이면 unread 배지 미표시. 종목 상세 진입 시 5.4 호출로 0으로 리셋.

---

### 5.2 관심 기업 등록

**Endpoint**: `POST /watchlist`

**Headers**: `Authorization: Bearer {accessToken}`

**Request Body**:
```json
{
  "corpCode": "00126380",
  "corpName": "삼성전자"
}
```

**Validation**:
- `corpCode`: 8자리 문자열, 필수
- `corpName`: 필수

**Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "corpCode": "00126380",
    "corpName": "삼성전자",
    "createdAt": "2026-03-07T12:00:00Z"
  }
}
```

**Errors**:
- `409 Conflict`: 이미 등록된 기업
- `422 Unprocessable Entity`: 최대 30개 초과

---

### 5.3 관심 기업 삭제

**Endpoint**: `DELETE /watchlist/:id`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `204 No Content`

**Errors**:
- `404 Not Found`: 존재하지 않는 관심 기업

---

### 5.4 관심 기업 조회 시각 갱신 (DAR-165)

**Endpoint**: `POST /watchlist/:corpCode/viewed`

**Headers**: `Authorization: Bearer {accessToken}`

종목 상세 진입 시 호출. 해당 관심 기업의 `lastViewedAt`을 현재 시각으로 갱신하여 신규 공시 unread 배지를 소거한다. 관심목록에 없는 종목이면 no-op(`updated: 0`).

**Response**: `200 OK`
```json
{
  "success": true,
  "data": { "updated": 1 }
}
```

---

## 6. 알림 설정 (Notification Settings)

### 6.1 알림 설정 조회

**Endpoint**: `GET /notification-settings`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "userId": "clx...",
    "disclosureTypes": ["정기공시", "주요사항보고", "발행공시"],
    "keywords": ["증자", "배당"],
    "isEnabled": true,
    "updatedAt": "2026-03-07T12:00:00Z"
  }
}
```

---

### 6.2 알림 설정 수정

**Endpoint**: `PATCH /notification-settings`

**Headers**: `Authorization: Bearer {accessToken}`

**Request Body**:
```json
{
  "disclosureTypes": ["정기공시", "주요사항보고"],
  "keywords": ["증자", "감자", "배당"],
  "isEnabled": true
}
```

**Validation**:
- `disclosureTypes`: 배열, 5개 유형 중 선택
  - "정기공시", "주요사항보고", "발행공시", "지분공시", "기타공시"
- `keywords`: 문자열 배열, 최대 10개
- `isEnabled`: Boolean (master 푸시 스위치)
- `signalPushEnabled` / `exitPushEnabled` / `thesisPushEnabled`: Boolean (DAR-85, 기본 OFF) — 신호·청산·논리훼손 푸시
- `tradePushEnabled`: Boolean (DAR-424, **기본 ON**) — 라이브 페이퍼 체결(매수/매도) 알림. OFF면 인박스·푸시 모두 생략(과알림 방지)
- `opsPushEnabled`: Boolean (DAR-473, **기본 ON**) — 운영·리스크 알림(`OPS_ALERT`/`RISK_ALERT`: 킬스위치 발동·크론 신선도 정체·수집/청산 실패·AI 비용 위반). OFF면 인박스·푸시 모두 생략(opt-out)

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "disclosureTypes": ["정기공시", "주요사항보고"],
    "keywords": ["증자", "감자", "배당"],
    "isEnabled": true,
    "updatedAt": "2026-03-07T13:00:00Z"
  }
}
```

---

## 7. 공시 (Disclosures)

### 7.1 공시 목록 조회

**Endpoint**: `GET /disclosures`

**인증**: OptionalJwt (게스트 열람 가능)

**Query Parameters**:
- `page` (optional): 페이지 번호 (기본: 1)
- `limit` (optional): 페이지당 개수 (기본: 20, 최대: 50)
- `corpCode` (optional): 기업 필터
- `disclosureType` (optional): 공시 유형 필터

**Request Example**:
```
GET /disclosures?page=1&limit=20&corpCode=00126380
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "rcpNo": "20260307000123",
      "corpCode": "00126380",
      "corpName": "삼성전자",
      "reportName": "주주총회소집공고",
      "rcpDt": "20260307120000",
      "flrName": "삼성전자",
      "rmk": "",
      "disclosureType": "정기공시",
      "createdAt": "2026-03-07T12:05:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

### 7.2 공시 상세 조회

**Endpoint**: `GET /disclosures/:rcpNo`

**인증**: 불요 (게스트 열람 가능)

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "rcpNo": "20260307000123",
    "corpCode": "00126380",
    "corpName": "삼성전자",
    "reportName": "주주총회소집공고",
    "rcpDt": "20260307120000",
    "flrName": "삼성전자",
    "rmk": "",
    "disclosureType": "정기공시",
    "createdAt": "2026-03-07T12:05:00Z",
    "dartUrl": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260307000123"
  }
}
```

**Errors**:
- `404 Not Found`: 존재하지 않는 공시

---

### 7.3 공시 검색

**Endpoint**: `GET /disclosures/search`

**인증**: 불요 (게스트 열람 가능)

**Query Parameters**:
- `q` (required): 검색어 (공시명 또는 기업명)
- `page` (optional): 페이지 번호 (기본: 1)
- `limit` (optional): 페이지당 개수 (기본: 20, 최대: 50)

**Request Example**:
```
GET /disclosures/search?q=증자&page=1&limit=20
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "rcpNo": "20260307000456",
      "corpCode": "00164779",
      "corpName": "삼성물산",
      "reportName": "유상증자결정",
      "rcpDt": "20260307140000",
      "disclosureType": "발행공시",
      "createdAt": "2026-03-07T14:05:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

---

### 7.4 통합 검색 (기업 + 공시)

기업 검색(`/companies/search`)과 공시 검색(`/disclosures/search`)을 하나의 진입점으로 묶는다. 내부적으로 기존 두 도메인 서비스를 재사용하며 검색 로직을 중복 구현하지 않는다.

**Endpoint**: `GET /search`

**Query Parameters**:
- `q` (required): 통합 검색어 (기업명·종목코드·공시명). **2글자 미만이면 DB 조회 없이 빈 카테고리 묶음을 반환**한다.
- `companyLimit` (optional): 기업 카테고리 최대 건수 (기본: 10, 최대: 20)
- `disclosureLimit` (optional): 공시 카테고리 최대 건수 (기본: 10, 최대: 20)

**Request Example**:
```
GET /search?q=삼성&companyLimit=10&disclosureLimit=10
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "query": "삼성",
    "companies": {
      "items": [
        {
          "corpCode": "00126380",
          "corpName": "삼성전자",
          "stockCode": "005930",
          "market": "KOSPI"
        }
      ],
      "total": 1,
      "limit": 10
    },
    "disclosures": {
      "items": [
        {
          "rcpNo": "20260307000456",
          "corpCode": "00164779",
          "corpName": "삼성물산",
          "reportName": "유상증자결정",
          "rcpDt": "20260307140000",
          "disclosureType": "발행공시"
        }
      ],
      "total": 5,
      "limit": 10
    }
  }
}
```

> `companies.total`은 반환된 항목 수, `disclosures.total`은 공시 검색 전체 일치 건수(도메인 서비스 meta.total)를 그대로 전달한다.

---

### 7.5 '오늘의 공시' 수 조회 (최신 가용일 기준, DAR-420)

홈 요약 카드의 '최신 공시'(DAR-422 라벨, 구 '오늘의 공시')가 쓰는 집계. **기준일 = 최신 가용 공시일 = `max(rcpDt)`의 날짜(YYYYMMDD)**이며, 그 날짜의 공시 건수를 반환한다. 전체 누적 건수(목록 `meta.total`, 약 137만)도, 환경시계 today(데이터 미수집 시 0건)도 아니다 — 분봉 단타의 tradeDate가 최신 가용 거래일을 쓰는 것과 동일한 point-in-time 정합. 게스트 조회 가능(인증 불요). **응답 `date`(YYYYMMDD)는 모바일에서 MM/DD 날짜칩으로 라벨 옆에 표기** — DART 데이터 최신일이 달력 today보다 뒤처질 수 있어(주말·미게시) '오늘' 표현이 혼란을 유발했기에 DAR-422에서 '최신 공시 (MM/DD)'로 명확화.

**Endpoint**: `GET /disclosures/today-count`

**Request Example**:
```
GET /disclosures/today-count
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "date": "20260619",
    "count": 151
  }
}
```

- `date`: 최신 가용 공시일 `YYYYMMDD`(라벨 보조표기용). 공시가 한 건도 없으면 `null`.
- `count`: 그 날짜의 공시 건수(`rcpDt` 날짜 prefix 일치 기준). 데이터 없으면 `0`.

> `rcpDt`는 `YYYYMMDD` 또는 `YYYYMMDDHHmmss` 혼재 형식이라, 날짜 prefix(앞 8자리) `startsWith`로 동일일을 판정한다(`@@index([rcpDt])` 범위 스캔). 백필 공시 포함 여부와 무관하게 홈 피드와 동일하게 전량 카운트한다.

---

### 7.6 공시 유형 목록 조회

**Endpoint**: `GET /disclosures/types`

**인증**: 불요 (게스트 열람 가능)

필터 UI에 쓰는 공시 유형(정기공시·주요사항보고·발행공시·지분공시·기타공시) 목록을 반환한다.

---

### 7.7 공시 AI 분석 결과 조회

**Endpoint**: `GET /disclosures/:rcpNo/analysis`

**인증**: 불요 (게스트 열람 가능)

Engine2가 산출한 해당 공시의 AI 분석(`DisclosureAnalysis`) — 요약·polarity(극성)·Persona 해석 — 을 반환한다. 분석이 없으면 빈 상태로 흡수(모바일 공시 상세 AI 카드 미표시).

---

### 7.8 미국 주식 알림 수요 기록 (갭분석 W8)

**Endpoint**: `POST /search/us-demand`

**인증**: OptionalJwt (게스트 호출 가능 — 토큰 있으면 `userId` 동반 기록)

**Request Body**:
```json
{
  "q": "애플"
}
```

**Response**: `201 Created`
```json
{ "success": true }
```

- 계측 전용 경량 엔드포인트 — 검색 제로결과 화면의 "미국 주식 알림 원해요" 원탭 버튼이 호출하며, `SearchMissLog`에 `tag=US_DEMAND_TAP`으로 적재한다. **기능 약속 아님**(M13A-Lite 수요 실증 게이트의 계측 데이터, §로드맵 M13A-Lite 참조).
- 같은 W8에서 `GET /search`(§7.4)에 `OptionalJwtAuthGuard`가 부착됐다 — 게스트 검색은 종전대로 통과하고, **제로결과 검색어**가 분류기(`search-miss.classifier` — 미국 티커/영문 기업명 휴리스틱)를 거쳐 `SearchMissLog`에 자동 적재된다(수요 계측 하한 추정치).

---

### 7.9 유사공시 반응 통계 (Wave A·A1, DAR-511)

**Endpoint**: `GET /disclosures/:rcpNo/event-stats`

**인증**: 불요 (게스트 열람 — 공시 상세 `GET /disclosures/:rcpNo`와 동일 노출 수준)

해당 공시의 이벤트 유형에 대한 **과거 유사공시 실제 주가 반응**(유형별 D+1/D+5/D+20 누적 평균수익률·상승비율·표본수 n)을 반환한다. 점수(권고)가 아니라 과거 사실(통계)이라 유사투자자문 게이트 밖 — '봉인된 신호'의 합법 대체 셀링포인트(플랜 §2-2). 모바일 공시 상세·에디션 카드의 '과거 유사공시 반응' 섹션(A2)이 소비한다.

데이터 원천(관측을 집계)은 `EventStudyObservation`(공시별 관측치, 이벤트당 1행)을 이벤트 유형으로 직접 집계한 값이다. `avgReturn`(실제 주가 반응)은 종목 일별 단순수익률(`dailyReturns`)을 D+N까지 누적 합산한 평균, `avgAbnormalReturn`은 시장 대비 초과수익(`cumulativeAR`, AR) 누적 평균, `winRate`는 누적 단순수익률>0 관측치 비율이다. 표본수 n은 §12(신호) `sampleCountByEventType`가 코어스 버킷(`marketType='ALL'`, `bucketKey='__ALL__'`)에 집계하는 것과 **동일한 EventStudy 표본**을 유형별 관측치에서 직접 센 값 — 코어스 집계행이 없는 단일버킷 유형까지 포함해 결정적이며, D+1/D+20 상승비율처럼 코어스행이 보유하지 않는 지표까지 같은 표본에서 일관 산출한다. 이벤트 유형 스냅샷은 KST **일1회 캐시**(무거운 관측치 집계를 하루 1회로 제한). 마이그레이션 0·읽기 전용(M10 무오염).

**정직 규약(핵심)**: 표본 tier는 계산기가 `n<10 → INSUFFICIENT`, `10≤n<30 → PRELIMINARY`(통계값은 채워짐), `n≥30 → READY`로 판정한다. `PRELIMINARY`는 값이 있어 status만 보면 "승률 100%(n=3)" 같은 소표본 허수가 노출될 수 있으므로, 게이트는 status가 아니라 **표본수 n ≥ 30**(통계 유의 READY 임계 `MIN_SAMPLE_SIZE`와 동일 상수)으로 강제한다 → `n<30`이면 `stats=null` + `reason='INSUFFICIENT_SAMPLE'`(단, `n`·산출기간·기준일은 투명하게 노출).

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `rcpNo` (path) | string | 필수 | 공시 접수번호(`Disclosure.rcpNo`) |

**응답** (`200 OK`) — `DisclosureEvent.rcpNo`가 `@unique`(공시 1건=이벤트 1건)라 `results`는 유형 1개(또는 이벤트 미추출 시 빈 배열):

```jsonc
{
  "success": true,
  "data": {
    "rcpNo": "20260608900497",
    "minSampleSize": 30,
    "generatedAt": "2026-07-16T17:31:55.990Z",   // 응답 생성 시각(일1회 캐시 표면)
    "results": [
      {
        "eventType": "SUPPLY_CONTRACT",
        "sampleCount": 1871,                        // n (관측치 수)
        "stats": {                                  // n<30이면 null
          // avgReturn=실제 주가 반응(단순수익률 누적 %), avgAbnormalReturn=시장대비 초과수익(%, 결측 시 null), winRate=상승비율(0~1)
          "d1":  { "avgReturn": 0.179, "avgAbnormalReturn": -0.263, "winRate": 0.512 },
          "d5":  { "avgReturn": 1.204, "avgAbnormalReturn": 0.331,  "winRate": 0.548 },
          "d20": { "avgReturn": 3.472, "avgAbnormalReturn": 1.088,  "winRate": 0.531 }
        },
        "reason": null,           // n<30이면 'INSUFFICIENT_SAMPLE'
        "period": { "fromDate": "20250620", "toDate": "20260511" },  // 산출기간(YYYYMMDD, 관측치 D0 최소~최대)
        "calculatedAt": "2026-07-02T11:50:27.312Z"                   // 기준일(관측치 최신 영속 시각)
      }
    ]
  }
}
```

**표본 부족(n<30) 예시** — `stats=null`이지만 `n`·기간·기준일은 노출(투명성):

```jsonc
{
  "success": true,
  "data": {
    "rcpNo": "20260602000482",
    "minSampleSize": 30,
    "generatedAt": "2026-07-16T17:31:55.994Z",
    "results": [
      { "eventType": "MAJOR_HOLDER_5PCT", "sampleCount": 0, "stats": null,
        "reason": "INSUFFICIENT_SAMPLE", "period": null, "calculatedAt": null }
    ]
  }
}
```

> 이벤트가 아직 추출되지 않은(신규·미수집) 공시는 `results: []`(빈 상태, 에러 아님) → 모바일은 섹션 미표시. eventType의 **한국어 라벨은 모바일 SSOT**(`mobile/utils/disclosureType.ts` `EVENT_TYPE_LABEL`)가 소유 — 응답은 enum 원값만 싣는다. 라우트는 EventStudy(engine3) 컨트롤러 소속이지만 경로가 `/disclosures`라 본 섹션에 둔다(§16 이벤트 스터디도 교차 참조).

---

## 8. 알림 히스토리 (Notifications)

### 8.1 알림 목록 조회

**Endpoint**: `GET /notifications`

**Headers**: `Authorization: Bearer {accessToken}`

**Query Parameters**:
- `page` (optional): 페이지 번호 (기본: 1)
- `limit` (optional): 페이지당 개수 (기본: 20, 최대: 50)
- `isRead` (optional): 읽음 필터 (true | false)
- `type` (optional, DAR-161): 알림 타입 필터 (`DISCLOSURE` | `SIGNAL` | `EXIT` | `THESIS_VIOLATED` | `TRADE_ENTRY` | `TRADE_EXIT` | `RISK_ALERT` | `OPS_ALERT`). 미지정 시 전체 타입. (`TRADE_ENTRY`/`TRADE_EXIT`: DAR-424 라이브 페이퍼 체결 알림 · `RISK_ALERT`/`OPS_ALERT`: DAR-473 운영·리스크 알림)
- `category` (optional, DAR-430): 알림 카테고리(4 버킷) 필터 — `disclosure`(공시=DISCLOSURE) | `signal`(신호=SIGNAL·EXIT·THESIS_VIOLATED) | `trade`(체결=TRADE_ENTRY·TRADE_EXIT) | `system`(운영·리스크=RISK_ALERT·OPS_ALERT, DAR-473). 미지정 시 전체. **`category` 지정 시 `type` 보다 우선**(버킷의 타입들을 `IN` 으로 묶어 조회).

**Request Example**:
```
GET /notifications?isRead=false&page=1&limit=20
GET /notifications?type=SIGNAL&page=1&limit=20
GET /notifications?category=trade&page=1&limit=20
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "disclosureRcpNo": "20260307000123",
      "sentAt": "2026-03-07T12:10:00Z",
      "isRead": false,
      "readAt": null,
      "disclosure": {
        "rcpNo": "20260307000123",
        "corpCode": "00126380",
        "corpName": "삼성전자",
        "reportName": "주주총회소집공고",
        "disclosureType": "정기공시"
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 10,
    "unreadCount": 5,
    "unreadByType": {
      "DISCLOSURE": 3,
      "SIGNAL": 1,
      "EXIT": 1,
      "THESIS_VIOLATED": 0,
      "TRADE_ENTRY": 0,
      "TRADE_EXIT": 0
    },
    "unreadByCategory": {
      "disclosure": 3,
      "signal": 2,
      "trade": 0
    }
  }
}
```

> `unreadByType` (DAR-161): 타입별 미읽음 카운트. **타입 필터와 무관하게 사용자 전체(미읽음) 기준**으로 집계되어, 모바일 세그먼트 칩의 타입별 unread 배지가 현재 선택과 독립적으로 동작한다. 모든 타입 키는 항상 존재(미읽음 없으면 0).
>
> `unreadByCategory` (DAR-430): 카테고리(3 버킷)별 미읽음 카운트 — `unreadByType` 를 `disclosure`/`signal`/`trade` 로 합산. 모바일 알림탭 카테고리 필터 칩의 unread 배지에 사용. 세 키 항상 존재(0 포함).

> **Android 알림 채널화 (DAR-430)**: 푸시 발송 시 NotificationType → 카테고리 → 채널 ID(`disclosure`/`signal`/`trade`)를 산출해 Expo Push 메시지의 `channelId` 와 `data.channelId` 에 실어 보낸다. 모바일은 앱 시작 시 `setNotificationChannelAsync` 로 동일 ID 의 채널 3개를 등록(공시=DEFAULT 중요도, 신호·체결=HIGH·소리) → OS 가 채널별로 묶어 표시·누적·중요도를 분리한다. iOS 는 채널 개념이 없어 `channelId` 가 무시되며, 카테고리 구분은 인앱 아이콘·필터가 담당한다(크로스플랫폼 폴백). 체결 알림 제목의 `[전략]` 대괄호 프리픽스는 제거됐고, 출처는 **출처명 텍스트**(예: `단타 · 삼성전자 매수` — 2026-07-06 이모지 제거 개정)로 제목 앞에 표기된다(DAR-432 §20.1)·`data.source`/`data.strategyKey` 동봉.

---

### 8.2 알림 읽음 처리

**Endpoint**: `PATCH /notifications/:id/read`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "isRead": true,
    "readAt": "2026-03-07T15:00:00Z"
  }
}
```

**Errors**:
- `404 Not Found`: 존재하지 않는 알림

---

### 8.3 알림 모두 읽음 처리

**Endpoint**: `PATCH /notifications/read-all`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "updatedCount": 5
  }
}
```

---

### 8.4 알림 삭제

**Endpoint**: `DELETE /notifications/:id`

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `204 No Content`

---

## 9. 에러 코드

| 코드 | HTTP Status | 설명 |
|------|-------------|------|
| `INVALID_CREDENTIALS` | 401 | 잘못된 이메일 또는 비밀번호 |
| `UNAUTHORIZED` | 401 | 인증 필요 |
| `INVALID_TOKEN` | 401 | 유효하지 않은 토큰 |
| `TOKEN_EXPIRED` | 401 | 만료된 토큰 |
| `FORBIDDEN` | 403 | 권한 없음 |
| `NOT_FOUND` | 404 | 리소스 없음 |
| `EMAIL_ALREADY_EXISTS` | 409 | 이미 존재하는 이메일 |
| `DUPLICATE_WATCHLIST` | 409 | 이미 등록된 관심 기업 |
| `VALIDATION_ERROR` | 422 | 입력값 검증 실패 |
| `WATCHLIST_LIMIT_EXCEEDED` | 422 | 관심 기업 최대 개수 초과 (30개) |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate Limit 초과 |
| `INTERNAL_SERVER_ERROR` | 500 | 서버 내부 오류 |

---

## 10. AI 비용 거버넌스 (AI Cost Governance)

> **인증 불필요** (내부 대시보드용 읽기 전용 API). Engine2 `AIUsageLog` 집계 기반.

### 10.1 비용 지표 조회

```
GET /api/ai-cost/metrics
```

| 쿼리 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `from` | string (ISO date) | 선택 | 집계 시작일 (기본: 당월 1일) |
| `to` | string (ISO date) | 선택 | 집계 종료일 (기본: 오늘) |

**응답**:
```json
{
  "success": true,
  "data": {
    "totalCostUsd": 0.0085,
    "callCount": 12,
    "l0Ratio": 0.75,
    "costPerDisclosure": 0.00071,
    "l0Warning": false
  }
}
```

- `l0Warning`: L0 비율 < 70%일 때 `true` (비용 이상 경보)

---

### 10.2 일별 AI 비용 집계

```
GET /api/ai-cost/daily
```

| 쿼리 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `date` | string (ISO date) | 선택 | 조회 날짜 (기본: 오늘) |

**응답**:
```json
{
  "success": true,
  "data": {
    "totalCostUsd": 0.0023,
    "callCount": 4,
    "totalInputTokens": 850,
    "totalOutputTokens": 350,
    "l0Count": 3,
    "l1Count": 1,
    "l2Count": 2,
    "l3Count": 1,
    "l0Ratio": 0.75,
    "byTask": {
      "summary": { "costUsd": 0.001, "callCount": 2 },
      "event-classification": { "costUsd": 0.0003, "callCount": 1 },
      "persona-interpretation": { "costUsd": 0.0005, "callCount": 1 },
      "position-thesis": { "costUsd": 0.001, "callCount": 1 },
      "price-move-reasoning": { "costUsd": 0.0004, "callCount": 1 }
    }
  }
}
```

- `byTask.price-move-reasoning`: DAR-522 역방향 리즈닝(§10.8) 태스크 비용·호출 수(다른 4종과 동일 집계 편입).

---

### 10.3 월별 AI 비용 집계

```
GET /api/ai-cost/monthly
```

| 쿼리 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `year` | number | 선택 | 연도 (기본: 현재 연도) |
| `month` | number | 선택 | 월 1~12 (기본: 현재 월) |

**응답**: `10.2`와 동일 구조.

---

### 10.4 비용 한도 현황

```
GET /api/ai-cost/limit-status
```

**응답**:
```json
{
  "success": true,
  "data": {
    "dailyCostUsd": 0.42,
    "dailyLimitUsd": 1.0,
    "dailyExceeded": false,
    "monthlyCostUsd": 8.50,
    "monthlyLimitUsd": 20.0,
    "monthlyExceeded": false,
    "forcedLevel": null
  }
}
```

- `forcedLevel`: `"L0"` = 한도 초과로 AI 호출 차단 중 / `null` = 정상

---

### 10.5 Cross-engine 비용 지표

```
GET /api/ai-cost/cross-engine
```

| 쿼리 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `from` | string (ISO date) | 선택 | 기본: 당월 1일 |
| `to` | string (ISO date) | 선택 | 기본: 오늘 |

**응답**:
```json
{
  "success": true,
  "data": {
    "costPerDisclosure": 520.5,
    "costPerSignal": 2600.0,
    "costPerTrade": 8666.7,
    "aiCostToNetPnlRatio": -1
  }
}
```

단위: KRW (1 USD = 1,380원 환산). `aiCostToNetPnlRatio = -1`은 순익 없음.

---

### 10.6 라이브 AI 비용게이트 헬스

```
GET /api/ai-cost/health
```

라이브 AI 비용게이트 상시 모니터링 헬스 — 수용기준·한도 충족 플래그를 반환한다(read-only).

---

### 10.7 AI 분석 커버리지 계기판 (갭분석 W10)

```
GET /api/ai-cost/coverage?days=7
```

"AI 카드가 언제 채워질지 보장 못 함"이라는 SLA 공백의 **측정 기반** — 최근 N일 대상 공시(윈도 내 수신 + 이벤트 추출 완료 + 라이브 `isBackfill=false`) 대비 분석 생성률(%)과 수신→생성 지연(P50/P95, 초)을 기존 테이블(`Disclosure`·`DisclosureEvent`·`DisclosureAnalysis`)만으로 집계한다(read-only·AI 신규 호출 0).

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `days` | number | 선택 | 조회창(일). 기본 7, 최대 90 클램프 |

**Response** (`data`: `AiCoverageSnapshot`):
```jsonc
{
  "windowDays": 7,
  "from": "2026-07-09T00:00:00.000Z",
  "to": "2026-07-16T00:00:00.000Z",
  "targetCount": 412,        // 대상 공시 수
  "analyzedCount": 398,      // DisclosureAnalysis 1건 이상 생성된 공시 수
  "coverageRatePct": 96.6,   // 대상 0건이면 100 (표본 없음 graceful — 제로런 아님)
  "latency": { "p50Sec": 210, "p95Sec": 1830, "sampleCount": 398 }
}
```

- 같은 W10에서 AI 백필 일일 예산·월간 하드캡이 ENV화됐다(월캡 기본 20→31 — 일캡 $1×31일 정합, prod ENV로 하향 가능). 공시 상세의 AI 빈 카드는 이 지표 기반 기대치 문구로 정직화(모바일).

---

### 10.8 PRICE_MOVE 역방향 리즈닝 — '왜 움직였나' (DAR-522 C1 생성 / DAR-526 C2 조회, Wave C·P0)

> **생성(write)은 HTTP 엔드포인트 없음(내부 AI Task).** engine3 `price-move-alert`가 관심종목 급변동(±5%)을 발화하면 BullMQ 큐(`price-move-reason`)로 등락 이벤트가 전달되고, engine2 `PriceMoveReasoningService`(5번째 AI Task)가 소비한다. 산출물은 `price_move_reasonings` 테이블(§37, `database-schema.md`)에 refId(등락 이벤트) 멱등으로 저장된다.
>
> **조회(read)는 `GET /api/price-move-reasonings/:refId`(DAR-526 신설, 아래).** FE '3상태 카드'(DAR-524)가 이 읽기 전용 엔드포인트로 적재 결과 1건을 소비한다 — 생성 경로와 분리된 조회 표면(AI 호출·비용게이트·AIUsageLog 무접점, 마이그레이션 0).

**흐름 (등락 이벤트 1건)**
1. **멱등 캐시** — `refId=<stockCode>-<YYYYMMDD>` 기존 결과가 있으면 AI 재호출 0.
2. **48h 공시 조회** — 해당 종목 최근 48시간 공시(백필 제외).
3. **무공시 → AI 호출 0** — `status=NO_DISCLOSURE`, 포맷 응답 `label="관련 공시 없음(48h)"` 저장(분석 위장 금지).
4. **일일 비용 상한(env) 초과 → AI 호출 0** — `status=CAP_SKIPPED`.
5. **비용게이트 L0~L3 편입 + 전역 한도가드** — L0 강등 시 AI 스킵(`CAP_SKIPPED`).
6. **AI 원인 해석(설명층 한정)** — 프롬프트 주입: 공시 이벤트 유형 + 등락 방향/폭 + **EventStudy 유사사례 통계**(D+1/D+5/D+20, n≥30 게이트). 출력 JSON: `{ cause, evidence[], eventLinkage: STRONG|MODERATE|WEAK|UNCLEAR, caveat }`.
7. **재무 맥락 한 줄(DAR-528)** — `CompanyFinancial` 최신 연간 매출(분모)을 조회해 인과 공시 규모(분자) 대비 비율을 `resultJson.financialContext`에 산출·적재. **규칙 기반·AI 호출 0**. 분자/분모 결측·불확실이면 `null`(§10.8.1 참조, 수치 발명 금지).
8. **AIUsageLog 기록(누락 0)** — task=`price-move-reasoning` · `refId` 멱등 저장(`status=ANALYZED`).

**비용 상한 (env)**

| ENV | 기본값 | 설명 |
|---|---|---|
| `PRICE_MOVE_REASONING_DAILY_USD_LIMIT` | `0.5` | 이 태스크 전용 일일 예산(USD). 초과 시 AI 호출 0(`CAP_SKIPPED`). 전역 `AI_DAILY_LIMIT_USD`($1)·`AI_MONTHLY_LIMIT_USD`($31) 하드백스톱과 **중첩** 강제. |

**AI 금지영역 무침범**: 산출 스키마는 **설명(원인 해석·근거)뿐** — 매수/매도/보유 권고·목표가·투자의견·점수·주문 필드가 없다(화이트리스트 검증이 위장 필드도 제거). Engine5 Risk·주문·하드룰 경로와 무접점.

#### 10.8.1 조회 — `GET /api/price-move-reasonings/:refId` (DAR-526, Wave C/C2·P0, 읽기 전용)

FE '왜 움직였나' 카드(DAR-524)가 적재된 리즈닝 1건을 조회 소비한다. 인증 불필요·마이그레이션 0·AI 무접점.

- **path param** `refId` — 등락 이벤트 자연키 `<stockCode>-<YYYYMMDD>`(`PriceMoveReasoning.refId @unique`).
- **200** — `{ success: true, data }`. `data`는 `price_move_reasonings` 행 1건(정본 계약: mobile `types/priceMove.types.ts`):

```jsonc
{
  "success": true,
  "data": {
    "refId": "005930-20260717",
    "stockCode": "005930",
    "corpCode": "00126380",
    "corpName": "삼성전자",        // Company 조인(표시용). 미존재 시 null → FE 는 stockCode 폴백
    "tradeDate": "20260717",
    "changePct": 6.3,
    "rcpNo": "20260717000123",      // causal 공시 접수번호(무공시 케이스는 null)
    "status": "ANALYZED",           // ANALYZED | NO_DISCLOSURE | CAP_SKIPPED
    "resultJson": { /* status 판별 유니온 */ },
    "createdAt": "2026-07-17T05:30:00.000Z"
  }
}
```

  - `resultJson` — `status`로 판별하는 유니온:
    - `ANALYZED`: `{ status:'ANALYZED', eventType, cause, evidence[], eventLinkage:'STRONG'|'MODERATE'|'WEAK'|'UNCLEAR', caveat, financialContext }`
    - `NO_DISCLOSURE`: `{ status:'NO_DISCLOSURE', label, message }`
    - `CAP_SKIPPED`: `{ status:'CAP_SKIPPED', message }`
  - `financialContext`(DAR-528, ANALYZED만) — **재무 맥락 한 줄**(`string|null`). 인과 공시의 규모(분자, 예: 공급계약 계약금액)를 **최신 연간 매출(분모, `CompanyFinancial` reprtCode=11011)** 대비 비율로 표기(예: `"이번 계약 규모는 2025 연매출의 약 12.3% (1230억 / 연매출 1조)"`). ★분자·분모 중 하나라도 결측/불확실(분기·반기 누적 매출 등)이면 **`null`**(표시 생략) — 수치 발명 금지(정직 원칙). 규칙 기반 산출·**AI 호출 0**(비용게이트/AIUsageLog 무영향). 구 APK 무해(옵셔널). 생성 시점 스냅샷(생성 경로에서 `resultJson`에 적재, 조회는 그대로 노출).
  - 내부 전용 `level`(비용 등급)은 응답에서 제외한다.
- **404** — 미존재 refId → `{ success:false, error:{ code:'PRICE_MOVE_REASONING_NOT_FOUND', message } }`(FE 는 '로딩실패' 상태로 정직 degrade).

#### 10.8.2 PRICE_MOVE 푸시 딥링크 재타겟 (DAR-526)

engine3 `price-move-alert.service`의 PRICE_MOVE 발화 페이로드 `deepLink`를 `/company/<corpCode>`(기업상세)에서 **`/price-move/<refId>`('왜 움직였나' 카드)**로 재타겟한다. FE 딥링크 해석기(mobile `utils/deeplink.ts`)는 이 경로를 화이트리스트(`/price-move`)로 통과시키며, `deepLink` 미충전 시에도 `type:'PRICE_MOVE'`·`refId` 폴백이 동일 카드로 라우팅한다.

---

## 11. Persona 모의운용 + 현재 장 적합 추천 (DAR-130)

persona(거장 철학) 4종(VALUE≡버핏 / GROWTH≡린치 / QUANTITATIVE≡그린블라트 / MACRO≡드러켄밀러)을
독립 모의 포트폴리오로 분기 운용(DAR-76 재사용)하고, 현재 시장 레짐(추세·변동성·이벤트분포)과 최근
성과(수익률·MDD·적중률)를 **결정론적 규칙**으로 결합해 적합 persona 1~2개를 추천한다. AI 미개입.
신뢰 원칙: 표본 < 30 이면 `dataLimited=true`(미유의) 표기.

### 11.1 persona별 성과 + 현재 장 추천

```
GET /api/paper-trading/personas       (OptionalJwt — 게스트 데모)
```

**응답**:
```json
{
  "success": true,
  "data": {
    "initialCapital": 10000000,
    "regime": {
      "trend": "UPTREND", "volatility": "HIGH", "eventSkew": "OPPORTUNITY",
      "trendChangePct": 8.4, "dailyVolatilityPct": 1.7,
      "indexSampleSize": 35, "eventSampleSize": 50,
      "classifiable": true, "dataLimited": false, "asOf": "20260608"
    },
    "personas": [
      {
        "performance": { "style": "DRUCKENMILLER", "label": "드러켄밀러", "scorecard": { "...": "..." }, "graduation": { "...": "..." } },
        "archetype": "MACRO", "regimeFitScore": 87, "compositeScore": 76.2,
        "recommended": true, "rationale": "드러켄밀러(MACRO): 현재 장(상승추세·고변동성·호재 우세) 적합도 87점, ..."
      }
    ],
    "recommended": ["DRUCKENMILLER", "LYNCH"],
    "dataLimited": false,
    "significantSampleThreshold": 30,
    "lowSampleThreshold": 5,
    "minEntryFit": 50
  }
}
```

### 11.2 현재 시장 레짐

```
GET /api/paper-trading/personas/regime   (OptionalJwt — 게스트 데모)
```

추세·변동성·이벤트분포 레짐만 반환(위 `regime` 객체와 동일 구조).

### 11.3 persona 4종 1일치 사이클 수동 실행

```
POST /api/paper-trading/personas/run-once   (JWT 필수 — 쓰기)
```

| 바디 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `date` | string (YYYYMMDD) | 선택 | 기본: 오늘 |

persona별 독립 포트폴리오에 1일치 사이클(적합도 진입 → 시가평가 → Exit) 분기 실행. ★모의 전용.

### 11.4 자동매매 실행상태(읽기전용 투명성) — DAR-361

```
GET /api/trading/auto-status   (OptionalJwt — 게스트 데모)
```

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `recentLimit` | number | 선택 | 최근 주문 건수(기본 3, 상한 20). 비숫자/음수/거대값은 안전 보정. |

자동매매 신뢰=실행상태 가시성. **킬스위치 상태**(발동/대기·사유·시각)·**리스크게이트 차단여부**(정상/주문 차단중·사유)·**최근 주문**(상태·사유·시각, 없으면 빈배열)을 read-only 로 집계해 노출한다. 기존 KillSwitchManager(영속 상태, DAR-350)·OrderRequest 모델만 읽으며 Risk/주문/AI 판정·쓰기는 일절 없다(AI 금지영역 미접촉).

★범위 정직: M11 주문 실행 루프는 미인가 — `executionEnabled`는 항상 `false`, `notice`로 정직 고지("자동 실행은 준비중 — 현재는 상태 모니터링만 제공합니다."). 표준 standing 차단원은 킬스위치 발동(유일)이며, 손실·비중 등 하드룰은 주문 시점마다 건별 평가된다.

**Response 200**

```json
{
  "success": true,
  "data": {
    "killSwitch": { "isActive": false, "reason": null, "triggeredBy": "SYSTEM", "activatedAt": null },
    "riskGate": { "blocked": false, "status": "NORMAL", "blockedReason": null },
    "recentOrders": [
      { "id": "ord_x", "stockCode": "005930", "side": "BUY", "requestedShares": 10, "status": "REJECTED", "reason": "SINGLE_BUY_LIMIT", "createdAt": "2026-06-19T01:00:00.000Z" }
    ],
    "executionEnabled": false,
    "notice": "자동 실행은 준비중 — 현재는 상태 모니터링만 제공합니다.",
    "asOf": "2026-06-19T04:54:28.979Z"
  }
}
```

소비 화면: `app/portfolio/auto-trading.tsx`(자동매매 상태 — 킬스위치 배지·리스크게이트·최근 실행/감사 트레일·정직 고지). 30초 폴링(포그라운드 한정). 전체 감사 이력은 `GET /api/trading/audit-logs`(운영자 JWT, DAR-351).

## 12. 매매 신호 (Signals, Engine3)

### 12.1 종목별 최신 신호 단건 조회 (DAR-159)

```
GET /api/signals/by-corp/:corpCode   (JWT 필수)
```

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `corpCode` | string | 필수 | DART 기업 고유번호(8자리) |

해당 종목의 **최신 매수 신호 1건**(등급·점수·진입준비)을 단건 반환한다. 백필(과거 분석 baseline) 공시 기반 신호는 제외(피드와 동일 방어, DAR-129). 신호가 없는 종목은 `data: null` → 호출측이 빈상태로 흡수. 종목 상세 화면(`company/[corpCode]`) 헤더 신호 배지가 소비한다.

**Response 200 (신호 있음)**

```json
{
  "success": true,
  "data": {
    "id": "sig_xxx",
    "corpCode": "00126380",
    "corpName": "삼성전자",
    "ticker": "005930",
    "eventType": "SUPPLY_CONTRACT",
    "grade": "BUY",
    "buyScore": 72,
    "entryReady": true,
    "summary": "…",
    "relatedDisclosureRcpNo": "20240101000001",
    "expiresAt": "2024-01-10T00:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

`grade`: `STRONG_BUY | BUY | WATCH | NEUTRAL | AVOID | BLOCKED` (모바일 6단계 enum). 신호 없으면 `data: null`.

### 12.2 공시(rcpNo) → 매수 신호 역조회 (DAR-208)

```
GET /api/signals/by-disclosure/:rcpNo   (JWT 필수)
```

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `rcpNo` | string | 필수 | DART 접수번호(14자리) |

해당 **공시로 생성된 최신 매수 신호 1건**을 단건 반환한다(공시 → 신호 역링크). 기존엔 신호 → 공시 단방향(`relatedDisclosureRcpNo`)만 존재해, 공시 상세에서 그 공시의 매수 신호로 가는 동선이 끊겨 있었다(intro Slide2 "공시→AI 매수점수" 약속 단절). 응답 형태는 `by-corp`(12.1)와 동일하며, 모바일 공시 상세(`disclosure/[id]`) AI섹션 '이 공시의 매수 신호' 진입 카드가 소비한다. 한 공시에 신호가 여러 건이면 최신(createdAt desc) 1건. 백필 공시 기반 신호는 제외(DAR-129). 신호가 없으면 `data: null` → 카드 미표시.

**Response 200 (신호 있음)**: 12.1과 동일한 배지 형태(`id`·`grade`·`buyScore`·`entryReady`·`relatedDisclosureRcpNo` 등). 신호 없으면 `data: null`.

### 12.3 매매 신호 목록 조회 (필터·페이지네이션)

```
GET /api/signals   (JWT 필수)
```

신호 피드의 기본 조회 경로. 필터·정렬·페이지네이션으로 매매 신호를 **목록** 반환한다.
백필(과거 분석 baseline) 공시 기반 신호는 항상 제외(피드 방어, DAR-129). 홈 '오늘의 투자판단'·신호 탭이
`grade=STRONG_BUY,BUY&sort=score&sinceDays=14`로 소비한다(DAR-193 + 최신성 윈도우).

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `grade` | string | 선택 | 신호 등급 (`STRONG_BUY`\|`BUY`\|`WATCH`\|`NEUTRAL`\|`AVOID`\|`BLOCKED`). 콤마로 다중 지정 가능: `"STRONG_BUY,BUY"` |
| `personaType` | string | 선택 | 페르소나 유형 (`GROWTH`\|`VALUE`\|`MOMENTUM`\|`EVENT_DRIVEN`) |
| `eventType` | string | 선택 | 공시 이벤트 유형 (`SUPPLY_CONTRACT` 등) |
| `entryReady` | boolean | 선택 | 진입 준비 여부 (`true`/`false`) |
| `sort` | string | 선택 | 정렬 (`score`: 점수 내림차순 \| `latest`: 최신순, 기본 `latest`). `score`는 동점 시 최신순으로 안정화 |
| `sinceDays` | number | 선택 | **최신성 윈도우(일)** — `createdAt ≥ now−N일` 신호만 반환. 1~90 클램프(음수·초과 보정), `0` 명시 시 윈도우 해제(전체 이력·구 동작). **미지정 기본값 규칙**: `sort=score` 는 **14일**(점수순 큐레이션이 전체 이력 고득점에 영원히 고정되는 정체 방지 — 파라미터를 모르는 구 APK 도 서버 기본값으로 즉시 최신성 획득), `sort=latest` 는 무윈도우(기존 동작 유지). 비숫자 입력은 미지정과 동일 |
| `page` | number | 선택 | 페이지 번호 (기본 1) |
| `limit` | number | 선택 | 페이지당 항목 수 (기본 20) |

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "sig_xxx",
      "corpCode": "00126380",
      "corpName": "삼성전자",
      "ticker": "005930",
      "eventType": "SUPPLY_CONTRACT",
      "grade": "BUY",
      "buyScore": 72,
      "summary": "…",
      "entryConditions": [
        { "id": "met_0", "label": "…", "required": true, "met": true },
        { "id": "unmet_0", "label": "…", "required": true, "met": false }
      ],
      "riskFlags": [
        { "id": "risk_0", "label": "…", "severity": "medium" }
      ],
      "blockedReason": null,
      "scoreBreakdown": [
        {
          "key": "historicalEvent",
          "label": "과거 이벤트",
          "score": 10,
          "max": 15,
          "sampleN": 1871,
          "sampleScope": "전체시장"
        }
      ],
      "relatedDisclosureRcpNo": "20240101000001",
      "expiresAt": "2024-01-10T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `data[]` | object | 신호 목록(각 항목은 12.1 단건과 동일 배지 + 진입조건·리스크·점수분해) |
| `data[].grade` | string | 모바일 6단계 enum (위 `grade` 쿼리와 동일 값) |
| `data[].ticker` | string\|undefined | 종목코드(6자리). 없으면 생략 |
| `data[].entryConditions[]` | object | 진입 조건 (`id`·`label`·`required`·`met`) |
| `data[].riskFlags[]` | object | 리스크 플래그 (`id`·`label`·`severity`) |
| `data[].scoreBreakdown[]` | object | 점수 구성 항목별 분해 (`key`·`label`·`score`·`max` + 통계 파생 항목 한정 `sampleN?`·`sampleScope?`) |
| `data[].scoreBreakdown[].sampleN` | number\|생략 | 통계 파생 항목(`historicalEvent`)의 EventStudy 표본수. 출처는 `EventStudyResult (marketType='ALL', bucketKey='__ALL__', status='READY')` **코어스 버킷 고정**(eventType당 유니크 1행 → 결정적). 집계 부재·비통계 항목은 키 자체 생략 |
| `data[].scoreBreakdown[].sampleScope` | string\|생략 | 표본 출처 스코프 라벨. `sampleN` 존재 시 항상 `"전체시장"`(코어스 버킷). 모바일이 `이벤트라벨(sampleScope)`로 괄호 병기 — 예: '표본 1,871건 · 대규모 공급계약(전체시장)'. `sampleN` 생략 시 함께 생략(하위호환: 필드 추가만, 기존 필드 불변) |
| `meta.page` / `meta.limit` | number | 적용된 페이지 파라미터 |
| `meta.total` | number | 필터 조건 전체 신호 수 |
| `meta.totalPages` | number | `ceil(total / limit)` |

> 동일 컨트롤러에는 청산 신호 목록 `GET /api/signals/exit`(JWT 필수, 아래 12.3.1)와 신호 상세 `GET /api/signals/:id`(JWT 필수)도 있다.

#### 12.3.1 청산 신호 목록 (DAR-559)

```
GET /api/signals/exit   (JWT 필수)
```

요청자(JWT) 소유 포트폴리오의 **OPEN 포지션**에 한정된 청산 신호만 반환한다. 포지션(`positionId`)당
최신 1건만 포함(과거 청산 이력 신호는 dedupe)하며, 최신순 최대 **50건** 상한이다. 응답 shape은
DAR-559 이전과 동일(하위 호환, 스코프·상한만 축소).

| 필드 | 타입 | 설명 |
|---|---|---|
| `data[].corpCode` / `corpName` / `ticker` | string | 종목 식별자 |
| `data[].exitScore` | number | 청산 점수 |
| `data[].action` | string | `ExitAction` enum |
| `data[].reasons[]` | object | 청산 사유 분해 |
| `data[].pnlPercent` | number\|undefined | 포지션 미실현 손익률 |
| `data[].blockRebuy` | boolean | 재진입 차단 여부(`action === BLOCK_REBUY`) |
| `data[].createdAt` | string | ISO8601 |

### 12.4 일일 투자판단 에디션 날짜 목록 (DAR-505)

```
GET /api/signals/daily-editions   (JWT 필수)
```

**Query Parameters**

| 파라미터 | 타입 | 설명 |
|---|---|---|
| `before` | string (YYYYMMDD) | 페이지 커서 — 이 날짜 미만의 에디션만 반환 |
| `limit` | number | 페이지 크기 (기본 7, 최대 90) |

**Response `data[]`** — 판단이 존재한 날짜만 최신순

| 필드 | 타입 | 설명 |
|---|---|---|
| `date` | string | KST 거래일 (YYYYMMDD — `before`/`nextCursor` 커서와 동일 형식. $queryRaw `to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD')` 파생 — created_at 은 UTC 저장 timestamp 라 이중 환산 필수) |
| `count` | number | 해당일 매수등급(STRONG_BUY+BUY) **유니크 종목(corpCode) 수**(DAR-553) — corpCode당 대표 1건으로 dedup 후 집계 |
| `strongBuyCount` | number | 그 중 대표 신호가 STRONG_BUY인 종목 수 |
| `topGrade` | string | 최고점 신호(유니크 종목 대표 중 1위) 등급 (STRONG_BUY \| BUY) |
| `headlineCorpName` | string | 최고점 신호 종목명 |

> **DAR-553 dedup(2026-07-17).** `TradingSignal` 자연키는 `(corpCode,rcpNo,eventType,persona)` — 공시 1건이 페르소나별로 최대 4장까지 개별 신호를 만들어, 이전에는 같은 종목이 `count`/스트립 dot에 최대 4배까지 부풀려졌다. 이제 `count`/`strongBuyCount`/`headlineCorpName`/`topGrade` 모두 **corpCode당 대표 1건**(최고 `buyScore`, 동점은 `createdAt desc → id desc`) 기준으로 집계한다. 개별 신호 원시 건수(페르소나 포함)가 필요하면 `GET /api/ops/edition-density`의 `buyGrade`(원시)와 `buyGradeUniqueCorp`(dedup, 이 엔드포인트와 1:1)를 대조한다.

**Response `meta`**

| 필드 | 타입 | 설명 |
|---|---|---|
| `latestDate` | string \| null | 시스템 전체 최신 에디션 날짜 (YYYYMMDD) |
| `todayDate` | string | 오늘 KST 날짜 (YYYYMMDD) |
| `todayHasEdition` | boolean | 오늘 에디션 존재 여부 |
| `nextCursor` | string \| undefined | 다음 페이지 `before` 커서 값 |
| `hasMore` | boolean | 다음 페이지 존재 여부 |

**에러 응답**

| 상태 | 조건 |
|---|---|
| 400 Bad Request | `before` 지정 시 `YYYYMMDD`(8자리 숫자, `/^\d{8}$/`) 형식이 아니면 `"before 파라미터는 YYYYMMDD 형식이어야 합니다"` |

> **응답 봉투·라우트 순서.** 두 에디션 엔드포인트 모두 `{ success: true, data: [...], meta: {...} }` 봉투로 감싼다. 컨트롤러에서 `daily-editions` → `daily/:date` → `by-corp/:corpCode` → `by-disclosure/:rcpNo` → **`:id`(catch-all)** 순으로 선언돼, 정적 경로가 `:id` 매칭에 흡수되는 라우트 충돌을 방지한다. `limit`은 서버에서 `[1, 90]` 클램프(기본 7). 빈 날짜는 목록에 포함하지 않는다(빈 날 발명 금지).

### 12.5 일일 투자판단 에디션 상세 조회 (DAR-505)

```
GET /api/signals/daily/:date   (JWT 필수)
```

**Path Parameters** — `date`: KST 거래일 (YYYYMMDD)

**Response `data[]`** — 해당일 매수등급(STRONG_BUY+BUY) **corpCode당 대표 1건** 랭킹(DAR-553). 각 item에 `rcpDt`(공시 접수일) 추가.

각 item은 `GET /api/signals` 응답 item과 동일하며 추가 필드:

| 필드 | 타입 | 설명 |
|---|---|---|
| `rcpDt` | string \| undefined | 공시 접수일 (Disclosure.rcpDt, YYYYMMDD 또는 YYYYMMDDHHmmss) |
| `personaCount` | number | DAR-553: 이 카드로 흡수된 페르소나 관점 수(대표 포함, 최소 1) |
| `otherPersonas` | string[] | DAR-553: 대표를 제외한 나머지 persona 목록(중복 제거). 없으면 `[]` — FE가 `length`로 '외 N개 관점' 표기 가능 |

> **DAR-553 dedup.** 같은 종목(`corpCode`)이 같은 날 여러 페르소나(`GROWTH`\|`VALUE`\|`MOMENTUM`\|`EVENT_DRIVEN`) 신호를 가지면, 그 중 `buyScore` 최고 1건만 카드로 노출하고(동점은 `createdAt desc → id desc`) 나머지는 `personaCount`/`otherPersonas`로 흡수한다. 서로 다른 `corpCode`는 dedup 대상이 아니다(과도 병합 금지).

**Response `meta`**

| 필드 | 타입 | 설명 |
|---|---|---|
| `date` | string | 요청 KST 날짜 (YYYYMMDD) |
| `isToday` | boolean | 오늘 여부 |
| `isEmpty` | boolean | 매수등급 신호 없음 여부 |
| `emptyReason` | string \| undefined | 빈 이유 (`CLOSED` \| `PENDING` \| `QUIET` \| `COLD_START` \| `FUTURE`). isEmpty=false 이면 undefined |
| `prevEditionDate` | string \| undefined | 이전 에디션 날짜 (YYYYMMDD) |
| `nextEditionDate` | string \| undefined | 다음 에디션 날짜 (YYYYMMDD) |
| `fallbackBriefing` | array \| undefined | **빈 에디션 폴백 '주요 공시 브리핑'**(DAR-551). isEmpty=true 이고 `emptyReason ∉ {CLOSED, FUTURE}` 일 때만 존재(그 외 undefined). 항목 없으면 `[]`. ↓ 아래 표 참조 |

**emptyReason 값**

| 값 | 조건 |
|---|---|
| `CLOSED` | 주말·공휴일(KRX 휴장일) — `isTradingDay()` false |
| `FUTURE` | 오늘 KST보다 미래인 거래일 |
| `PENDING` | 오늘이며 KST 19:15 이전 (engine3 미실행 휴리스틱) |
| `QUIET` | 과거 거래일, 신호 없음 |
| `COLD_START` | 시스템 최초 신호 이전 날짜 |

> PENDING↔QUIET 경계는 **KST 19:15**(신호 생성 크론 `0 19 * * 1-5` 완료 버퍼, `docs/workflow.md` §5.15).

**에러 응답**

| 상태 | 조건 |
|---|---|
| 400 Bad Request | `date`가 `YYYYMMDD`(8자리 숫자, `/^\d{8}$/`) 형식이 아니면 `"date 파라미터는 YYYYMMDD 형식이어야 합니다"` |

> 빈 날짜(휴장·미발행·조용·미래·콜드스타트)는 **404가 아니라** `data: []` + `meta.emptyReason`으로 정직하게 응답한다(다른 날 신호로 채우지 않음). 응답 봉투 `{ success: true, data, meta }`.

**`meta.fallbackBriefing[]` — 빈 에디션 폴백 '오늘의 주요 공시 브리핑' (DAR-551, 오너결정 A안)**

빈 날(매수판단 0)이 실측 85%다. 빈 에디션 상세 응답이 죽은 화면이 되지 않도록, 그 KST 거래일의 **주요 공시 top 5**를 브리핑으로 분리 노출한다. 존재 조건: `isEmpty=true` **그리고** `emptyReason ∈ {PENDING, QUIET, COLD_START}`(휴장 `CLOSED`·미래 `FUTURE`는 브리핑 대상 아님 → `undefined`, 조회 자체 생략). 해당 거래일 주요 공시가 없으면 `[]`.

| 필드 | 타입 | 설명 |
|---|---|---|
| `rcpNo` | string | DART 접수번호 (공시 딥링크 키) |
| `corpName` | string | 기업명 |
| `eventLabel` | string | 이벤트 라벨(한국어). 표기 SSOT: `notifications/push-body-template` `EVENT_PUSH_LEAD_LABEL`. 이벤트 미분류(`OTHER`·이벤트 없음)·미등록 타입 → `기타 공시` |
| `summaryLine` | string | 주요 내용 한 줄(공백 정규화 + 최대 100자 말줄임) |
| `summarySource` | `'AI'` \| `'TITLE'` | 한 줄의 출처 — 기존 AI 요약(summary task) 재사용이면 `AI`, 요약 캐시가 없어 공시 제목(reportName)으로 폴백했으면 `TITLE` |

**중요도 정렬**(이슈 명세 순): ①이벤트성(분류된 `DisclosureEvent` 존재, `OTHER` 제외) → ②시총(스키마 미보유 — **KOSPI 본판을 대용 프록시**로 사용) → ③AI 요약 존재 → ④최신·결정론 tiebreak(`rcpNo` 내림차순). 랭킹·`LIMIT 5`는 단일 `$queryRaw`가 수행(전일 로드 회피). 대상 공시는 그 거래일 `rcpDt` 범위 `[date, 다음날)` + `isBackfill=false`(백필 제외).

> **정직 불변식.** `fallbackBriefing`은 '판단'이 아니라 '주요 공시 브리핑'이다 — `data`(판단 item)와 물리적으로 분리되며, `daily-editions` 목록·count·본 응답 `data`는 **무변경**(빈 날은 여전히 판단 0). **신규 AI 호출 0**: 기존 `DisclosureAnalysis`(summary task) 캐시(`resultJson->>'summary'`)만 재사용하고, 캐시가 없으면 제목으로 폴백하되 `summarySource='TITLE'`로 출처를 정직 표기한다(AI가 쓰지 않은 줄을 AI 요약으로 위장하지 않음). 마이그레이션 0(스키마 무변경).

> **에디션 발행 푸시 딥링크 + '놓친 호' 뱃지 (DAR-527, Wave B/B3·P1).** 에디션 발행 푸시(`docs/workflow.md` §5.16, 평일 19:05)를 탭하면 신호탭 **'해당 호(거래일)' 직행**한다. 딥링크 계약은 `/signals?date=<editionDate>`(YYYYMMDD) — 모바일 신호탭이 `date` 쿼리를 초기 선택일로 해석해 이 엔드포인트(`GET /signals/daily/:date`)로 해당 호를 렌더한다. `/signals` prefix 의 쿼리 규칙으로 모바일 화이트리스트(`@utils/deeplink`)를 통과하므로 새 prefix·새 라우트가 필요 없다. `deepLink` 누락 시에도 `type=EDITION·refId(=editionDate)` 타입별 폴백으로 직행(3경로 — 포그라운드/백그라운드/콜드스타트, DAR-90 화이트리스트+DAR-154 콜드스타트 게이트 재사용). ✅ 발화 측 `deepLink` 재타겟(`/signals` → `/signals?date=<editionDate>`, `edition-push.guard.ts` `buildEditionPushContent`)은 **DAR-533(PR #510)로 완료** — 발행 푸시가 실제 날짜 쿼리를 실어 '해당 호 직행'이 end-to-end 동작한다(구 payload `/signals` 는 신호탭 최신 호로 무해 폴백). '놓친 호'(안 읽은 호) 뱃지는 **전적으로 클라이언트 로컬**(zustand persist·expo-secure-store, **서버 스키마 변경 0**)로 열람 기록을 관리한다 — 알림 '에디션 계열'(`editionPushEnabled`, DAR-514 기본 OFF) ON 시에만 노출(단일 토글로 푸시·뱃지 정합).

> **`sinceDays` 도입 배경(2026-07-07).** 점수순(`sort=score`) 큐레이션은 전체 이력에서
> `buyScore` 내림차순이라, 6월 고득점 신호가 이후 신규 신호가 나와도 영원히 상단에 고정돼
> 홈 '오늘의 투자판단'이 수 주째 미갱신됐다. `sort=score` 기본 14일 윈도우는 **서버측 기본값**
> 이므로 클라이언트 재배포 없이 즉시 적용되며, `sinceDays=0` 으로 언제든 전체 이력 조회
> (이전 동작)로 되돌릴 수 있다. `meta.total`/`totalPages` 도 동일 윈도우 기준으로 집계된다.

## 13. 종목 최신 시세 (Market Data Quote) — DAR-158

적재된 일봉(`StockDailyPrice`)과 KIS 실시간 캐시를 **읽는** 조회 경로. 화면의 가격 배지(현재가·전일대비%·5일 스파크라인)에 종단연결한다. 가격 우선순위: 실시간 캐시 신선 시 `source=REALTIME`, 없으면 최신 일봉 종가 `source=DAILY`. 데이터 없는 종목은 `null`로 흡수(배지 미표시). 점수·체결·하드룰과 무관한 순수 조회(AI 미개입).

### 13.1 다건 종목 시세 조회

```
GET /api/market-data/quote?stockCodes=005930,000660   (OptionalJwt — 게스트 열람)
```

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `stockCodes` | string | 필수 | 종목코드 6자리 콤마구분. 6자리 숫자만 정규화·중복 제거, 최대 50종목. |

다건 조회는 단일 `in` 쿼리로 처리(N+1 회피). 응답은 `stockCode → 시세\|null` 맵.

**응답**:
```json
{
  "success": true,
  "data": {
    "005930": {
      "stockCode": "005930",
      "corpCode": "00126380",
      "price": 73500,
      "previousClose": 72000,
      "change": 1500,
      "changePercent": 2.08,
      "tradeDate": "20260611",
      "source": "DAILY",
      "sparkline": [70800, 71200, 71500, 72000, 73500]
    },
    "000660": null
  }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `price` | number | 최종가(원) — 실시간 우선, 폴백 최신 일봉 종가 |
| `previousClose` | number\|null | 직전 기준 종가(실시간이면 최신 일봉 종가, 일봉이면 전일 종가). 없으면 null |
| `change` / `changePercent` | number\|null | 전일대비 절대 등락(원) / 등락률(%) 소수 2자리. `previousClose` 없으면 null |
| `tradeDate` | string\|null | 가격 기준 일봉일(YYYYMMDD) |
| `source` | `REALTIME`\|`DAILY` | 가격 출처(정직 라벨) |
| `sparkline` | number[] | 최근 종가(오래된→최신, 최대 5) |

### 13.2 분봉 조회 (Minute Candles, DAR-352 → DAR-377 저장분 확장)

```
GET /api/market-data/minute-candles?stockCode=005930[&tradeDate=20260620]   (OptionalJwt — 게스트 열람)
```

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `stockCode` | string | 필수 | 종목코드 6자리. 형식 위반·데이터 없음 시 `candles` 빈 배열. |
| `tradeDate` | string | 선택 | 거래일 YYYYMMDD. 지정 시 저장분(`StockMinutePrice`)에서 해당일 분봉 서빙. 미지정 시 당일 KIS 실시간 우선·저장 최근일 폴백. |

서빙 우선순위(거래일 미지정): ① KIS 당일 실시간 분봉(`source=KIS_REALTIME`) → ② 미가용 시 저장된
최근 거래일 분봉(`source=STORED`) → ③ 없으면 `UNAVAILABLE` 빈 배열. ★**과거 분봉은 KIS 가 제공하지
않으므로** `tradeDate` 지정 조회는 수집 시작일부터의 저장분만 존재한다(forward 축적).

**응답**:
```json
{
  "success": true,
  "data": {
    "stockCode": "005930",
    "source": "STORED",
    "asOf": "2026-06-20T06:31:00.000Z",
    "tradeDate": "20260619",
    "candles": [
      { "time": "0901", "open": 100, "high": 102, "low": 99, "close": 101, "volume": 500 }
    ]
  }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `source` | `KIS_REALTIME`\|`STORED`\|`UNAVAILABLE` | 캔들 출처 정직 라벨 |
| `asOf` | string | 서버 응답 생성 시각(ISO). 캔들 `time` 은 KIS 시장 시각이라 환경 시계와 괴리 가능 |
| `tradeDate` | string\|null | 캔들 거래일(YYYYMMDD). `STORED` 는 저장 거래일, `KIS_REALTIME`/미가용은 null |
| `candles[].time` | string | 분 시각 HHMM(저장분) 또는 HHMMSS(KIS 실시간). 시간 오름차순 |

### 13.3 분봉 수동 수집 (DAR-377, 운영 트리거)

```
POST /api/market-data/collect/minute-prices?cap=100&tradeDate=20260620   (JWT 필수)
```

우선순위 상위 종목(보유→신호→관심→거래량)의 당일 분봉을 KIS 에서 받아 `StockMinutePrice` 에 멱등
적재하고 커버리지 리포트를 반환한다. cron(평일 09:00~15:30 / 10분 간격) 외 단발 트리거. KIS 일일
쿼터·레이트리밋 가드(`cap`·스로틀) 내 동작.

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `cap` | number | 선택 | 수집 상한 종목 수(쿼터 가드). 미지정 시 env `KIS_MINUTE_COLLECT_CAP`→기본 100 |
| `tradeDate` | string | 선택 | 적재 거래일 YYYYMMDD 강제(미지정 시 KRX 실 가용 거래일로 해석) |

**응답 데이터**: `{ tradeDate, totalCandidates, requested, skippedByQuota, covered, empty, candlesSaved }`
— `skippedByQuota`(쿼터로 잘려 미수집한 종목 수)로 커버리지를 정직 보고한다.

---

## 14. 포트폴리오 리스크 스냅샷 (Portfolio Risk — DAR-163)

활성 포트폴리오의 최신 리스크 스냅샷(일손익·집중도·하드룰 위반·riskLevel)을 읽기 전용으로
노출한다. `PortfolioRiskSnapshot` 모델을 읽기만 하며, Engine5 Risk 하드룰 산출 로직은 침범하지 않는다.

### 14.1 최신 리스크 스냅샷 조회

```
GET /api/portfolio/risk/latest   (JWT 필수)
```

활성 포트폴리오의 가장 최근(`snapshotDate` 내림차순) 스냅샷 1건을 반환한다.
활성 포트폴리오 또는 스냅샷이 없으면 `data: null`(빈상태).

**Response `data` (스냅샷 존재 시):**

| 필드 | 타입 | 설명 |
|---|---|---|
| `portfolioId` | string | 포트폴리오 ID |
| `snapshotDate` | string (YYYY-MM-DD) | 스냅샷 기준일 |
| `totalValue` | number | 총 평가금액 |
| `cashAmount` | number \| null | 현금 |
| `unrealizedPnl` | number | 미실현 손익(금액) |
| `unrealizedPnlPct` | number | 미실현 손익률 % |
| `topPositionPct` | number | 최대 단일 종목 비중 %(집중도) |
| `topSectorPct` | number \| null | 최대 섹터 비중 % |
| `openPositionCount` | number | 보유(OPEN) 포지션 수 |
| `dailyPnl` | number \| null | 당일 손익(금액) |
| `dailyPnlPct` | number \| null | 당일 손익률 % |
| `weeklyPnl` | number \| null | 주간 손익(금액) |
| `weeklyPnlPct` | number \| null | 주간 손익률 % |
| `riskLevel` | string | `NORMAL` \| `WARNING` \| `CRITICAL` 등 |
| `hardRuleBreached` | boolean | 하드룰 위반 여부 |
| `hardRuleDetail` | string \| null | 위반 상세(없으면 null) |

```jsonc
// 스냅샷 부재 시
{ "success": true, "data": null }
```

모바일은 `usePortfolioRisk()` 훅으로 소비하고, 포트폴리오 실전 탭 요약 카드에
`PortfolioRiskBadge`(당일 손익 색상 칩·집중도 % 칩·하드룰 위반 경고 칩)로 노출한다.
`data: null`이면 배지를 렌더하지 않는다(화면 무손상).

---

## 15. 시장지수 (Market Index, DAR-160)

### 15.1 시장지수 최신값 조회

```
GET /api/market-data/indices/latest   (OptionalJwt — 게스트 열람)
```

KOSPI(0001)·KOSDAQ(1001)의 최신 지수값 + 전일대비 등락폭·등락률(%) + 거래일·출처를 반환한다.
홈 헤더 '시장 한눈에' 배지·신호 화면 시장국면 맥락에 쓰인다. 시장 데이터는 비개인 공개정보이므로
게스트도 열람 가능(컨트롤러 기본 JWT 가드를 메서드 단위 OptionalJwt 로 덮음).

**가격 출처 우선순위 (DAR-371).** ①KIS 실시간 업종지수(`inquire-index-price`, tr_id `FHPUP02100000`,
KOSPI=0001·KOSDAQ=1001)가 가용하면 그 실가로 구동(`source: 'REALTIME'`, `asOf` 서버 조회시각).
②KIS 미설정·실패면 KRX 일봉 최신 종가로 폴백(`source: 'EOD'`, `asOf: null`, `tradeDate` 가 종가 기준일).
실시간에도 ±20% sanity 가드(DAR-367)를 유지한다.

**응답** (`data`: 배열, 미적재 지수는 생략됨)

```json
{
  "success": true,
  "data": [
    {
      "indexCode": "0001",
      "indexName": "KOSPI",
      "market": "KOSPI",
      "tradeDate": "20260619",
      "closeIndex": 9052.42,
      "prevCloseIndex": 9063.84,
      "change": -11.42,
      "changePercent": -0.13,
      "suspect": false,
      "source": "REALTIME",
      "asOf": "2026-06-19T05:30:00.000Z"
    },
    {
      "indexCode": "1001",
      "indexName": "KOSDAQ",
      "market": "KOSDAQ",
      "tradeDate": "20260605",
      "closeIndex": 792.0,
      "prevCloseIndex": 800.0,
      "change": -8.0,
      "changePercent": -1.0,
      "suspect": false,
      "source": "EOD",
      "asOf": null
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `indexCode` | string | 지수코드 (0001=KOSPI, 1001=KOSDAQ) |
| `market` | `'KOSPI' \| 'KOSDAQ'` | 시장 구분 |
| `tradeDate` | string (YYYYMMDD) | REALTIME=조회 당일(KST), EOD=종가 기준 거래일 |
| `closeIndex` | number | 최신 지수값(REALTIME=현재 지수, EOD=종가지수) |
| `prevCloseIndex` | number \| null | 전일(직전) 지수 (없으면 null) |
| `change` | number \| null | 전일대비 등락폭(포인트) |
| `changePercent` | number \| null | 전일대비 등락률(%) |
| `suspect` | boolean | 데이터 정합 의심 플래그 (DAR-367) |
| `source` | `'REALTIME' \| 'EOD'` | 가격 출처 (DAR-371). EOD 는 `tradeDate` 가 '종가 기준일' |
| `asOf` | string(ISO) \| null | REALTIME 일 때 서버 KIS 조회 시각. EOD 면 null |

> 전일 데이터가 1건뿐이면 `prevCloseIndex`·`change`·`changePercent`는 `null`. 데이터가 전혀 없으면 빈 배열(홈 배지 미표시).
>
> **DAR-371 신선도 정직.** 홈 배지는 `source` 로 신선도를 정직하게 표기한다 — `REALTIME` 은 '실시간',
> `EOD` 는 'YYYY.MM.DD 종가' 기준일 라벨. KRX 일봉이 환경 시계보다 지연(예: 최신 가용일 20260605)되어
> stale 종가를 '현재'로 오인하던 신뢰 문제를 차단한다.
>
> **DAR-367 연속성 sanity 가드.** 인접 거래일 종가 대비 |Δ| 가 ±20% 를 초과하면(물리적으로
> 불가능한 수준) 전일 종가가 오염된 것으로 보고 `prevCloseIndex`·`change`·`changePercent` 를
> `null` 로 숨기고 `suspect: true` 로 표기한다. 클라이언트(홈 배지)는 `suspect` 면 등락 대신
> '데이터 점검중' 폴백을 띄워 `-63.75%` 같은 불가능한 수치를 사용자에게 노출하지 않는다.

---

## 16. 이벤트 스터디 (Event Study)

### 16.1 이벤트 통계(버킷 집계) 조회

```
GET /api/event-study   (JWT 필수)
```

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `eventType` | string | 선택 | 이벤트 유형 필터 |
| `marketType` | string | 선택 | `KOSPI` / `KOSDAQ` / `ALL` (기본 `ALL`) |
| `includeInsufficient` | boolean | 선택 | 표본<30 미유의(`INSUFFICIENT`) 데이터한계 항목 포함 (기본 false → `READY`만) |

(eventType, bucketKey, marketType) 단위 버킷 평균 통계(D+N 초과수익·승률·표본 등)를 반환.

### 16.2 버킷 구성 개별 관측치 드릴다운 (DAR-166)

```
GET /api/event-study/:bucketKey/observations   (JWT 필수)
```

버킷 통계가 **실제로 어떤 공시들로 만들어졌는지**를 검증할 수 있도록, 해당 버킷을 구성한
개별 관측치(공시별 CAR)를 페이지네이션으로 반환한다(표본 투명성 — 과신 방지).

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `bucketKey` (path) | string | 필수 | 버킷 식별자 (예: `SUPPLY_CONTRACT__ratio_5to20`) |
| `eventType` | string | 선택 | 이벤트 유형 추가 필터 |
| `limit` | number | 선택 | 페이지 크기 (1~100, 기본 20) |
| `offset` | number | 선택 | 오프셋 (기본 0) |

**응답 `data`**

| 필드 | 타입 | 설명 |
|---|---|---|
| `bucketKey` | string | 요청 버킷 |
| `total` | number | 버킷 전체 관측치 수 |
| `limit` / `offset` | number | 적용된 페이지 파라미터 |
| `hasMore` | boolean | 다음 페이지 존재 여부 |
| `items[]` | object | 개별 관측치 목록 |
| `items[].rcpNo` | string | 공시 접수번호 |
| `items[].corpName` | string\|null | 기업명(논리 조인, 미존재 시 null) |
| `items[].d0Date` | string (YYYYMMDD) | 실제 D0 날짜 |
| `items[].carD5` / `carD20` | number\|null | D+5 / D+20 누적 초과수익(CAR, %) — 미보유 시 null |
| `items[].maxDrawdown` | number | D0~D+20 최대낙폭(%) |
| `items[].isUpD5` / `isCrashD5` | boolean | D+5 상승 / 급락(-5% 이하) 여부 |

> 관측치 모델은 `marketType`이 없어 시장 무관 풀(= `ALL` 버킷과 동일 표본)이다. 빈 버킷이면 `items: []`.
> 관측치는 `POST /api/event-study/calculate` 산출 시 영속된다(스키마 변경 없음, 기존 `EventStudyObservation` 모델 사용).

### 16.2-b 버킷 D+N 초과수익 분포 (DAR-402)

```
GET /api/event-study/:bucketKey/distribution   (JWT 필수)
```

산술평균(`avgArD20`)이 극단 이상치에 지배돼 거짓 매수신호를 만드는지 검증하기 위해, 버킷 관측치
(`EventStudyObservation.cumulativeAR`)에서 D+5/D+20 누적 초과수익의 **분포**(평균·중앙값·분위수)를 직접 산출한다.
평균과 중앙값의 괴리가 크면 그 버킷이 소수 이상치에 오염됐다는 신호다.

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `bucketKey` (path) | string | 필수 | 버킷 식별자 (예: `SUPPLY_CONTRACT__ratio_5to20`) |
| `eventType` | string | 선택 | 이벤트 유형 추가 필터 |

**응답 `data`**

| 필드 | 타입 | 설명 |
|---|---|---|
| `bucketKey` | string | 요청 버킷 |
| `count` | number | 관측치 행 수 |
| `d5` / `d20` | object | D+5 / D+20 누적 AR 분포 요약 |
| `d5.count` | number | 유효 값 수 |
| `d5.mean` | number\|null | 산술평균(이상치 지배 가능) |
| `d5.median` | number\|null | 중앙값(이상치 강건) |
| `d5.p5` / `p25` / `p75` / `p95` | number\|null | 분위수(선형 보간) |

> 표본이 비면 모든 분포 필드 null(에러 아님). 관측치 모델은 `marketType`이 없어 시장 무관 풀이다.

### 16.3 기업별 이벤트 스터디 통계 (DAR-190)

```
GET /api/companies/:corpCode/event-study   (OptionalJwt — 게스트 열람)
```

종목 상세 화면 "통계" 탭이 소비한다. `EventStudyResult`는 **시장 전체 집계**라 `corpCode` 차원이 없으므로,
이 기업이 제출한 공시 유형(`DisclosureEvent.eventType` distinct)을 먼저 구하고, **그 유형들의 시장 전체
이벤트 스터디 결과**를 반환한다(= 16.1 버킷 통계를 기업 보유 유형으로 필터링한 부분집합). 시장 전체 통계라
비민감 데이터 → 게스트 열람 허용(메서드 단위 `OptionalJwt`, 시세 API와 동일 패턴).

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `corpCode` (path) | string | 필수 | 기업 고유번호(8자리) |
| `eventType` | string | 선택 | 이벤트 유형 필터(기업 보유 유형과의 교집합으로 제한) |
| `marketType` | string | 선택 | 시장 유형 (`KOSPI` / `KOSDAQ` / `ALL`, 기본 `ALL`) |

**응답** (`data`: `EventStudyResult` 배열, 16.1 버킷 통계와 동일 형태)

```jsonc
{ "success": true, "data": [ /* (eventType, bucketKey, marketType) 버킷 통계 … */ ] }
```

> 기업이 제출한 공시 이벤트가 없거나(`eventType` 교집합 공집합 포함), 매칭되는 `READY` 결과가 없으면
> `data: []`(빈상태). 최신 `calculatedAt` 내림차순 최대 50건. 라우트는 Companies 컨트롤러 소속이지만
> 결과 형태가 16.1과 동일해 본 섹션에 함께 둔다.

### 16.4 평가자료·인과코퍼스 (Evaluation Corpus, DAR-379)

```
GET /api/backtest/evaluation-corpus?limit=2000&eventType=SUPPLY_CONTRACT   (OptionalJwt — 게스트 열람)
```

공시 1건마다 **[AI/Rule 사전평가 + 실현 EventStudy 사후결과 + 일치/괴리 라벨]**을 결합한 라벨 데이터를
이벤트유형별로 집계한다. `DisclosureEvent`(사전 극성·신뢰도·`isAiAssisted`) ⨝ `DisclosureAnalysis`(AI
분석 유무·태스크 수) ⨝ `EventStudyObservation`(실현 D+5/D+20 누적초과수익)을 `rcpNo`로 결합한
**read-time 파생 뷰**(마이그레이션 불요)다. 일봉 윈도가 깊어질수록(★데이터축적A 의존) 실현결과 커버리지가
오르고, 사전 극성이 사후 실현 방향을 맞히는지(`hitRate`)가 calibration 의 통계 근거가 된다.

★ **AI 금지영역 불가침**: 코퍼스는 **참고 평가자료**일 뿐 주문을 직접 결정하지 않는다. Buy/Exit Score 는
Rule 공식이 산출하고 Risk·체결은 Engine5 독립이다. 응답 `disclaimer`(=`CORPUS_REFERENCE_ONLY…`)로 명시.

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `limit` | int | 선택 | 대상 공시 최대 수(최신 추출순). 기본 2000, 상한 5000(비숫자/음수 안전화) |
| `eventType` | string | 선택 | 이벤트 유형 필터 |

**라벨 규칙**: 사전 극성 `POSITIVE→+1`/`NEGATIVE→-1`/`MIXED·UNKNOWN→0`. 실현 AR 부호와 비교 —
실현결과 없음(미성숙)·방향예측 없음·정확히 0 → `NEUTRAL`(과신 방지), 부호 일치 → `AGREE`, 불일치 → `DIVERGE`.
`hitRate = AGREE / (AGREE + DIVERGE)`(판정대상 0이면 `null`). AI 커버리지와 실현 커버리지는 분리 집계.

**응답**

```jsonc
{
  "success": true,
  "data": {
    "generatedAtNote": "point-in-time 코퍼스: 호출 시점의 관측치·AI분석 기준 스냅샷(저장 없음)",
    "summary": {
      "totalRecords": 1234, "distinctEventTypes": 12,
      "withAiCount": 800, "withOutcomeD5Count": 950,
      "aiCoveragePct": 64.83, "outcomeCoverageD5Pct": 77.0,
      "agreeD5": 620, "divergeD5": 330, "neutralD5": 284,
      "hitRateD5": 65.26, "hitRateD20": 61.1
    },
    "byEventType": [
      {
        "key": "SUPPLY_CONTRACT", "recordCount": 210,
        "withAiCount": 140, "withOutcomeD5Count": 180, "withOutcomeD20Count": 170,
        "aiCoveragePct": 66.67, "outcomeCoverageD5Pct": 85.71,
        "agreeD5": 120, "divergeD5": 60, "neutralD5": 30,
        "hitRateD5": 66.67, "hitRateD20": 64.2,
        "meanArD5": 1.83, "meanArD20": 2.41
      }
      /* … 레코드 수 내림차순 … */
    ],
    "disclaimer": "CORPUS_REFERENCE_ONLY — …"
  }
}
```

> 대상 공시 0건이면 `summary` 전부 0·`byEventType: []`(빈상태, 에러 아님). read-only 집계 —
> 신규 수집·외부호출·AI 개입 0, 가중치/임계값 미변경. 16.1 버킷 통계(시장 집계)와 달리 **공시 단위**
> 라벨이라 EventStudy 표본 증가·AI 분석 커버리지·방향 적중률을 한 응답에서 실측한다.

### 16.5 유사공시 반응 통계 (DAR-511)

공시 이벤트 유형의 과거 유사공시 실제 주가 반응(D+1/D+5/D+20 누적 평균수익률·상승비율·표본수 n, n≥30 게이트)
은 `GET /disclosures/:rcpNo/event-stats` — 경로가 `/disclosures` 하위라 상세는 **§7.9** 참조. 로직·데이터는
EventStudy(engine3, `EventStudyObservation` 집계) 소속이라 본 절에서 교차 링크만 둔다.

---

## 17. 구간 캔들 (Candles — TimescaleDB, DAR-378)

### 17.1 분봉/일봉 구간 조회

```
GET /api/market-data/candles?stockCode=005930&resolution=5m&from=20260501&to=20260530&limit=200   (OptionalJwt — 게스트 열람)
```

TimescaleDB 분봉 하이퍼테이블(`stock_minute_prices`)과 연속집계(`stock_candles_5m/15m/1d`)에서
**구간(from~to) + 해상도 + 페이지네이션 + 서버측 다운샘플**로 캔들을 조회한다. 모바일에 원본 분봉을
대량 전송하지 않도록 `limit`(기본 200, 최대 1000)으로 상한을 강제하고, 해상도가 높을수록 연속집계
롤업 뷰를 조회해 원본 풀스캔을 피한다. 당일 KIS 실시간 분봉(`minute-candles`, DAR-352)과 달리
**적재된 시계열을 구간 조회**한다.

**쿼리 파라미터**

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `stockCode` | ✅ | 종목코드 6자리 (위반 시 400) |
| `resolution` | — | `1m`(기본)·`5m`·`15m`·`1d`. 5m/15m/1d 는 연속집계 롤업 |
| `from` | — | 구간 시작(포함) — ISO 8601 또는 `YYYYMMDD`/`YYYYMMDDHHmm`(UTC) |
| `to` | — | 구간 끝(포함) — `from` 과 동일 형식 (`from > to` 면 400) |
| `before` | — | 페이지네이션 커서 — 이 시각 이전(미만) 캔들만(과거 페이지). 응답 `nextCursor` 사용 |
| `limit` | — | 한 페이지 캔들 수 (기본 200, 최대 1000) |

**응답** — `candles` 는 시간 오름차순. `source` 는 `TIMESCALE`(조회 성공) 또는 `UNAVAILABLE`
(확장/마이그레이션 미적용 등 — 빈 배열 graceful, 비파괴). `asOf` 는 서버 조회시각(환경 시계 괴리 고지).

```jsonc
{
  "success": true,
  "data": {
    "stockCode": "005930",
    "resolution": "5m",
    "source": "TIMESCALE",
    "asOf": "2026-06-20T05:00:00.000Z",
    "count": 200,
    "nextCursor": "2026-05-29T00:00:00.000Z",
    "candles": [
      { "time": "2026-05-29T00:05:00.000Z", "open": 70100, "high": 70530, "low": 69950, "close": 70450, "volume": 8064 }
      /* … 오름차순 … */
    ]
  }
}
```

OHLCV 롤업 규칙(연속집계): open=first(ts)·high=max·low=min·close=last(ts)·volume=sum.
실측: 1d 롤업이 원본-분봉 집계(high/low/volume)와 정확 일치.

---

## 18. 시스템 트레이딩 전략 변형 트랙 (Strategy Tracks, DAR-404)

단일 모의매매(라이브 1년 리플레이, DAR-385)를 **진입/청산/사이징 룰이 다른 전략 변형 4종**으로 분기해
각각 point-in-time(미래모름) 백테스트 트랙(`BacktestRun`/`BacktestTrade`·`strategyKey`)을 쌓고 비교한다.
거장철학(DAR-76)·페르소나 축과 별개의 **'트레이딩 로직' 축**이다. URL 네임스페이스는 `paper-trading`을
쓰되 산출/조회는 engine3(backtest) 소속이다(엔진 간 직접호출 0).

**전략 4종**: `event-edge`(이벤트엣지) · `short-momentum`(단기모멘텀) · `conservative-value`(보수가치) ·
`aggressive-diversified`(공격분산). 파라미터는 합리적 기본값으로 상수화(추후 calibration 조정).

> ★ **룰 값 정본 = `docs/trading/strategy-rulebook.md`(DAR-475)**. 각 전략의 진입/청산/사이징/한도 전값은 룰북 §4가
> SSOT다. 아래 예시의 `rules.entry`/`rules.exit`는 `summarizeEntryRule`/`summarizeExitRule`(`strategy-presets.ts`)
> 실출력이다. **event-edge는 `robustEventGate=true`** — 매수 이벤트를 하드코딩하지 않고 refresh 시 EventStudy robust
> 통계가 확인한 양(+)-edge 이벤트만 동적 선별하며(비면 진입 0, do-no-harm), 매수점수 하한은 **≥35**(DAR-413 재보정,
> 舊 "6종 한정·≥50"은 DAR-408·413 이전 stale 값). minBuyScore 사다리: 보수가치 50 > 단기모멘텀 40 > 이벤트엣지 35 > 공격분산 30.

### 18.1 전략 4종 비교

```
GET /api/paper-trading/simulation/strategies/comparison   (OptionalJwt — 게스트 데모 열람)
```

전략별 최신 완료 트랙을 모아 **표본 있는 전략 누적수익 내림차순 `ranking.ranking` + `ranking.bestKey`**로
반환한다. 트랙 미산출 전략은 빈 곡선·`sampleSize:0`·지표 null 로 graceful(후순위). 청산 표본이
`lowSampleThreshold`(20) 미만이면 `lowSample:true`.

★ **응답 계약 SSOT = 모바일 `mobile/types/strategy-comparison.types.ts`(DAR-405)** — 백엔드
`StrategyTrackService` 직렬화는 그 타입과 1:1(DAR-407 정합). `winRate`는 0~1 비율, `equityCurve`는
`{snapshotDate,totalValue,returnPct}`(모바일 EquityCurvePoint).

★ **승률 통일 정의 (S신뢰/G-1)** — 모든 표면(백테스트 `PerformanceCalculatorService`·모의운용 성적표
`trade-scorecard`·분봉 단타)에서 **승률 = 순손익>0 거래 / 전체 청산 거래**. 본전(순손익 0)은 승도 패도
아니며 분모에만 포함(승률 과대표시 방지). 패 카운트(`lostTrades`/`lossCount`)는 순손익<0 만 집계.

★ **자산곡선 일별 flat-fill (DAR-412)** — `equityCurve`(원천 `backtest-equity-curve.ts buildEquityCurve`)는
평가액이 변동하는 청산일마다 **"그 직전 달력일"에 변동 직전 평가액을 유지하는 flat 앵커 점**을 함께
넣는다. 거래가 없던 구간이 직선 보간으로 뭉개지지 않고 **평평(원금/직전 평가액 유지) → 청산 시점
계단**으로 그려진다(모바일 `EquityCurveChart` 는 점을 인덱스 균등 간격으로 잇는다). 예: 시작 2025-06-22
1000만 → 앵커 2026-06-14 1000만(flat) → 청산 2026-06-15 1030만(계단). 4종 전략·분봉 단타
(`intraday-scalp` forward 트랙) 동일 적용.

```jsonc
{
  "success": true,
  "data": {
    "initialCapital": 10000000,
    "strategies": [
      {
        "key": "event-edge",
        "label": "이벤트엣지",
        "tagline": "EventStudy 유의 양(+) 이벤트만 추종 …",
        "initialCapital": 10000000,
        "equityCurve": [ { "snapshotDate": "2025-06-21", "totalValue": 10000000, "returnPct": 0 } ],
        "cumulativeReturnPct": 12.5,
        "winRate": 0.55,
        "tradeCount": 40,
        "sampleSize": 40,
        "sharpe": 0.8,
        "maxDrawdownPct": -9.3,
        "benchmarkAlphaPct": null,
        "rules": {
          "entry": "전 이벤트 대상 · 매수점수 ≥35 · 점수가중 배분 · 최대 20종목",
          "exit": "익절 +20% / 손절 -10% · 최대보유 20거래일"
        },
        "lowSample": false
      }
      /* … 나머지 3종 … */
    ],
    "ranking": {
      "ranking": ["event-edge", "conservative-value", "short-momentum", "aggressive-diversified"],
      "bestKey": "event-edge",
      "allLowSample": false
    },
    "lowSampleThreshold": 20
  }
}
```

### 18.2 전략별 과거 매수/매도 트랙

```
GET /api/paper-trading/simulation/strategies/:key/trade-history   (OptionalJwt — 게스트 데모 열람)
```

해당 전략 최신 트랙의 `BacktestTrade`(과거 매수/매도)를 **최신순(entryDate desc)**으로 반환한다.
알 수 없는 키는 404, 트랙 미산출은 빈 `trades` 배열 graceful. 응답은 모바일 `StrategyTradeHistory`
계약과 1:1(SSOT 동일). `status`는 `exitDate` 유무로 `OPEN`/`CLOSED`.

```jsonc
{
  "success": true,
  "data": {
    "key": "event-edge",
    "label": "이벤트엣지",
    "tagline": "EventStudy 유의 양(+) 이벤트만 추종 …",
    "rules": {
      "entry": "전 이벤트 대상 · 매수점수 ≥35 · 점수가중 배분 · 최대 20종목",
      "exit": "익절 +20% / 손절 -10% · 최대보유 20거래일"
    },
    "trades": [
      {
        "id": "ckxtrade…",
        "stockCode": "005930", "stockName": "삼성전자",
        "eventType": "SUPPLY_CONTRACT",
        "entryDate": "2025-07-01", "exitDate": "2025-07-10",
        "entryPrice": 70000, "exitPrice": 77000,
        "returnPct": 9.5, "exitReason": "TAKE_PROFIT", "holdDays": 9, "status": "CLOSED"
      }
      /* … 최신순 … */
    ]
  }
}
```

### 18.3 전략 트랙 즉시 갱신 (운영 트리거)

```
POST /api/paper-trading/simulation/strategies/refresh   (JWT 필수 — 쓰기·비용)
```

4 프리셋을 각각 리플레이 재실행해 트랙을 새로 산출한다(전략별 최신 1개 유지, 멱등). 한 전략이 실패해도
나머지는 계속 진행(부분 성공). 스케줄러가 매일 05:00(KST) 자동 갱신하므로 평시엔 호출 불필요.

```jsonc
{
  "success": true,
  "data": {
    "startDate": "2025-06-21", "endDate": "2026-06-21",
    "results": [
      { "strategyKey": "event-edge", "status": "COMPLETED", "runId": "ckxxx…", "totalTrades": 40, "cumulativeReturnPct": 12.5 }
      /* … 나머지 3종 … */
    ]
  }
}
```

### 18.4 전략 파라미터 민감도 스윕 (Parameter Sensitivity Sweep, 견고화 W3·P24, DAR-485)

```
POST /api/paper-trading/simulation/strategies/:key/sensitivity-sweep   (JWT 필수 — 무거운 계산)
Body: { "startDate": "2025-06-19", "endDate": "2026-06-19" }
```

프리셋 파라미터를 축별로 흔든 **이웃값 그리드**(손절 ±2%p·익절 ±5%p·보유일 ±5일·minBuyScore ±5)를
`backtest-runner` 재사용 point-in-time 리플레이로 실행하고, 이웃 대비 성과 급변 여부(안정성)를 리포트로
낸다. 룰북 §9-1 과최적화 대응 — 프리셋이 파라미터 고원(plateau) 위에 있는지 스파이크(과최적화)인지 측정한다.

- **one-at-a-time(OAT)**: 한 번에 한 축만 흔들고 나머지는 baseline 고정(축별 민감도 격리).
- **판정(축별, 1차 지표 totalReturn)**: `STABLE`(안정) · `MODERATE`(중간) · `SENSITIVE`(급변) ·
  `FRAGILE`(이웃이 손익 부호를 뒤집음) · `LOW_SAMPLE`(baseline 표본<20, 판단보류). `overall`=축 최악.
- **★ read-only** — BacktestRun/Trade 영속 0(운용·측정 트랙 무접촉). 리포트는 응답으로만 반환하는 휘발 산출물.
  상시 크론 없음(수동 트리거 전용). 스크립트: `npx ts-node -r dotenv/config
  src/engine3-quant-market/backtest/strategies/parameter-sweep.manual.ts <key> <start> <end>`.
- **★★ AI 자동 파라미터 조정 금지** — 하니스는 측정·리포트만. 파라미터 반영은 `docs/trading/strategy-rulebook.md
  §8 변경 절차`(문서 개정 → 재검증 → 사람 승인)로만. 프리셋 키 기반 일반화 — 신규 트랙(P12·P14) 머지 시 동일 적용.

```jsonc
{
  "success": true,
  "data": {
    "presetKey": "conservative-value", "presetLabel": "보수가치",
    "window": { "startDate": "2025-06-19", "endDate": "2026-06-19" },
    "baseline": { "totalReturn": 12.4, "winRate": 58.0, "profitFactor": 1.6, "mdd": -11.2, "sharpe": 1.1, "totalTrades": 34 },
    "baselineTrades": 34, "gridSize": 9,
    "axes": [
      { "axisKey": "stopLoss", "axisLabel": "손절", "unit": "%p", "step": 2,
        "baselineParam": -10, "downParam": -12, "upParam": -8,
        "primaryAbsSwing": 1.8, "primaryRelSwing": 0.15, "signFlip": false, "verdict": "STABLE",
        "metrics": [ { "metric": "totalReturn", "baseline": 12.4, "down": 11.0, "up": 13.2, "downDelta": -1.4, "upDelta": 0.8, "maxAbsSwing": 1.4 } /* … */ ] }
      /* … takeProfit · holdDays · minBuyScore … */
    ],
    "mostSensitiveAxisKey": "takeProfit", "overallVerdict": "MODERATE", "lowSample": false,
    "notice": "read-only 측정 리포트. 파라미터 자동 조정 없음. 값 반영은 … §8 변경 절차로만."
  }
}
```

---

## 19. 분봉 단타 모의전략 트랙 (Intraday Scalp, DAR-411)

분봉(stock_minute_prices) 기반 **당일 진입·당일 청산** 실시간 페이퍼 트랙. 기존 4종 일봉 전략(§18)과
별개의 트랙이다. ★분봉은 당일 forward-only(KIS, 과거 분봉 없음)라 **백테스트 불가** → 정규장 중
실시간 모의(paper)로만 누적한다(`backtestable: false`, equityCurve 는 오늘부터 forward).

- **진입(정규장 매 10분, 09:02~15:52 — 분봉수집기 직후 +2분 오프셋)** — 3조건 AND:
  1. 거래량 폭발: 현재 분 거래량 ≥ 직전 20분 평균 거래량 × 2.5
  2. 돌파: 현재가(분봉 종가) > 직전 15분 고가
  3. 추세: 현재가 > 당일 VWAP
  - 유니버스 = 당일 공시 종목 ∪ buy-signal(STRONG_BUY/BUY/WATCH) 후보, **분봉 수집된 종목만**, buyScore 우선.
  - 종목당 1포지션·동시보유 ≤5·종목당 예산 3%(engine5 Risk 하드룰 적용·veto).
  - **윈도우 스캔 — DAR-415**: 진입 평가는 최신 1봉이 아니라 **직전 사이클 이후 도착한 분봉 윈도우 전체**를
    순회한다(engine3 `scanEntrySignals(candles, fromIndex)` 순수 함수 — 각 분봉을 그 시점 '현재'로 두고
    point-in-time 평가, **첫 충족봉**에서 진입). 10분 간격 평가가 최신 1봉만 보면 사이클 사이(10봉)에
    발생한 충족 순간이 ':X2분 스냅샷'의 최신봉일 때만 잡혀 대부분 누락되던 버그(0619 실측 215 충족 → 진입 0)를
    해소. engine5 가 **종목별 스캔 커서**(다음 스캔 시작 인덱스, 거래일 전환 시 리셋)로 중복 평가를 막고,
    **종목당 1라운드트립**(OPEN/CLOSED 무관 당일 진입 이력 있으면 스킵)으로 과진입을 막는다.
    진입가 = 충족봉 종가(슬리피지 반영), 진입 ts = **충족봉 시각**(사이클 발화 시각이 아님).
- **청산(순/net 기준 — DAR-418)**: 익절 **순 +2%** / 손절 **순 -1.2%** / **15:20 전량 강제청산**(단타=오버나잇 금지, 손익 무관 최우선). 15:20 이후 신규 진입 금지.
  - ★단타는 매도마다 비용이 부과되므로 TP/SL 임계를 **순(net) 기준**으로 둔다. gross 가격수익률에서 **왕복 거래비용율**(매수 수수료+슬리피지 + 매도 수수료+세금+슬리피지 = `2·0.015% + 0.18% + 2·0.05% = 0.31%`)을 차감한 net 수익률로 익절/손절을 판정한다. 즉 순 +2% 익절은 **gross +2.31%**에서, 순 -1.2% 손절은 **gross -0.89%**에서 발동(손절 임계를 비용만큼 좁혀 과손실 방지). `+2% gross` 소액 익절이 수수료에 먹혀 적자전환(net +1.69%)하던 문제를 차단한다.
  - **비용율 SSOT**: 왕복비용율은 engine5 체결 파라미터(`FillParams` — `commissionRate`·`sellTaxRate`·`slippagePct`)에서 `roundTripCostPct()` 로 산출한다(하드코딩 금지).
- **진입 fee 허들 게이트(DAR-418, 선택·권장)**: 진입 시 기대이동(gross 익절폭)이 `왕복비용 + 최소마진(0.3%)`을 넘지 못하면 진입 보류(수수료만 내는 무의미 거래 차단). 마진은 작게 둬 정상 거래를 과도하게 막지 않는다.
- **체결**: 분봉 종가/실시간 시세 기준 paper 체결(수수료·세금·슬리피지 반영). ★실주문 0(순수 시뮬).
- **거래일(tradeDate) 소스 — DAR-414/423**: 진입·청산·강제청산·유니버스(당일 공시 `rcpDt` 필터 포함)가 사용하는
  거래일은 분봉 수집기(`StockMinutePriceCollector`)와 **동일한 해석기**로 통일한다 — 라벨 불일치(거래 0)를 구조적으로 차단.
  - **★DAR-423 인트라데이 전용 해석기 분리(`resolveIntradayTradeDate()`)**: 분봉/단타는 일봉 발행과 무관하게
    '오늘 라이브 세션'이 거래일이다. **평일이고 KST 가 개장(≥09:00)이면 오늘(today) YYYYMMDD**, 장외(개장 전·주말·휴장)면
    직전 거래일(`resolveLatestAvailableTradeDate()`)로 폴백한다. 일봉 발행 기준 `resolveLatestAvailableTradeDate()`는
    '오늘 일봉 미게시'면 직전 거래일을 반환하는데, 일봉은 장 마감 후 발행이라 **장중엔 항상 오늘을 어제로 잘못 폴백**해
    장중 분봉/단타 보유가 어제 라벨로 표시되던 버그(DAR-423)를 분리 해소한다.
  - **일봉 resolver(`resolveLatestAvailableTradeDate()`)는 무변경** — 일봉 수집·EventStudy 등 일봉 맥락에만 유지(이중 의미 분리).
  - 실제 휴장(평일이지만 KRX 휴장)이면 KIS 가 빈 분봉을 반환 → 유니버스 비고 신규 거래 0 으로 graceful(거짓 진입 없음).
  - 이미 수집된 과거(어제 라벨) 데이터는 마이그레이션 불요 — 신규 수집분부터 today 라벨. (해석기 미주입·일시 오류 시에만 `today` 폴백.)

### 19.1 분봉 단타 트랙 현황 조회

```
GET /api/paper-trading/simulation/intraday-scalp/status   (게스트 허용)
```

응답은 **`{ success, data }` 래핑**(strategy-track 등 전 엔드포인트와 동일 계약, DAR-417). 모바일
`simulation.service.ts` 가 `r.data.data` 로 추출하므로, 래핑이 없으면 `Query data cannot be undefined`
에러가 난다. `data` 의 shape 는 아래와 같다(이하 §19.2 도 동일하게 래핑).

```jsonc
{
  "success": true,
  "data": {
    "styleTag": "intraday-scalp",
    "strategyKey": "intraday-scalp",
    "tagline": "분봉 단타 — 거래량 폭발+돌파+VWAP 진입, 당일 청산(오버나잇 금지)",
    "initialCapital": 10000000,
    "openPositions": 2,            // 현재 보유(장중)
    "closedTrades": 5,             // 청산 완료 누적
    "realizedPnl": -12000,         // 실현 손익(KRW)
    "winRate": 0.4,                // 0~1
    "cumulativeReturnPct": -0.12,
    "lowSample": true,             // 표본 < 20 (forward 초기 graceful)
    "lowSampleThreshold": 20,
    "backtestable": false,         // ★분봉 단타는 백테스트 불가(forward-only)
    "roundTripCostPct": 0.31,      // ★DAR-418 왕복 거래비용율(%) — 수수료·세금·슬리피지 SSOT
    "takeProfitNetPct": 2.0,       // 순(net) 익절 목표(%)
    "stopLossNetPct": -1.2,        // 순(net) 손절 목표(%)
    "totalFees": 4300,             // 청산 완료 거래 총수수료(수수료+세금) 합(KRW)
    "equityCurve": [               // 일별 실현 누적(오늘부터 forward) — DAR-412 flat-fill 앵커 포함
      { "tradeDate": "20260621", "realizedPnl": 0, "cumulativeReturnPct": 0 },     // 변동 직전 달력일 앵커(평평)
      { "tradeDate": "20260622", "realizedPnl": -12000, "cumulativeReturnPct": -0.12 }
    ]
  }
}
```

`equityCurve` 는 손익 변동일마다 **그 직전 달력일에 변동 직전 누적수익률을 유지하는 flat 앵커**를 함께
넣어(DAR-412), 거래 없던 구간이 직선 보간으로 뭉개지지 않고 평평 → 청산 시점 계단으로 그려진다.

표본 0(장 시작 전·미진입)에도 `openPositions:0`/`equityCurve:[]`/`lowSample:true` 로 graceful 응답한다.

### 19.2 분봉 단타 거래 타임라인 조회 (DAR-416)

```
GET /api/paper-trading/simulation/intraday-scalp/trade-history   (게스트 허용)
```

최신 진입순(`entryTs` 내림차순) 종목별 1행. OPEN 포지션은 청산 필드(`exitTs`/`exitPrice`/`exitReason`/`returnPct`/`grossReturnPct`/`netReturnPct`/`netPnl`/`totalFees`)가 `null`(보유 중). 종목명은 `Company.corpName` 결합(없으면 `stockCode` 폴백). 응답은 **`{ success, data }` 래핑**(§19.1·DAR-417 동일 계약). 최상위 `roundTripCostPct`(왕복 거래비용율 %) 로 '순수익(수수료 후)'임을 고지한다(DAR-418).

```jsonc
{
  "success": true,
  "data": {
    "styleTag": "intraday-scalp",
    "strategyKey": "intraday-scalp",
    "tagline": "분봉 단타 — 거래량 폭발+돌파+VWAP 진입, 당일 청산(오버나잇 금지)",
    "roundTripCostPct": 0.31,                       // ★DAR-418 왕복 거래비용율(%)
    "trades": [
      {
        "id": "clx...",
        "stockCode": "000001",
        "corpName": "가나기업",
        "tradeDate": "20260622",
        "entryTs": "2026-06-22T10:05:00+09:00",  // ★DAR-435 KST 벽시계 +09:00 오프셋 명시 ISO(진입 분봉 시각)
        "exitTs": "2026-06-22T10:32:00+09:00",    // ★DAR-435 entryTs 와 동일 timebase·OPEN 이면 null
        "entryReason": "VOLUME_BREAKOUT_VWAP",
        "exitReason": "TAKE_PROFIT",               // TAKE_PROFIT | STOP_LOSS | FORCE_CLOSE_EOD | null(OPEN)
        "entryPrice": 10500,
        "exitPrice": 10710,                         // OPEN 이면 null
        "returnPct": 2.0,                           // 순수익률(%, =netReturnPct) — OPEN 이면 null
        "grossReturnPct": 2.31,                     // ★DAR-418 gross 수익률(%, 비용 전) — OPEN 이면 null
        "netReturnPct": 2.0,                        // ★DAR-418 순(net) 수익률(%) — OPEN 이면 null
        "netPnl": 18000,                            // 순손익(KRW) — OPEN 이면 null
        "totalFees": 430,                           // ★DAR-418 총수수료(수수료+세금, KRW) — OPEN 이면 null
        "status": "CLOSED"                          // OPEN | CLOSED
      }
    ]
  }
}
```

표본 0(미진입)에도 `trades:[]` 로 graceful 응답한다(모바일 빈상태 '장중 모의 누적 예정').

모바일 표면화(DAR-416): '전략' 탭(`StrategyComparisonSection`) 하단 별도 섹션 `IntradayScalpSection` 카드 — 일봉 4종 백테스트와 시각 구분(`실시간 모의`·백테스트 불가 고지)·`/status` 누적수익·승률·미니 forward 곡선. 카드 탭 → `app/portfolio/strategy/intraday-scalp.tsx` 거래 타임라인 드릴다운. **DAR-418**: 카드에 '순수익(수수료 후) 기준 · 왕복비용 0.31% · 누적 수수료 N원' 고지, 타임라인 각 행에 메인 수익률을 순(net)으로 표기하고 '세전(gross)·수수료·순손익' 상세를 노출.

---

## 20. 라이브 페이퍼 체결 알림 (Trade Notifications, DAR-424)

라이브로 발생하는 모의투자 체결을 종목별로 통지한다. **대상**: ①분봉 단타(`intraday-scalp`) 진입/청산 ②시스템 모의(`paper-simulation`) 진입/청산. (4종 전략 비교는 과거 백테스트 replay라 라이브 이벤트가 아니므로 **제외**.)

발행 경로는 기존 알림 인프라를 재사용한다 — 엔진5 체결 직후 `NotificationProducerService`(`enqueueTradeEntry`/`enqueueTradeExit`)가 `QUEUE.NOTIFY`(잡 `notify.trade-entry`/`notify.trade-exit`)로 enqueue하고, `NotifyConsumer`가 인박스(`NotificationHistory`) 적재 + Expo Push 발송을 단독 담당한다.

**알림 타입**: `NotificationType.TRADE_ENTRY`(매수 체결) / `TRADE_EXIT`(매도 체결).

**수신자**: ★실제 앱 사용자 **전원**(브로드캐스트). 시스템 모의/단타는 전역 단일 시뮬이라 포지션 소유자(합성 시스템 유저 `provider='system'`)가 아닌 실 사용자가 수신 대상이다. 사용자별 `tradePushEnabled` 토글(기본 ON·§6.2)로 게이트 — OFF면 인박스·푸시 모두 생략. 푸시는 추가로 master `isEnabled` + 유효 디바이스 토큰 필요. 멱등: `(userId, type, refId)` 유니크(refId = 분봉 단타 trade id / 시스템 모의 position id).

**인박스/푸시 내용** (DAR-432 · 2026-07-06 이모지 제거 개정 — 출처명 텍스트, 한 줄 이해, 대괄호 0):
- 매수 — title `{출처명} · {종목명} 매수`, body `₩{체결가} × {수량}주 · 잔액 ₩{현금}`
- 매도 — title `{출처명} · {종목명} 매도 {±수익%}`, body `손익 {±%}({청산사유}) · 평가금 ₩{전체평가금}`
- 출처명은 `strategyKey`로 SSOT(`notification-source.ts`)에서 매핑: 모의(`paper-simulation`)·단타(`intraday-scalp`)·이벤트엣지(`event-edge`)·보수가치(`conservative-value`)·단기모멘텀(`short-momentum`)·공격분산(`aggressive-diversified`); 미등록 키는 '알림' 폴백.
- 예: `단타 · 삼성전자 매수` / `₩105,000 × 10주 · 잔액 ₩9,500,000`, `모의 · 삼성전자 매도 +2.10%` / `손익 +2.10%(TAKE_PROFIT) · 평가금 ₩10,200,000`.
- 푸시 `data`: `{ deepLink, type, refId, channelId, source, strategyKey, strategyName }` — 출처(source=SSOT 라벨)·트랙 식별자(strategyKey/strategyName)·채널을 동봉(DAR-430 채널·DAR-431 딥링크 정합). 빈 값 키는 제외(legacy 호환). `deepLink`는 인박스(`NotificationHistory.deepLink`)에도 동일 충전돼 알림 탭 탭(tap) 라우팅에 쓰인다.

**딥링크 라우팅(DAR-431)**: 체결 알림 탭은 해당 트랙 화면으로 직행한다(포트폴리오 루트 폴백 제거).
- 분봉 단타 → `/portfolio/strategy/intraday-scalp`
- 시스템 모의 → `/portfolio?tab=sim` (포트폴리오 '시스템 모의' 서브탭)
- (4종 전략 `event-edge`·`short-momentum`·`conservative-value`·`aggressive-diversified` 드릴다운은 `/portfolio/strategy/<key>` — 단, 백테스트 전용이라 라이브 체결 알림은 발행하지 않는다.)

모든 deepLink는 모바일 화이트리스트(`@utils/deeplink` `isAllowedDeepLink` — `/portfolio` prefix + 경로 경계/쿼리 규칙)를 통과하며, 임의 라우팅·외부 스킴·트래버설은 거부된다. 트랙 SSOT·역식별은 `@utils/tradeTracks`(`trackByKey`/`trackByDeepLink`). 시스템 모의 딥링크의 `?tab=sim` 은 포트폴리오 화면이 초기 서브탭으로 해석한다(`resolveInitialSubTab` — 허용 목록 밖 값은 `live` 폴백).

현금 = 초기자본 + 실현손익 − 보유 진입원가, 전체평가금 = 현금 + 보유 평가합(현재가 기준)을 체결 시점에 발행 측이 산출해 페이로드에 담는다(point-in-time 보존).

★알림은 통지일 뿐 — 주문 결정/실주문과 무관(AI 금지영역 불침범, 발행은 graceful — 실패해도 체결을 깨지 않음).

모바일: 인앱 알림 탭에 `TRADE_ENTRY`(매수·녹색·`arrow-down-circle`)·`TRADE_EXIT`(매도·주황·`arrow-up-circle`) 렌더(제목 `[{전략}]` prefix 로 트랙 식별), 설정 화면에 '체결 알림' 토글(기본 ON). 트랙별 보유·체결 분리 조회는 포트폴리오 '시스템 모의'(`?tab=sim`)·'전략' 탭(단타 `IntradayScalpSection` + 4전략 비교)·각 드릴다운으로 제공한다. (인앱 알림 탭의 체결 카테고리 내 전략 서브필터는 DAR-430 카테고리 세그먼트 위에 합성 예정.)

### 20.1 출처별 메시지 전략 재설계 (DAR-432 · 2026-07-06 이모지 제거 개정)

푸시·인앱 알림을 "어디서 발행했는지 한눈에"(출처명 텍스트) 보이고 한 줄로 이해하며 탭하면 상세(DAR-431 딥링크)로 가도록 재설계. `[ ]` 대괄호·이모지 없이 출처명+`·`(점) 구분(DAR-430 정합 — 사용자 결정 2026-07-06으로 이모지 제거, 구분은 출처명 텍스트/인앱 Feather 아이콘·타입 컬러/Android 채널 3축).

**출처→출처명 SSOT**: 백엔드 `backend/src/notifications/notification-source.ts` ↔ 모바일 `mobile/utils/notificationSource.ts`(라벨 1:1 동일, `mobile/scripts/check-notification-sources.ts` 결정론 검증). DAR-430 카테고리(3 버킷=채널·필터 축)와 **상호보완**(출처=세분화된 발행원 축).

**출처별 템플릿**:
- 공시(`DISCLOSURE`): title `{기업명} · {공시유형}` / body `{공시명}` (탭→`/disclosure/{rcpNo}`)
- 매수신호(`SIGNAL`): title `{기업명} 매수신호 {등급(한국어)}` / body `{점수}점 · {근거}`
- 청산(`EXIT`): title `{기업명} 청산 권고` · 논리훼손(`THESIS_VIOLATED`): title `{기업명} 투자논리 훼손`
- 체결(`TRADE_ENTRY`/`TRADE_EXIT`): 위 §20 트랙별 출처명 템플릿(모의·단타·이벤트엣지/보수가치/단기모멘텀/공격분산 4전략)
- 리스크·운영(`RISK_ALERT`/`OPS_ALERT`): title `{출처명} · {심각도}` (예: `운영 · 주의`)

**렌더**: 인앱 알림탭은 비공시 타입은 백엔드 `title` 을 그대로(레거시 이모지 발행분만 `stripSourceEmoji` 로 선두 이모지 제거), 공시 행은 조인 데이터(`{기업명} · {공시유형}`)로 렌더(DAR-430 카테고리 칩과 정합). 길이 가이드: 제목 ≤ 약 40자(잠금화면 잘림 고려), 본문 한 줄. 스키마·마이그레이션 무변경(문자열 템플릿만).

---

## 21. 시스템 모의운용 (Paper Simulation, Engine5)

M10 30일 모의운용의 정본 트랙. **전역 단일 시스템 모의**(합성 시스템 유저 `provider='system'`)라 사용자별 분기가 없다 — 조회는 게스트 데모(OptionalJwt), 실행/리셋 등 쓰기는 JWT 필수. persona 4종 분기 운용은 §11, 전략 변형 4종 트랙은 §18, 분봉 단타는 §19 참조.

### 21.1 시스템 모의 기본 트랙

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /paper-trading/simulation/status` | JWT | 모의운용 누적 졸업지표·포트폴리오 진척 조회 |
| `GET /paper-trading/simulation/equity-curve` | OptionalJwt | 모의 자산곡선(일별 평가금액 시계열) + 졸업 진척 |
| `GET /paper-trading/simulation/trade-history` | OptionalJwt | 모의 매매 사유 추적 + 성적표 — 진입/청산 근거·승률·평균손익·누적수익률 |
| `POST /paper-trading/simulation/run-once` | JWT | 모의운용 1일치 사이클 수동 실행(매수→스냅샷→Exit→지표) |
| `POST /paper-trading/simulation/reset` | JWT | 시스템 모의 클린 리셋(DAR-429) — 아래 상세 |
| `GET /paper-trading/portfolio` | JWT | 모의투자 포트폴리오 조회 |

**시스템 모의 클린 리셋 (DAR-429)** — `POST /paper-trading/simulation/reset`은 **body `{ "confirm": "RESET" }` 필수**(휴먼 승인 게이트·cron 자동호출 0). 오염된 모의 이력을 제거하고 초기상태(현금 = 초기자본 10,000,000·OPEN 0)로 복원한다. 해당 sim 유저의 단일 포트폴리오 범위 DELETE만 수행(DB 전역 파괴 금지)·멱등·`$transaction` 전부-or-전무. 단타(intraday-scalp)는 별개 트랙이라 리셋 대상이 아니다.

### 21.2 철학 스타일별 모의운용 (Philosophy Style Simulation)

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /paper-trading/simulation/styles/comparison` | OptionalJwt | 철학 스타일별 모의운용 성과 비교 — 스타일별 자산곡선·승률·누적수익·졸업지표 |
| `POST /paper-trading/simulation/styles/run-once` | JWT | 철학 스타일별 1일치 사이클 수동 실행(스타일×4 분기 운용) |

> live-readiness W1: 스타일 4트랙은 평일 19:40 KST 크론(`ForwardTracksScheduler`, cron-health `paper.style-simulation`)으로 자동 가동된다 — 종전엔 run-once 수동 경로만 있어 미가동이던 결함 교정.
> ★개장 체결 정렬(2026-07-06): 진입은 즉시 체결이 아니라 **PENDING 예약 → 익일 개장 당일 시가 체결**(시스템 모의와 동일 의미론, `docs/workflow.md §6.10`). run-once/사이클 응답에 `reserved`(신규 예약 수)가 추가되고 `bought` 는 '당일 시가로 체결된 이전 예약 수'를 뜻한다. 진입 후보에 entryReady 폴백(buyScore≥50) 적용.

### 21.3 전략 변형 4종 forward 모의운용 (Strategy Forward Simulation, live-readiness W1)

engine3 리플레이 트랙(§18, 과거 1년 재생)과 **별개의 forward 실운용 트랙** — 라이브 TradingSignal(isBackfill=false)에 `strategy-presets` 의 preset.params(minBuyScore·eventTypes allowlist·maxPositions·사이징)를 적용해 전략별 전용 포트폴리오(`모의운용 포트폴리오 [strategy:<key>]`, PaperTrade `styleTag='strategy:<key>'`)를 매일 운용한다. event-edge 는 EventEdgeSelector robust allowlist 를 당일 1회 해석(비면 진입 0, do-no-harm). 청산은 preset.exitRules(익절/손절/최대보유)를 Position exit 파라미터에 대입. 크론: 평일 19:45 KST(cron-health `paper.strategy-forward`). ★실주문 0·AI 0(순수 Rule).
★개장 체결 정렬(2026-07-06): 진입은 **PENDING 예약 → 익일 개장 당일 시가 체결**(시스템 모의와 동일 의미론, `docs/workflow.md §6.10`) — exit 파라미터(preset.exitRules) 대입은 체결기의 Position 생성 시점에 수행. run-once/사이클 응답에 `reserved`(신규 예약 수)가 추가되고 `bought` 는 '당일 시가로 체결된 이전 예약 수'다.

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /paper-trading/simulation/strategies-forward/comparison` | OptionalJwt | 전략별 forward 자산곡선·성적표(승률·누적수익·표본)·랭킹 비교 — 리플레이 비교(§18)와 별개 |
| `POST /paper-trading/simulation/strategies-forward/run-once` | JWT | 전략 4종 forward 1일치 사이클 수동 실행 |

### 21.4 백테스트 vs forward 성과 괴리 (Backtest-Forward Divergence, 견고화 W0·P04, DAR-479)

리플레이 트랙(§18, 과거 1년 재생)과 forward 트랙(§21.3, 오늘 신호→오늘 진입 누적)을 **strategyKey 로 조인**해 백테스트 대비 실운용 괴리를 산출하는 **read-only 측정 표면**(졸업 판정 핵심 지표). 지표 4종 — 수익률·승률·거래빈도(월 환산)·보유기간 — 각각 `gap = forward − backtest` 와 판정(`ALIGNED`/`DIVERGED`/`LOW_SAMPLE`)을 노출한다. 승률은 통일 정의(순손익>0 / 전체 청산, 0~1), gap 판정은 calibration 의미론(|gap|<ε 이면 ALIGNED, 표본 부족은 판정 보류) 계승. 표본 임계는 기존값 준수(백테스트 20건·forward 5건 미만이면 `LOW_SAMPLE`). 일별 스냅샷은 `backtest_forward_divergence_snapshots`(멱등키 strategyKey+snapshotDate)에 forward 크론(19:45 KST) 직후 적재된다. ★조회·적재 전용 — 트레이딩 행동(매수·체결·청산) 무접촉, 실주문 0·AI 0(순수 산술). 전략 파라미터·임계값을 자동 변경하지 않는다.

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /paper-trading/simulation/backtest-forward/divergence` | OptionalJwt | 전략 4종 백테스트 대비 forward 괴리(수익률·승률·거래빈도·보유기간)+임계·판정 |
| `GET /paper-trading/simulation/backtest-forward/:key/trend` | OptionalJwt | 한 전략의 일별 괴리 추세(스냅샷 시계열; `limit` 최근 N일, 기본 90·최대 365) |
| `POST /paper-trading/simulation/backtest-forward/snapshot-once` | JWT | 당일 괴리 스냅샷 수동 적재(멱등 upsert) — 검증·백필 경로 |

### 21.5 듀얼모멘텀 코어 forward 모의운용 (Dual-Momentum Core Forward, 견고화 W1·P13, DAR-494)

코어 트랙(`styleTag='alloc:dual-momentum'`·자본 65% 배분·독립 가상원금 10M)의 **ETF 월말 리밸런싱 forward(모의)**. 판정은 engine3 P12 `decideMonthlyRebalance`(순수 함수·252 거래일 룩백)를 재사용해 `EtfDailyPrice`(360750/069500/153130/273130) asOf 종가로 상대(argmax A,B) ∧ 절대(> 단기채) 모멘텀 → 단일 자산 100% 목표를 산출한다. 체결은 "예약→익일 시가(PENDING)" 의미론 — 월말 SWITCH 시 목표 ETF PENDING 매수 예약(entryTradeDate=nextTradingDay) → 익일 사이클이 **현재 보유 전량 매도(현금 확보) → 목표 전량 매수** 순서로 그 날 시가에 집행(ETF 비용=거래세 0). 크론: 평일 19:50 KST 매일 발화, **판정은 월말 거래일 1회**(P09 `isLastTradingDayOfMonth`+당일 데이터 게이트, cron 'L' 우회·cron-health `paper.dual-momentum-forward`). 결측 시 무행동+전월 유지+OPS_ALERT. 보유·이력은 **FK 없는 전용 모델 `DualMomentumForwardTrade`**(ETF 는 corpCode 없음). 킬스위치 REDUCE_ONLY·현금≥0 자동 적용. 활성 근거: 룰북 §9.3.2 위험조정 게이트(사람 승인 2026-07-03). 위성(변동성 돌파)은 기각·배선 없음. ★실주문 0·AI 0(순수 Rule).

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /paper-trading/simulation/dual-momentum-forward/status` | OptionalJwt | 보유 ETF·자산곡선·누적수익·월말 리밸런싱 이력(모의, 게스트 데모 가능) |
| `GET /paper-trading/simulation/dual-momentum-forward/scorecard` | OptionalJwt | 코어 트랙 스코어카드(견고화 W1·P17, DAR-495) — 자산곡선·누적수익·통일 성적표(승률·평균손익·표본)·현재 보유(ETF 이름 병기)·**다음 월말 판정 예정일**·리밸런싱 이력. 유형 라벨 `trackTypeLabel='자산배분(월단위)'`·`rebalanceFrequency='MONTHLY'`·`lowSample`(임계 6·월단위 트랙 느린 표본 축적)로 정직 표기. `status`(DAR-494)와 별개 표면·기존 응답 무변경(하위호환). 게스트 데모 가능 |
| `POST /paper-trading/simulation/dual-momentum-forward/run-once` | JWT | 코어 forward 1일 사이클 수동 실행(예약 체결→월말 판정·예약→평가; `body.date` 생략 시 오늘 KST) |

**모바일 표면(DAR-495)**: 포트폴리오 '전략' 서브탭(시스템 검증 트랙 비교 화면) 최상단에 **코어 트랙 카드**(`CoreTrackSection`)를 추가 — `scorecard` 응답을 `useCoreTrackScorecard`(React Query·staleTime 5분·장중 폴링 없음)로 소비하고, `trade-scorecard` 통일 정의(누적수익·승률·표본)·`DataLimitBadge`(LOW_SAMPLE)를 재사용한다. **유형 라벨 '자산배분(월단위)'**(layers 아이콘)로 단타·백테스트 4종과 유형을 구분하고(감사 C2), 월 1회 리밸런싱 특성(다음 판정 예정일)·현재 보유(ETF 이름)·미니 자산곡선·리밸런싱 이력을 표기(theme 토큰만·하드코딩 색상 0·read-only 표면). 위성 트랙 관련 표면 없음(기각).

### 21.6 주문 6관문 섀도 원장 · 일일 원장 대조 (Order Shadow Ledger, 견고화 W2·P22, DAR-498)

시스템 모의 예약(PENDING)→체결(FILLED)/취소(CANCELLED)를 **OrderRequest/OrderExecution 원장에 병행 기록**한다(모의·실주문 전송 0). PaperTrade 경로는 무변경(섀도 라이트: 기록 실패가 체결에 영향 0·try/catch 격리). 멱등키=`paper-sim-shadow:<tradingSignalId>`(기존 멱등 체인 기반 결정적). 예약 확정 직전 **`OrderRiskService.evaluateOrder` 첫 실소비**로 판정을 원장에 남긴다(veto 여도 기록만·SHADOW — 모의 체결은 기존 경로 그대로). 전송·체결확인은 **`ExecutionPort`** 인터페이스로 추상화되고, 현 구현체 `PaperExecutionAdapter` 는 fill-simulator 에 위임(외부호출 0)하며 M12 에서 `KisExecutionAdapter` 로 **치환만** 하면 실주문 전송이 발효된다. 스키마 변경 0(기존 OrderRequest/OrderExecution 재사용).

**일일 원장 대조 잡**: 매일 20:45 KST 크론(`OrderLedgerReconcileScheduler`, cron-health `paper.order-ledger-reconcile`)이 같은 KST 거래일 창에서 PaperTrade(파생) 체결과 섀도 원장(EXECUTED+OrderExecution)을 **건수·수량·금액** 정합 대조하고, 불일치(orphan/ghost/수량/금액) 시 P02 `OPS_ALERT`(하루 1건 멱등 `dedupeKey=order-ledger-reconcile:<거래일>`)를 발행한다. ★HTTP 엔드포인트 없음(크론 전용)·read-only 관측·알림 전용 — 매매/원장 무접점(M10 클록 보호)·실주문 0·AI 0(순수 산술). M12 착수 시 '원장 vs 실계좌 대조'로 승격된다.

---

## 22. 포트폴리오·포지션 (Portfolio, Engine4)

활성 포트폴리오·포지션·투자 논리(Position Thesis)·청산 신호(ExitSignal)의 읽기 전용 조회. 모두 JWT 필수.

| 엔드포인트 | 요약 |
|---|---|
| `GET /positions` | 보유 포지션 목록 조회 (OPEN) |
| `GET /positions/:id` | 단일 포지션 조회 |
| `GET /positions/:id/thesis` | Position Thesis(투자 논리) 조회 |
| `GET /positions/:id/exit` | 최신 ExitSignal 조회 |
| `GET /portfolio/summary` | 활성 포트폴리오 요약 조회 |
| `GET /portfolio/risk/latest` | 최신 리스크 스냅샷 조회 — 상세는 §14 |
| `GET /portfolio/briefing/today` | 오늘의 브리핑 조회 (갭분석 W14) — 상세는 §22.1 |

### 22.1 오늘의 브리핑 (갭분석 W14)

**Endpoint**: `GET /portfolio/briefing/today` (JWT 필수)

포지션·관심종목의 당일 공시 이벤트(캐시된 AI 요약 1줄 재사용 — **LLM 신규 호출 $0**, 순수 룰 조립)·일간 손익·점검 필요 포지션·리스크 스냅샷을 하나의 브리핑으로 결합해 반환한다. 포트폴리오 탭 상단 `TodayBriefingSection`이 소비한다.

**Response** (`data`: `TodayBriefing | null`):
```jsonc
{
  "dateKst": "2026-07-16",
  "asOf": "2026-07-16T00:30:00.000Z",   // 조립 시각(데이터 기준 시각 정직 표기)
  "events": [                            // 당일 공시 이벤트 (최대 10건, 0건이면 null)
    { "rcpNo": "2026...", "corpCode": "00126380", "corpName": "삼성전자",
      "reportName": "…", "eventType": "SUPPLY_CONTRACT", "polarity": "POSITIVE",
      "summaryLine": "…(캐시 AI 요약 1줄, 없으면 null)", "source": "POSITION" } // POSITION | WATCHLIST
  ],
  "dailyPnl": { "snapshotDate": "20260715", /* 일간 손익 집계 — 스냅샷 없으면 null */ },
  "checks": [ /* 점검 필요 포지션 최대 5건 (thesisStatus·exitScore·exitAction·reason) — 0건이면 null */ ],
  "risk": null                           // 리스크 스냅샷 뷰 (모바일은 PortfolioRiskBadge 전담이라 의도적 미렌더)
}
```

- **전 섹션 0건이면 `data: null`** — 모바일 0건 억제 패턴과 계약 일치(빈 브리핑 카드 미표시).
- 손익·리스크 섹션은 `PositionDailySnapshot`·`PortfolioRiskSnapshot` 기반이라 현재 모의 트랙만 기록되는 환경에서는 실전 사용자에게 이벤트 섹션만 뜰 수 있다(0건 억제로 무해).
- 푸시 발송(portfolio_digest)은 midTerm 범위 — v1은 인앱 전용.

---

## 23. 저장한 공시 (Saved Disclosures)

사용자가 나중에 보려고 저장(북마크)한 공시. 모두 JWT 필수.

| 엔드포인트 | 요약 |
|---|---|
| `GET /saved-disclosures` | 저장된 공시 목록 조회 |
| `POST /saved-disclosures` | 공시 저장 — body `{ "rcpNo": "20260306000885" }` (14자리 숫자, DAR-282 형식 검증) |
| `DELETE /saved-disclosures/:id` | 저장된 공시 삭제 (by id) |
| `DELETE /saved-disclosures/rcpNo/:rcpNo` | 저장된 공시 삭제 (by rcpNo) |
| `GET /saved-disclosures/check/:rcpNo` | 공시 저장 여부 확인 |

---

## 24. 투자 철학 (Philosophy, Engine2)

거장 철학(P-A 시드) × 종목 적합도(0~100, 결정론적 Rule 산출). 모두 읽기 전용·교육/발견 가치 → **OptionalJwt(게스트 열람 가능)**.

| 엔드포인트 | 요약 |
|---|---|
| `GET /philosophies` | 투자자 철학 목록 (P-A 시드 — 지표·출처 포함) |
| `GET /philosophies/:id/fit?corpCode={8자리}&fsDiv=CFS\|OFS` | 철학 1종 × 종목 적합도(0~100) + 통과/미달 근거. `corpCode` 필수(누락 시 400), `fsDiv` 기본 `CFS` |
| `GET /companies/:corpCode/philosophy-fit?fsDiv=` | 종목 × 거장별 적합도 (전체 철학, 점수 내림차순) |
| `GET /companies/:corpCode/persona-philosophy-fusion` | 종목 × 거장 철학 × AI 관점 결합 (결합점수·근거·표본·신뢰도) — 순수 Rule 결합, AI 신규 호출 0 |

---

## 25. 재무지표·내부자 지분 (Financials·Insider Holdings, Engine1)

### 25.1 재무지표 (Financials)

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /financials/latest?corpCode={8자리}&fsDiv=CFS\|OFS` | OptionalJwt | 기업 최신 재무지표 조회 (종목 상세 펀더멘털 카드, DAR-96 — 게스트 열람) |
| `POST /financials/collect?bsnsYear=&reprtCode=&fsDiv=&limit=&scope=` | JWT | 재무지표 수동 수집 (DART 재무제표 → `CompanyFinancial`, 멱등) |
| `POST /financials/backfill?bsnsYears=&fsDiv=&limit=&scope=` | JWT | 재무지표 분기 시계열 백필 (reprtCode 11011~11014 × 연도, 멱등) |

### 25.2 내부자/대량보유 지분변동 (Insider Holdings)

```
GET /api/insider-holdings   (OptionalJwt — 게스트 열람)
```

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `corpCode` | string | 선택 | 기업 필터 |
| `tradeType` | string | 선택 | 순매수 방향 (`BUY` \| `SELL` \| `MIXED` \| `UNKNOWN`) |
| `source` | string | 선택 | 출처 (`MAJOR_STOCK` 대량보유 \| `EXECUTIVE` 임원·주요주주) |
| `from` / `to` | string (YYYYMMDD) | 선택 | 기간 필터 |
| `page` / `limit` | number | 선택 | 페이지네이션 |

---

## 26. 공시 원문 파싱·정량 팩트·이벤트 (Engine1)

### 26.1 공시 원문 파싱 (document-parsing) — JWT 필수(운영)

| 엔드포인트 | 요약 |
|---|---|
| `POST /document-parsing/parse/:rcpNo` | 단건 공시 원문 파싱 (수동 트리거) |
| `POST /document-parsing/batch` | PENDING 상태 배치 파싱 |
| `POST /document-parsing/retry` | 파싱 실패 건 재처리 큐 강제 실행 |
| `GET /document-parsing/stats` | 파싱 상태 현황 집계 (ParseStatus별 건수) |
| `GET /document-parsing/:rcpNo` | 파싱 결과 단건 조회 (rawText 제외) |
| `POST /document-parsing/facts/backfill` | `DartFiledFact` 일괄 backfill (DONE 문서 소급 적재) |
| `POST /document-parsing/facts/:rcpNo` | 단건 공시 정량 fact 적재 (parsedJson → `DartFiledFact`) |
| `GET /document-parsing/facts/:rcpNo` | 단건 공시 적재 fact 조회 (factKey 정렬) |

### 26.2 공시 본문 정량 fact 조회 (게스트)

```
GET /api/disclosure-facts/:rcpNo   (인증 불요 — 공시 상세 화면 소비용, DAR-112)
```

공시 본문에서 추출·적재된 정량값(계약금액·전환가·배당성향 등)을 rcpNo 단위로 반환한다(read-only). 추출 fact가 없으면 빈 배열(화면 빈 상태 분기).

### 26.3 공시 이벤트 (disclosure-events)

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /disclosure-events?corpCode=&eventType=&extractionStatus=&page=&limit=` | 불요 | 이벤트 목록 조회 (필터·페이지네이션) |
| `GET /disclosure-events/:rcpNo` | 불요 | 단건 이벤트 조회 |
| `POST /disclosure-events/extract/:rcpNo` | JWT | 단건 이벤트 추출 (수동 트리거) |
| `POST /disclosure-events/batch?limit=` | JWT | 미처리 이벤트 일괄 추출 |
| `POST /disclosure-events/reprocess?limit=` | JWT | 신규 extractor 재추출 |

### 26.4 예정 이벤트 캘린더 (upcoming-events, DAR-538)

```
GET /api/upcoming-events?days=90   (JWT 필수)
```

관심기업의 공시 이벤트 추출 수치(`DisclosureEvent.extractedData`)에 존재하는 날짜 필드에서 파생한 **[오늘, 오늘+days] 예정 이벤트 D-day 목록**(read-only, 스키마 무변경). `days` 기본 90, 최대 365. 기준일(`baseDate`)은 KST 오늘.

- 파생 대상 7종: 배당 기준일·배당 지급일(`DIVIDEND_INCREASE`/`DIVIDEND_CUT`), 유상증자 청약일·신주 상장 예정일(`PAID_IN_CAPITAL_INCREASE`/`THIRD_PARTY_ALLOTMENT`), 사채 만기일(`CB_ISSUANCE`/`BW_ISSUANCE`), 자사주 취득 종료일(`SHARE_BUYBACK`), 거래재개 예정일(`TRADING_SUSPENSION`).
- **정직 규약**: 추출기가 실제로 남긴 유효한 `YYYY-MM-DD`만 파생한다 — 결측·형식 불일치·비실재 날짜는 미표시(발명 금지). 보호예수 해제일은 데이터 소스 부재로 v1 미지원.
- 정정공시가 `originalRcpNo`로 지목한 원공시 이벤트는 제외(구 날짜 유령 방지). 동일 (기업, 종류, 날짜)는 최신 접수번호 1건.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "baseDate": "2026-07-17",
    "days": 90,
    "items": [
      {
        "kind": "SUBSCRIPTION",
        "label": "유상증자 청약일",
        "date": "2026-08-03",
        "dDay": 17,
        "corpCode": "00126380",
        "corpName": "삼성전자",
        "stockCode": "005930",
        "rcpNo": "20260717000123",
        "eventType": "PAID_IN_CAPITAL_INCREASE"
      }
    ]
  }
}
```

---

## 27. 수집 파이프라인·스케줄러 운영 (Engine1)

운영/내부용 트리거·리포트. **모두 JWT 필수.**

### 27.1 공시 수집 스케줄러 (scheduler)

| 엔드포인트 | 요약 |
|---|---|
| `POST /scheduler/collect` | 공시 수동 수집 (날짜 지정) |
| `GET /scheduler/collection-logs` | 공시 수집 이력 조회 (최근 50건) |
| `GET /scheduler/backfill-coverage` | 연속 과거 확장 백필 커버리지(read-only) — 최소·최대 rcpDt·총건수·프런티어·하한 도달 여부 |
| `POST /scheduler/backfill-extend` | 연속 과거 확장 백필 1회 실행 (멱등·쿼터 인지·알림 미발송, cron과 동일 경로) |

### 27.2 파이프라인 운영 (pipeline)

| 엔드포인트 | 요약 |
|---|---|
| `GET /pipeline/health` | 수집→파싱→이벤트→AI 단계별 건수·지연·실패 행 스냅샷 (read-only) |
| `GET /pipeline/drain-progress` | 문서 파싱 DONE%·잔여 백로그·ETA (DAR-392, read-only) |
| `POST /pipeline/drain` | 폐루프 누락분 backfill 1회 실행 (멱등 — 누락문서 큐등록→PENDING 파싱→무이벤트 추출, AI는 자동 체이닝) |
| `POST /pipeline/reprocess-ai` | AI summary 미도달 자격 이벤트(SUCCESS\|NEEDS_REVIEW) 큐 재발행 (운영자 수동 전용·멱등) |
| `GET /pipeline/event-coverage` | rcpDt 월(YYYYMM)별 이벤트 추출 커버리지 분포 (read-only) |
| `POST /pipeline/event-backfill` | 과거 백필 공시 이벤트 추출 1회 실행 (멱등·Rule 추출·AI 신규 호출 0) |
| `GET /pipeline/title-event-backfill-progress` | 제목 기반 이벤트 백필 진행 리포트 (read-only) — 잔여 후보·생성 누계(TITLE_ONLY 마커 분리 집계) (갭분석 W4) |
| `POST /pipeline/title-event-backfill?scanLimit=&startAfterRcpDt=&startAfterRcpNo=` | 제목(reportName) 룰 분류만으로 과거 백필 공시 이벤트 생성 1회 실행 (멱등·**DART 호출 0·AI 호출 0**·문서 fetch 미트리거 — cron 매일 02:40 KST와 동일 경로, `docs/workflow.md` §2.15) (갭분석 W4) |
| `GET /pipeline/rawtext-offload-progress` | rawText 오프로드 진행 리포트 — 잔여/완료율·활성 드라이버(s3\|local) |
| `POST /pipeline/rawtext-offload` | 과거 rawText → 객체 스토리지(S3/로컬) 1회 오프로드 (멱등·DB 컬럼 비움) |
| `GET /pipeline/tables-offload-progress` | tables 오프로드 진행 리포트 — 잔여/완료율·활성 드라이버 |
| `POST /pipeline/tables-offload` | 과거 tables → 객체 스토리지 1회 오프로드 (멱등·DB 컬럼 비움) |

---

## 28. 시세 수집·지표·종목상태 운영 (Engine3)

### 28.1 KRX/KIS 시세 수집·백필 (market-data) — JWT 필수(운영)

읽기 전용 시세 조회(quote·minute-candles·candles·indices/latest)는 §13·§15·§17 참조.

| 엔드포인트 | 요약 |
|---|---|
| `POST /market-data/collect/daily` | KRX 일봉 수동 수집 (날짜 지정) |
| `POST /market-data/collect/indices` | KRX 시장지수 수동 수집 |
| `POST /market-data/backfill/indices` | 시장지수 히스토리 백필 |
| `POST /market-data/collect/status` | KRX 종목상태 수동 수집 |
| `POST /market-data/collect/all` | KRX EOD 통합 수집 (일봉+지수+종목상태) |
| `POST /market-data/collect/catch-up` | KRX 일봉·지수 캐치업 — 마지막 적재일~최신 가용 거래일 갭 멱등 백필 (DAR-375, KRX 프로브로 정체 극복) |
| `POST /market-data/collect/investor-flow?cap=` | 수급·공매도 수동 수집 — `InvestorFlowDaily`+`ShortSellingDaily` 멱등 적재 (cron 3슬롯 외 단발 트리거/백필, `cap`으로 KIS 유량 가드 — 기본 env `INVESTOR_FLOW_COLLECT_CAP`→3000) (갭분석 W16, 조회는 §33) |
| `POST /market-data/sync-company-markets?basDd=` | KRX 기준정보로 `company.market` KOSPI/KOSDAQ 분류·백필 (DAR-328, 멱등) |
| `POST /market-data/backfill/daily` | KRX 히스토리컬 일봉 백필 (과거 N거래일, 멱등) |
| `POST /market-data/backfill/deep?days=` | KRX 일봉 과거 깊이 백필 — 가장 오래된 적재일부터 더 과거로 (DAR-376, 재개 가능·멱등, 기본 120거래일) |
| `POST /market-data/collect/minute-prices` | 분봉 수동 수집 — §13.3 참조 |
| `GET /market-data/coverage` | 일봉 적재 커버리지·갭 리포트 (DAR-376) — 유니버스 대비 누락 종목·거래일 범위·총 행수 |
| `GET /market-data/collection-logs` | 시세 수집 이력 조회 (최근 20건) |

### 28.2 기술지표 백필 (indicators)

```
POST /api/indicators/backfill   (JWT 필수)
```

DB 일봉 → `technical_indicators` 기술지표 백필 (멱등).

### 28.3 종목 위험상태 (stock-status)

```
GET /api/stock-status/risk?corpCode=&stockCode=   (OptionalJwt — 게스트 열람)
```

관리종목·거래정지·상폐위험 조회 (DART 공시 폴백·근사값, 손실 회피 1차 방어선, DAR-99).

---

## 29. 백테스트·신호 정확도·신호 생성 (Engine3)

### 29.1 1년 리플레이 백테스트 (backtest)

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `POST /backtest/replay` | JWT | 1년 자동매매 point-in-time 리플레이 실행 + 트랙레코드 저장 (미래모름 백테스트) |
| `GET /backtest/track-record` | OptionalJwt | 최신 1년 백테스트 트랙레코드 조회 (게스트 데모) |
| `GET /backtest/track-record/:id` | OptionalJwt | id별 트랙레코드 조회 (게스트 데모) |

### 29.2 신호 사후검증·보정 (signal-accuracy) — OptionalJwt

공통 쿼리: `limit`·`eventType`·`signalGrade`. `signal-accuracy`·`calibration` 은 추가로 `from`·`to`(공시 접수일 rcpDt `YYYYMMDD`, 포함) 지원 — 미지정/무효 시 기본 기간(최근 12개월, KST).

| 엔드포인트 | 요약 |
|---|---|
| `GET /backtest/signal-accuracy` | 신호 사후검증 — 등급·스코어구간·eventType별 D+5/D+20 실현 초과수익 정밀도 |
| `GET /backtest/calibration` | 신호 보정 루프 — 실현 초과수익 vs `EVENT_BASE_SCORES` 괴리·권장 delta (diff형 권고, **자동적용 금지**) |
| `GET /backtest/feature-ab` | 피처 A/B 백테스트 — 성장률/DartFiledFact/내부자 피처 포함 vs 미포함 재채점 비교 (증거 리포트, **가중치 자동변경 금지**) |
| `GET /backtest/evaluation-corpus` | 평가자료·인과코퍼스 — §16.4 참조 |

**표본 설계 (TB-2, 2026-07-03)**: `signal-accuracy`/`calibration` 의 표본은 종전 '최신순 take(limit)'에서 ① `(rcpNo, eventType)` 단위 dedup(persona 4행 복제 제거 — 대표 = 사전순 첫 persona 행) ② rcpDt 기간(`from`/`to`) 내 **월별 층화 샘플링**(접수월별 균등 추출, `limit` = dedup 후 표본 상한)으로 변경. 파라미터 미지정 시 새 기본 동작(최근 12개월 층화) — 응답 스키마는 불변(additive).

**리스크 축 분리 (TB-3, 2026-07-03)**: `data.gradePrecision` 의 등급 단조성(`monotonicityD5/D20`·`isRobustMonotonic`)은 소프트 축(`STRONG_BUY_CANDIDATE>BUY_CANDIDATE>WATCH>NEUTRAL>AVOID`)만 판정한다. `BLOCKED` 는 수익 서열이 아닌 리스크 하드차단이라 제외되고, `data.riskBlockStats { blockedCount }` 로 건수만 분리 보고(차단 종목의 후속 정지/관리 실현 검증은 상태 이력 데이터 부재로 미제공).

### 29.3 신호 생성 운영 (signal-generation) — JWT 필수

| 엔드포인트 | 요약 |
|---|---|
| `POST /signals/generate` | 매수 신호 수동 생성 (대상: 이벤트+시세 있고 `TradingSignal` 없는 공시) |
| `POST /signals/regenerate` | 매수 신호 재생성·재채점 (기존 신호 upsert 갱신 — TI 백필 후 chart/entryReady 반영, DAR-50) |
| `POST /signals/generate-backfill` | 과거(백필) 공시 point-in-time 신호 백필 (분석·백테스트용 — 가격≤rcpDt as-of, 멱등, AI 미개입, DAR-389). TB-1(2026-07-03): 상태플래그(`StockStatus` 현재 스냅샷) 하드차단은 백필에 미적용(등급 배정 lookahead 차단 — 라이브는 유지), 이벤트타입 하드블록 3종(rcpDt 시점 파생, PIT 안전)은 유지 |

---

## 30. 졸업 게이트·감사 로그 (Engine5)

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /graduation/metrics` | OptionalJwt | 졸업 게이트(G1 적중률·G2 누적수익·G3 AI비용/순익·G5 Exit정확도) 현재값 vs 기준·통과여부·표본수 + 30일 모의운용 진행률(경과/잔여일·측정대기) |
| `GET /graduation/funnel` | OptionalJwt | 신호→진입 퍼널(DAR-109) — 당일 생성 신호→후보 통과→체결의 일별·누적 전환율(채택률·체결률·신호→체결). 졸업 표본 누적 모니터링 |
| `GET /trading/audit-logs?from=&to=&actorKind=&action=&orderRequestId=&page=&limit=` | JWT | 거래 감사로그 조회 (DAR-351, 운영자용) |
| `GET /trading/auto-status` | OptionalJwt | 자동매매 실행상태(읽기전용 투명성) — 상세는 §11.4 |

---

## 31. 운영·관측 (Ops·Health·Storage)

### 31.1 헬스체크 (인증 불요)

| 엔드포인트 | 요약 |
|---|---|
| `GET /health` | readiness — DB·BullMQ(Redis) 도달성 + 외부키(DART/KRX/LLM) 존재/형식 점검(실호출 없음). prod 외부 헬스체크·배포 검증에 사용 |
| `GET /health/live` | liveness — 프로세스 응답 가능 여부 (외부 의존 점검 없음) |

### 31.2 운영 지표·수집 현황 (인증 불요 — 운영/내부용)

| 엔드포인트 | 요약 |
|---|---|
| `GET /ops/metrics` | 운영 핵심 카운터(JSON) — AI누적·최근신호·모의포지션·마지막수집(freshness)·졸업지표 G1/G2/G3/G5·**슬리피지 분포(DAR-474)** |
| `GET /collection/status` | 수집 현황 집계 — 공시·재무·시세지표·모의운용 파이프라인 커버리지·최근 수집시각·성숙도 배지 (read-only) |
| `GET /collection/freshness` | 데이터 신선도/크론 헬스 — 수집 크론 마지막 성공시각·처리건수·stale(정체) 판정 (read-only, 조용한 수집 정체 안전망) |

**`GET /ops/metrics` 슬리피지 분포(DAR-474, `data.slippage`)** — read-only 집계(체결·주문·AI 개입 0). 산출 실패 시 `null`(graceful, 카운터 본체는 유지):
```jsonc
"slippage": {
  "overall": { "tradeCount": 42, "avgSlippageKrw": 812.5, "p95SlippageKrw": 2100.0,
               "totalFeesKrw": 15600.0, "avgSlippageBps": 63.2, "p95SlippageBps": 210.0, "bpsSampleSize": 30 },
  "byTrack": [
    { "styleTag": "paper-simulation", "tradeCount": 20, "avgSlippageKrw": 900.0, "p95SlippageKrw": 2100.0,
      "totalFeesKrw": 8000.0, "avgSlippageBps": 70.0, "p95SlippageBps": 210.0, "bpsSampleSize": 20 },
    { "styleTag": "intraday-scalp", "tradeCount": 10, "avgSlippageKrw": 500.0, "p95SlippageKrw": 900.0,
      "totalFeesKrw": 5000.0, "avgSlippageBps": null, "p95SlippageBps": null, "bpsSampleSize": 0 }
  ]
}
```
- **Krw**: 체결 시 기록된 `PaperTrade.slippage`/`IntradayScalpTrade.slippage` 원가 절대값(체결일 기준가 대비 체결 마찰).
- **Bps**: 신호시점 기대가(`PaperTrade.expectedPrice`, 없으면 `entryPrice` 폴백) 대비 실현 슬리피지(부호=불리 방향 양수). 실전 전환 게이트("슬리피지 기대 이내 시 증액")가 소비. `expectedPrice` 보존분만 산정 — 레거시/단타 트랙은 `null`(과신 방지).
- **totalFeesKrw**: 수수료+세금 합 — ★슬리피지와 **구분 유지**(단타 `totalFees` SSOT 정합).
- 트랙(`styleTag`): 시스템 모의(`paper-simulation`)·전략 4종(`strategy:*`)·철학 4종·분봉 단타(`intraday-scalp`)·미태깅 매도(`(untagged)`).

### 31.3 스토리지 운영 (storage) — JWT 필수

| 엔드포인트 | 요약 |
|---|---|
| `GET /storage/health` | DB 크기·테이블별 용량·rawText 오프로드 진행·객체 스토리지 용량·로컬 임계 경고 (read-only) |
| `POST /storage/vacuum?table=&full=` | VACUUM (FULL) 디스크 실회수 + 전후 크기 리포트 (★운영자 수동·오프피크 전용·ACCESS EXCLUSIVE 락·테이블 화이트리스트) |
| `POST /storage/cleanup-local-artifacts?limit=` | 로컬 원시 파일(rawFilePath) 삭제 + 컬럼 비움 1회 배치 (멱등) |
| `POST /storage/lifecycle` | rawText 객체 콜드 라이프사이클(STANDARD_IA@30d→GLACIER@90d) 적용 (멱등, S3만 실적용·로컬 no-op) |

### 31.4 일일 운영 리포트 잡 (cron `ops.daily-report`, DAR-477) — HTTP 엔드포인트 없음

`GET /ops/metrics`(§31.2)가 상시 조회형인 데 반해, **`OpsDailyReportScheduler`(매일 20:30 KST — forward 트랙 19:40/19:45 이후)** 가 하루 1회 운영 요약을 능동 생성해 **OPS_ALERT 채널(DAR-473 `enqueueOpsAlert`)** 로 발송한다. `OpsMetricsService.getMetrics`(슬리피지·freshness·신호·AI비용) 집계를 재사용하고 다음을 더한다:
- **트랙별 손익**: 누적 실현(CLOSED `Position.unrealizedPnl` 합·strategy-forward equity 관점) + 현재 평가(OPEN 합) — 포트폴리오 단위(시스템 모의·전략 4종·철학 4종) + 분봉 단타(`IntradayScalpTrade.netPnl`).
- **체결 건수(최근 24h)**: `PaperTrade`(filledShares>0·filledAt) + `IntradayScalpTrade`(CLOSED·exitTs), styleTag 트랙별.
- **크론 실패·오류율(최근 24h)**: `CronRunLog` status=FAILED/전체(총 0이면 `null`, 가짜 비율 금지) + `GET /collection/freshness` stale 연계.
- **슬리피지 요약**: §31.2 `data.slippage`(DAR-474) 재사용.

심각도는 크론 실패·정체 시 `WARNING`·아니면 `INFO`. 멱등 자연키 `daily-report:<KST거래일>`(하루 1건). 실행 헬스는 `CronRunLog`(`ops.daily-report`)에 기록되어 §31.2 freshness 안전망에 노출(`FRESHNESS_JOB_SPECS` 등록·48h stale 임계). ★read-only 관측·알림 전용 — 실주문/Kill Switch 무직결·측정 트랙 매매 행동 무변경(M10 클록 보호).

### 31.5 격주 트랙 성과 순위 리포트 — JWT 필수

| 엔드포인트 | 요약 |
|---|---|
| `GET /api/ops/track-review` | 격주 트랙 성과 순위 리포트(온디맨드 계산) — 모의투자 전 트랙의 **트레일링 14일(캘린더, KST) 실현 성과** 순위 + 시장국면 태깅. 영속 모델 없음(스키마 변경 0) |

**응답(`data`: `BiweeklyTrackReview`)** — read-only 집계(체결·주문·킬스위치·AI 개입 0):
```jsonc
{
  "generatedAt": "2026-07-12T01:00:00.000Z",
  "periodStartKst": "2026-06-29",  // 윈도 첫날(KST 자정 포함)
  "periodEndKst": "2026-07-12",    // 생성일(포함) — 트레일링 14 캘린더 일
  "windowDays": 14,
  "regime": {                       // market-regime Rule(DAR-130) 재사용 — 판정 실패 시 null(graceful)
    "trend": "UPTREND", "volatility": "NORMAL", "eventSkew": "OPPORTUNITY",
    "trendChangePct": 4.3, "dailyVolatilityPct": 0.9,
    "indexSampleSize": 40, "eventSampleSize": 120, "dataLimited": false, "asOf": "20260710"
  },
  "tracks": [                       // 수익률 내림차순 순위(동률: 청산 desc → trackKey asc)
    { "trackKey": "strategy:event-edge", "label": "전략 이벤트엣지", "rank": 1,
      "closedTrades": 12, "wins": 7, "winRatePct": 58.3,
      "realizedPnlKrw": 234000, "initialCapitalKrw": 10000000, "returnPct": 2.34,
      "avgHoldDays": 4.2, "lowSample": false },
    { "trackKey": "intraday-scalp", "label": "분봉 단타", "rank": 2,
      "closedTrades": 2, "wins": 1, "winRatePct": 50,
      "realizedPnlKrw": -12000, "initialCapitalKrw": 10000000, "returnPct": -0.12,
      "avgHoldDays": 0.02, "lowSample": true }   // 청산<5 정직 표기(순위에는 포함)
  ],
  "body": "격주 트랙 성과 리포트 (2026-06-29 ~ 2026-07-12 KST · 트레일링 14일)\n..." // 발송 본문(이모지 미사용)
}
```
- **전부 CLOSED/실현 기준** — 보유(OPEN) 평가손익 미포함. 승률·평균보유는 청산 0건이면 `null`(가짜 비율 금지).
- **트랙**: 시스템 모의(`paper-simulation`)·철학 4종(`BUFFETT`/`LYNCH`/`GREENBLATT`/`DRUCKENMILLER`)·전략 forward(`strategy:*` 동적 수집)·분봉 단타(`intraday-scalp`)·듀얼모멘텀 코어(`alloc:dual-momentum`). 수익률 분모는 각 트랙 원금 상수(1천만원).
- **발송 잡(cron `ops.biweekly-track-review`)**: 매주 일요일 10:00 KST 발화 + **격주 게이트**(고정 앵커 `20260712` 일요일 기준 짝수 주차만 실행·오프 주는 SKIPPED). OPS_ALERT 채널(`INFO`·source `biweekly-track-review`), 멱등키 `biweekly-track-review:<앵커기준 회차>`, `deepLink=/portfolio`. freshness 안전망 등록(stale 임계 17일 — 격주 카덴스+3일). 배치 상세: `docs/workflow.md` §2.13.

### 31.6 공시 알림 지연 계측 (갭분석 W5) — 인증 불요(운영/내부용)

```
GET /api/ops/notification-latency?days=7
```

공시(DISCLOSURE) 알림의 **감지(`Disclosure.createdAt`)→푸시 발송(`NotificationHistory.sentAt`)** 지연을 KST 일별 p50/p95/max로 집계한다(read-only — 신규 테이블·수집·외부호출 0, 기존 테이블 집계만). "경쟁사는 주장, 우리는 측정치" 전환의 데이터 소스.

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `days` | number | 선택 | 집계 윈도(일, 1~30 클램프, 기본 7 — KST 오늘 포함 최근 N일) |

**Response** (`data`: `DisclosureLatencyReport`):
```jsonc
{
  "metric": "disclosure-detect-to-push",
  "definition": "…",            // ★정직성 계약: DART API에 접수 시각이 없어(rcept_dt는 일자뿐)
                                 //   접수→푸시 E2E가 아닌 '감지→푸시' 구간임을 명시
  "windowDays": 7,
  "generatedAt": "2026-07-16T00:00:00.000Z",
  "daily": [                     // 최신 일자 우선. 표본 없는 일자는 행 미생성
    { "kstDate": "2026-07-16", "count": 120,
      "detectToPushP50Ms": 42000, "detectToPushP95Ms": 95000, "detectToPushMaxMs": 180000 }
  ]
}
```

### 31.6.1 에디션 밀도 실측 (DAR-513, Wave A/A3) — 인증 불요(운영/내부용)

```
GET /api/ops/edition-density?days=60
```

'1거래일=1호' 일일 투자판단 에디션이 '대부분 빈 신문'인지 판정할 데이터를 산출한다. 최근 N(기본 60) **거래일**의 일자별 **에디션 신호 건수** 분포(중앙값·평균·p25/p75·0건일 비율·히스토그램)와 판정을 반환한다(read-only — 신규 테이블·수집·외부호출·체결·AI 개입·마이그레이션 0, `trading_signals`·`stock_daily_prices` 집계만). prod DB에 읽기 전용으로 안전 실행 가능.

- **에디션 신호 정의(정직성 계약)**: 매수등급(`STRONG_BUY`+`BUY`)·백필 제외(`disclosure.isBackfill=false`) `TradingSignal`. 귀속 거래일 = `createdAt`을 KST로 이중 환산한 날짜(`(… AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date`).
- **★DAR-553 dedup 병기(2026-07-17)**: `buyGrade`(주계열)는 `TradingSignal` **원시 행수** — 자연키가 `(corpCode,rcpNo,eventType,persona)`라 페르소나별 중복을 포함할 수 있다. `GET /signals/daily-editions`가 세는 실제 '호' 카드 수와 **1:1 일치하는 계열은 `buyGradeUniqueCorp`**(corpCode dedup)다. 기존 `buyGrade`/`verdict`(수용기준 판정)는 회귀 방지를 위해 그대로 유지하고, `buyGradeUniqueCorp`는 해석 정정용으로 병기한다.
- **거래일 열거**: `common/time/market-calendar`(SSOT, KRX 2024~2026 동결)의 `isTradingDay`/`prevTradingDay`. 주말·공휴일 자동 제외.
- **앵커**: 최근 '완료된' 거래일(KST 19:15 신호 크론 완료 후 오늘, 그 전이면 직전 거래일 — 오늘 미완료 에디션이 0건일 비율을 오염시키지 않도록 제외).
- **판정(수용기준)**: `median < 2` **또는** `zeroDayRatio > 0.40`이면 `fallbackProposalTriggered=true` → 비신호 콘텐츠 폴백 스코프 제안서(`docs/roadmap/cc-edition-density-fallback-proposal-2026-07-17.md`) 오너 판정 회부. ★판정은 지금도 `buyGrade`(원시) 기준 — dedup 계열 도입이 임계 로직을 바꾸지 않는다.
- **보조 계열**: `allGrade`(전등급 신호 밀도) — 파이프라인이 신호는 만들지만 매수등급이 아닐 뿐인지(폴백 여지) 진단. `buyGradeUniqueCorp`(corpCode dedup 매수등급 밀도) — 실제 노출 카드 수 기준 해석용.
- **분모 교차검증**: 캘린더 거래일 수 vs 윈도 구간 일봉(`StockDailyPrice`) 실재 거래일 distinct 수 대조(불일치 시 캘린더 누락 공휴일/시세 수집 공백 의심).

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `days` | number | 선택 | 집계 거래일 수(1~120 클램프, 기본 60) — 최근 완료 거래일 기준 역산 |

**Response** (`data`: `EditionDensityReport`):
```jsonc
{
  "metric": "edition-signal-density",
  "definition": "에디션 신호 = 매수등급(STRONG_BUY+BUY)·백필 제외 … (정직성 계약)",
  "windowTradingDays": 60,
  "anchorEndDate": "20260716",     // 최근 완료 거래일(YYYYMMDD)
  "oldestDate": "20260421",
  "todayDate": "20260717",
  "todayIncludedInWindow": false,  // 오늘 19:15 KST 전이면 제외(0건일 오염 차단)
  "generatedAt": "2026-07-16T18:14:58.838Z",
  "buyGrade": {                    // ★주계열: 매수등급 TradingSignal 원시 행 밀도(페르소나 중복 포함 가능)
    "days": 60, "totalSignals": 34, "mean": 0.57, "median": 0,
    "min": 0, "max": 17, "p25": 0, "p75": 0,
    "zeroDays": 55, "zeroDayRatio": 0.9167,
    "histogram": [ { "bucket": "0", "days": 55 }, /* 1,2,3-4,5-9,10+ */ ]
  },
  "allGrade": { /* 전등급 신호 밀도(동일 구조) — 폴백 여지 진단 */ },
  "buyGradeUniqueCorp": { /* DAR-553: corpCode dedup 매수등급 밀도(동일 구조) — daily-editions count와 1:1 */ },
  "verdict": {
    "medianBelowThreshold": true, "zeroDayRatioAboveThreshold": true,
    "fallbackProposalTriggered": true,
    "thresholds": { "medianLt": 2, "zeroDayRatioGt": 0.4 },
    "proposalDoc": "docs/roadmap/cc-edition-density-fallback-proposal-2026-07-17.md",
    "summary": "트리거: 중앙값 0 < 2 · 0건일 비율 91.7% > 40% → …"
  },
  "tradingDayCrossCheck": {
    "calendarTradingDays": 60, "marketDataTradingDays": 41, "matches": false, "note": "…"
  },
  "daily": [ { "date": "20260717", "buyCount": 0, "totalCount": 0, "uniqueCorpBuyCount": 0 } /* 최신 우선, N행 */ ]
}
```

> ★위 예시 수치는 **dev/데모 DB**(신호 8일치, 2026-06 한정) 실행 결과다. 권위 판정(수용기준 (1)(2))은 **prod 읽기 전용** 실행값으로 산출한다.

### 31.6.2 DART 야간 쿼터 소진 포렌식 (DAR-536) — 인증 불요(운영/내부용)

```
GET /api/ops/dart-quota-forensics?date=YYYYMMDD
```

해당 KST 일자(기본 오늘)의 **DART API 소비를 경로별로 정량 분해**하고, DAR-532 가 세운 **'야간 다중 재기동 예산 재개방' 가설을 판정 필드로 답한다**(read-only — 신규 테이블·수집·외부호출·체결·AI 개입·마이그레이션 0, 기존 로그/메타 테이블 집계만). prod DB 직접 접근 없이 배포된 앱이 자기 DB 를 읽으므로 PM 이 prod 에서 조회해 판정한다(DAR-536 PM 재정의).

- **소비 경로 7종(고정)**: `LIST_FORWARD`(라이브/오프아워/델타 목록, `disclosure_collection_logs` triggeredBy≠`BACKFILL_EXTEND`) · `LIST_BACKFILL_EXTEND`(고대 백필 목록 확장) · `DOC_FETCH_LIVE`/`DOC_FETCH_BACKFILL`(문서 원문 fetch, `disclosure_documents.fetchedAt` × `disclosures.isBackfill`) · `FINANCIALS`(재무 재수화, `company_financials.updatedAt` 터치) · `INSIDER_HOLDINGS`(지분·내부자, `insider_holding_changes.updatedAt` 터치 — 약한 프록시) · `TABLES_LAZY_FETCH`(**구조적 0** — DAR-399 tables 는 S3 lazy fetch 라 DART 재호출 없음).
- **추정 규칙(정직성 계약)**: 모든 수치는 **저장 흔적 기준 하한** — list 콜 = `max(1, ceil(fetchedCount/100))`(1페이지=1콜), 문서 fetch = 1건=1콜, 재무/지분 = 창 내 터치 행수. HTTP 재시도·무저장 응답(013/오류) 콜은 미관측. 경로별 `evidence` 에 산출 규칙, `caveats` 에 한계를 그대로 동봉한다.
- **야간 창**: 00:00~08:29 KST(자정 쿼터 리셋 직후 ~ 08:30 프리플라이트 직전) — `night` 요약(상위 경로 3건 포함) + 24시간 `hourly` 컨텍스트.
- **재기동 마커**: 당일 시작 후 종료시각 없이 `RUNNING` 고착된 실행(수집/크론/재무 로그, 유예 30분) = 실행 중 프로세스 사망의 영구 흔적(재기동 횟수 하한).
- **가설 판정** `hypothesis.verdict`: `SUPPORTED`(야간 추정 하한 > 단일 프로세스 벌크 상한 14,000 — 재개방/멀티 인스턴스 없이 설명 불가 · 또는 마커 2건 이상 + 상한 50% 이상 소비) / `REFUTED`(상한 내 + 마커 0건, **조회 일자 한정**) / `INCONCLUSIVE`(소비 흔적 0건 등). 판정 근거는 `reasons[]` 정량 문장으로 동봉.
- **쿼터 상태 스냅샷**: `dart_quota_state`(DAR-532, PR #513) 당일 행 — `callsToday`(200콜 스텝 flush 하한)·`quotaExhausted`(실제 020/021 관측). 배포 전 일자는 행 없음(`found:false`).

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `date` | string | 선택 | 감사 대상 KST 일자(YYYYMMDD, 기본 오늘). 형식/실존 위반 시 400 `INVALID_DATE_PARAM`. **사건 발생 일자를 지정해야 판정이 유의미** |

**Response** (`data`: `DartQuotaForensicsReport`):
```jsonc
{
  "metric": "dart-quota-forensics",
  "date": "20260715",
  "nightWindow": { "startKst": "00:00", "endKst": "08:29" },
  "budget": { "dailyBudget": 19000, "liveReserve": 2000, "liveParseReserve": 3000,
              "liveParseCeiling": 17000, "bulkCeiling": 14000, "persistStep": 200 },
  "quotaState": { "found": true, "callsToday": 18800, "quotaExhausted": true,
                  "updatedAtKst": "2026-07-15 08:10:00", "note": "…" },
  "night": {
    "totalEstimatedCalls": 14973,
    "paths": [ { "path": "DOC_FETCH_BACKFILL", "label": "문서 파싱 fetch — 백필",
                 "estimatedCalls": 14000, "evidence": "disclosure_documents.fetchedAt …" } /* 7종 고정 */ ],
    "topPaths": [ /* 상위 3경로(0 제외) — DoD '상위 경로 3건 정량' */ ]
  },
  "hourly": [ { "hour": "03", "total": 14120, "byPath": { "DOC_FETCH_BACKFILL": 14000, /* … */ } } /* 24행 */ ],
  "cronTimeline": [ { "jobKey": "event.backfill-drain", "startedAtKst": "2026-07-15 03:00:00",
                      "finishedAtKst": "2026-07-15 03:09:00", "status": "SUCCESS",
                      "itemCount": 200, "dartRelevant": true } ],
  "collectionRuns": [ /* disclosure_collection_logs 당일 원자료 + estimatedListCalls(감사 추적) */ ],
  "restartMarkers": { "count": 1, "markers": [ { "source": "cron_run_logs", "key": "event.backfill-drain",
                      "startedAtKst": "2026-07-15 03:20:00", "note": "…" } ], "note": "…" },
  "hypothesis": {
    "hypothesis": "DAR-532 가설: 야간 다중 프로세스 재기동이 …",
    "verdict": "SUPPORTED",            // SUPPORTED | REFUTED | INCONCLUSIVE
    "nightEstimatedCalls": 14973, "bulkCeiling": 14000, "budgetOverrunFactor": 1.07,
    "restartMarkerCount": 1, "reasons": [ "…정량 근거 문장…" ], "note": "판정은 조회 일자 1일 한정 …"
  },
  "caveats": [ "모든 경로 추정치는 저장 흔적 기준 하한 …", "tables lazy fetch 는 S3 전용(DART 소비 0) …" ]
}
```

> ★DAR-532(PR #513) 배포 이후에는 재기동 시 `callsToday` 가 복원되어 예산 재개방 자체가 차단된다 — 본 엔드포인트는 **배포 전 사건 일자의 소급 감사**(가설 검증/반증)와 **배포 후 가드 검증**을 겸한다.

### 31.7 온보딩 퍼널 이벤트 기록 (갭분석 W15) — **비인증**

```
POST /ops/funnel        → 202 Accepted
```

온보딩 퍼널 5단계(`install → intro → kakao → watchlist → push_permission`) 계측 전용 엔드포인트. install/intro/kakao 단계는 로그인 이전이라 **비인증**이며, 수용 입력은 `anonId + step (+ meta 캡)` 화이트리스트뿐(개인정보·비밀값 미취급).

**Request Body** (`RecordFunnelEventDto`):
```json
{
  "anonId": "6f0c2b3e-8a41-4b7d-9d2f-1c5e7a9b3d10",
  "step": "intro",
  "meta": { "selectedCount": 3 }
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `anonId` | string(8~64) | 필수 | 디바이스 단위 익명 ID(로그인 전 추적, 모바일 생성·영속) |
| `step` | enum | 필수 | `install` \| `intro` \| `kakao` \| `watchlist` \| `push_permission` (모바일 `utils/funnel.ts` `FUNNEL_STEPS`와 SSOT 미러) |
| `meta` | object | 선택 | 스텝별 부가 정보(2048B 캡) |

**Response**: `202 Accepted` — `{ "success": true }` (**적재 실패도 202로 흡수** — 계측 전용, 모바일 fire-and-forget)

- 라우트 전용 스로틀 30req/min(IP) — 단일 기기 온보딩 버스트 통과·익명 스팸 차단. 탈퇴 시 `userId` 익명화는 §2.6 참조.

---

### 31.8 테스터 코호트 계측 (DAR-516, Wave A/A6) — **인증**

```
POST /ops/tester-event   (JWT)  → 202 Accepted
GET  /ops/tester-metrics (JWT)  → 200 OK
```

Play 테스터 12인 코호트의 **로그인 후 인앱 행동**을 기록·집계하는 계측 표면. §31.7 온보딩 퍼널(비인증 anonId)의 인증판 형제 — 이 이벤트들은 로그인 후 참여이므로 **인증(JWT)+userId**로 적재한다. `SSOT`: 모바일 `utils/testerEvents.ts`·백엔드 `dto/record-tester-event.dto.ts` 의 `TESTER_EVENTS`(값 변경 시 양쪽 동시 갱신). 전체 스키마·집계 SQL·PII 정책 정본: `docs/analytics/tester-cohort-instrumentation.md`.

> ★**PII 무수집(수용기준 1)**: 서버는 `userId`(인증)·`event`(화이트리스트)·`ts`(서버 스탬프)만 저장한다. 자유텍스트·종목/카드 식별자·기기정보 입력 경로 없음(`event` 는 `IsIn` 화이트리스트뿐). M10 무오염 — engine5(매매/리스크) 무접점.

**POST /ops/tester-event** — 이벤트 1건 기록. **Request Body** (`RecordTesterEventDto`):
```json
{ "event": "edition_open" }
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `event` | enum | 필수 | `edition_open` \| `card_tap` \| `push_open` \| `stats_section_view` \| `waitlist_cta` \| `survey_ios_shown` \| `survey_ios_answer_yes` \| `survey_ios_answer_no` |

- **Response**: `202 Accepted` — `{ "success": true }` (**적재 실패도 202로 흡수** — 계측 전용, 모바일 fire-and-forget). 라우트 전용 스로틀 120req/min(IP·인앱 연속 탭 버스트 통과).

**GET /ops/tester-metrics** — 오픈율·재방문 코호트 집계(수용기준 3, ops-facing). 쿼리 `?days=`(관측창, 1~90, 기본 14).
```json
{
  "success": true,
  "data": {
    "windowDays": 14, "since": "2026-07-03T...Z",
    "totalUsers": 10, "editionOpenUsers": 8, "pushOpenUsers": 5, "revisitUsers": 4,
    "openRate": 0.8, "revisitRate": 0.4,
    "byEvent": [ { "event": "edition_open", "count": 42 }, { "event": "card_tap", "count": 30 } ]
  }
}
```
- `openRate` = 관측창 내 `edition_open` 1회↑ 고유 사용자 / 전체 활동 사용자. `revisitRate` = 활동일(KST) ≥2 고유 사용자 / 전체 활동 사용자. KST 일 버킷은 `createdAt`(naive-UTC) → `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'` 이중 변환 파생(DAR-505 패턴).

---

## 부록 A. Rate Limiting

### 전역 제한
- **60 requests / 분** (IP 기준, `ThrottlerGuard` 전역 적용)

### 인증 엔드포인트 제한
- **5 requests / 분**: `POST /auth/signup`, `POST /auth/login`
- **10 requests / 분**: `POST /auth/kakao`

### Headers
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1678190400
```

---

## 부록 B. 푸시 알림 Payload

**Expo Push Notification 형식** (공시 알림 예):
```json
{
  "to": "ExponentPushToken[...]",
  "sound": "default",
  "title": "삼성전자 · 정기공시",
  "body": "주주총회소집공고",
  "channelId": "disclosure",
  "data": {
    "type": "DISCLOSURE",
    "disclosureRcpNo": "20260307000123",
    "channelId": "disclosure",
    "deepLink": "/disclosure/20260307000123"
  }
}
```

- 타입별 제목/본문 템플릿(출처명 텍스트·이모지 미사용)·`data` 필드(`deepLink`/`source`/`strategyKey` 등)는 §20·§20.1(DAR-432 개정), Android 채널 3종(`disclosure`/`signal`/`trade`)은 §8.1(DAR-430) 참조.
- Android 푸시는 FCM V1 경유(EAS 빌드 `google-services.json` 주입).

---

## 32. 운영·리스크 감지점 알림 배선 (Ops/Risk Alert Wiring, DAR-476 P02)

P01(DAR-473)이 신설한 능동 알림 채널(`NotificationType.RISK_ALERT`/`OPS_ALERT` — 카테고리 `system`,
`NotificationSettings.opsPushEnabled` 기본 ON opt-out)에 **기존 감지점을 배선**한다. 판정·차단·매매
로직은 무변경 — 각 지점에 producer 호출(관측·알림층)만 추가한다(M10 클록 안전·측정 트랙 매매 행동
무접점). 발행은 모두 graceful/fire-and-forget 이라 엔진 본연의 경로를 절대 깨지 않는다.

발송 조건은 **에지/디바운스**로 폭주를 막고, `dedupeKey`(자연키)로 consumer 멱등(`refId` unique)까지
이중 억제한다. 새 API 엔드포인트·스키마 변경은 없다(관측 이벤트가 §8 알림 히스토리·푸시로 표면화).

| # | 감지점 | 알림 | 트리거·디바운스 | source | severity |
|---|--------|------|-----------------|--------|----------|
| 1 | 킬스위치 발동(수동/자동 불문, `KillSwitchManager.activate`) | `RISK_ALERT` | 발동 즉시(활성화 시각 분버킷 dedupe) | `kill-switch` | CRITICAL |
| 2 | 크론 신선도 `anyStale` 정상→정체 전환 | `OPS_ALERT` | 30분 주기 평가·**상승 에지 1회**(정상 복귀 시 재무장)·정체잡 집합+일자 dedupe | `cron-freshness` | ≥3잡 ERROR, else WARNING |
| 3 | 데이터 수집 실패·결측 fail-safe | `OPS_ALERT` | #2와 동일 관측면(수집 실패→마지막 성공시각 노후화→신선도 정체로 표면화)에서 정체잡 목록으로 함께 통지 | `cron-freshness` | (#2와 동일) |
| 4 | 단타 catch-up 청산(오버나잇 잔존분 강제청산·15:20 정규청산 누락 표면화) | `RISK_ALERT` | catch-up sweep이 ≥1건 청산 시(거래일 dedupe)·가격결측 폴백 섞이면 CRITICAL | `scalp-catchup` | ERROR(결측 시 CRITICAL) |
| 5 | AI 비용 일일 모니터 수용기준/한도 위반 | `OPS_ALERT` | 일 1회 잡(자연 디바운스)·일자 dedupe·자동 조치 없음(휴먼 승인 경계) | `ai-cost-monitor` | WARNING |

- #2·#3은 신선도 SSOT(`DataFreshnessService`)를 주기 평가하는 `DataFreshnessMonitorScheduler`가
  단일 관측면으로 함께 커버한다(개별 수집기 warn 산발 배선 대신 — 폭주 방지·유지보수 단순화). 신선도
  판정은 장외시간 오탐을 보류(`WEEKDAY_INTRADAY` window)하므로 상시 실행해도 안전하다.
- producer: `enqueueRiskAlert(severity, source, message, meta?)` 신설(P01 `enqueueOpsAlert`와 동일
  `NOTIFY_JOB.OPS_ALERT` 잡·`payload.type`으로만 구분·`notifyJobId`가 `risk-`/`ops-` 접두로 자연키 분리).
- 킬스위치는 순수 Rule 도메인 보존을 위해 `KillSwitchActivationNotifier` 포트(옵셔널)로 통지 —
  NestJS/알림 계층 직접 의존 없이 배선 모듈이 producer로 어댑트 주입(미주입 시 no-op·룰 불변).

---

## 33. 시장 파생 데이터 — 기술지표·수급·공매도 조회 (Market Data, 갭분석 W13·W16)

전부 **OptionalJwt(게스트 열람 가능)** read-only — 비개인 공개 시장 데이터(quote/candles와 동일 패턴). ★SHADOW 불가침: 표면 계층 전용으로 Buy Score·트레이딩 경로 무접점(점수화하지 않는다). 수동 수집 트리거는 §28.1.

### 33.1 기술지표 구간 조회 (W13)

```
GET /api/market-data/indicators?stockCode=005930&from=&to=&before=&limit=
```

`TechnicalIndicator`(MA5/20/60/120·RSI14·MACD·볼린저·ATR14·VWAP·거래량비율20·52주 고저·공시 전 선행상승률, EOD 일봉 파생)를 §17 캔들과 동일한 파라미터·응답 규약(from~to + `before` 커서 + `limit` 상한 1000, newest-first 조회 후 오름차순 반환)으로 개방한다. Buy Score 입력 근거 검증·차트 MA/볼린저 오버레이용.

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `stockCode` | string | 필수 | 종목코드 6자리 |
| `from` / `to` | string | 선택 | 구간(포함) — ISO 8601 또는 YYYYMMDD (§17 candles와 동일 형식) |
| `before` | string | 선택 | 페이지네이션 커서(이 거래일 미만 과거 페이지) — 응답 `nextCursor` 사용 |
| `limit` | number | 선택 | 페이지 행 수 (기본 200, 최대 1000) |

**Response** (`data`: `IndicatorSeriesResult`): `stockCode`·`source`(`EOD`\|`UNAVAILABLE`)·`asOf`(서버 조회시각)·**`latestTradeDate`(지표 기준일 — 이 종목의 적재 최신 tradeDate, T+1 지연을 숨기지 않는 정직 고지·적재 0행이면 null)**·`count`·`nextCursor`·`points[]`(거래일 오름차순 `IndicatorPoint` — 각 지표 nullable, 모바일은 '—' 처리). 형식 위반은 400. 관련 표면: 일봉 차트 오버레이 토글·지표 기준일 배지·신호 상세 근거 지표 섹션(`evidenceIndicators` — 신호 생성 KST 거래일 as-of 근사 재조회, `tradeDate` 동반 노출).

### 33.2 종목 투자자별 매매동향 (W16)

```
GET /api/market-data/investor-flow?stockCode=005930&days=20
```

외국인/기관/개인 순매수(수량·금액, 원 단위) 최근 N거래일 시계열 + 5/20일 누적 요약. 모바일 종목 화면 '수급 요약' 카드(`SupplyDemandCard`) 소비.

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `stockCode` | string | 필수 | 종목코드 6자리 |
| `days` | number | 선택 | 조회 거래일 수 (기본 20, 최대 120). 요약(5/20일)은 항상 최근 20일로 산출 |

**Response** (`data`: `InvestorFlowResultDto`): `stockCode`·**`asOfDate`(데이터 기준일 YYYYMMDD — 없으면 null, 소비측 카드 억제)**·`rows[]`(tradeDate·투자자별 순매수 수량/금액·source)·`summary`(외국인·기관 5/20일 누적 순매수 금액 + `window5dDays`/`window20dDays` — 축적 미달 시 실제 반영 일수 정직 고지).

### 33.3 종목 공매도 일별 (W16)

```
GET /api/market-data/short-selling?stockCode=005930&days=20
```

공매도 거래량·거래대금·거래비중(% — 당일 총거래량 대비, 일봉 volume 조인 산출) 시계열. **잔고 필드(`shortBalanceQty`/`shortBalanceRatio`)는 무료 소스 미가용으로 null(합성 금지 — 정직)**.

**Response** (`data`: `ShortSellingResultDto`): `stockCode`·`asOfDate`(null graceful)·`rows[]` — 행별 **`publishedDate`(T+2 영업일)** 동반으로 as-of 소비 지원(lookahead 불가침). 파라미터는 §33.2와 동일.

- 수집 배치(평일 07:40·20:00·21:30 KST, KRX→KIS 소스 체인): `docs/workflow.md` §5.14.

---

## 34. 공개 웹 표면 — 랜딩·공유 페이지·시스템 상태·법적 고지 (비인증)

전부 **인증 불요** 공개 표면. §34.1~34.3은 글로벌 prefix `api` 제외 라우트(main.ts `setGlobalPrefix` exclude — 호스트 루트 직결), §34.4만 `/api` prefix 하에 있다. 외부 API 호출 0·DB read-only — DART 쿼터 무접촉.

### 34.1 공개 랜딩 페이지 (갭분석 W3b)

```
GET /                      → 200 text/html (Cache-Control: public, max-age=3600)
```

초미니 랜딩 — 서비스 소개 3줄 + 면책 고지 정적 HTML. 공개 표면 전용 스로틀 IP당 30req/min. (구 404 → 랜딩 200으로 변경 — 루트를 프로브하던 외부 모니터는 응답 변화 인지.)

### 34.2 공시 공유 페이지 (갭분석 W3b)

```
GET /share/:rcpNo          → 200 text/html | 404 text/html
```

| 파라미터 | 설명 |
|---|---|
| `rcpNo` | DART 접수번호(14자리) |

og 메타(카카오톡 등 미리보기) + 공시 제목·회사명·접수일 + **캐시된 AI 요약(있을 때만)** + 앱 딥링크를 담은 공유용 HTML 1장. 모바일 공유 버튼(`shareLink.ts`)이 이 URL을 생성한다.

- 캐시: 공시는 불변이므로 `public, max-age=86400`(1일). 단 AI 요약은 수집보다 늦게 생성되므로 요약 생성 전 캐시된 크롤러는 최대 1일 요약 없는 버전을 볼 수 있음(본문 자체는 불변이라 무해). 미존재 rcpNo는 404 + `no-store`(이후 수집될 수 있어 캐시 금지).

### 34.3 공개 시스템 상태 페이지 (갭분석 W11/W12)

```
GET /status                → 200 text/html (Accept가 JSON만 요구하면 JSON 분기)
GET /status.json           → 200 application/json (항상 JSON)
```

오늘 공시 수집 건수·파이프라인 상태·최근 24h 크론 성공률·서비스 가동 상태를 **운영 사실 그대로** 노출한다(성과·수익률·계정·비밀값 절대 미포함 — 졸업 전 공개해도 오도 위험 0 원칙). 60초 인메모리 캐시로 DB 부하 차단 + 전역 스로틀 유지.

**Response** (`data` 래핑 없음 — `PublicStatusSnapshot` 원형):
```jsonc
{
  "generatedAt": "2026-07-16T00:00:00.000Z",
  "service":    { "status": "OK", "label": "정상 가동", "uptimeSeconds": 86400 },  // stale 잡 있으면 DEGRADED
  "disclosure": { "todayCollectedCount": 151, "lastCollectedAt": "…" },            // 오늘(KST) 라이브 공시(백필 제외)
  "pipeline":   { "status": "OK", "label": "…", "staleJobKeys": [] },
  "cron":       { "windowHours": 24, "totalRuns": 320, "okRuns": 318, "successRatePct": 99.4 } // 실행 0건이면 null
}
```

### 34.4 법적 고지 공개 페이지 (갭분석 W3, Play 컴플라이언스)

```
GET /api/legal/privacy            → 200 text/html   개인정보 처리방침 (인앱 privacy.tsx 본문 재게시)
GET /api/legal/account-deletion   → 200 text/html   계정 삭제 방법 안내 (Play 하드 요구사항, 실제 삭제는 §2.6)
```

Play Console 스토어 리스팅에 게시할 공개 웹 URL. API가 아닌 정적 HTML 문서 표면이라 Swagger에서 제외(`@ApiExcludeController`). prod Caddy가 `/api` 경로를 프록시하므로 프리픽스 하 배치가 안전(프리픽스 없는 `/legal/*` 전환은 main.ts exclude 추가로 가능).

---

**최종 수정일**: 2026-07-17 (DAR-551 [BE·P0·오너결정 A안] §12.5 빈 에디션 폴백 '주요 공시 브리핑' 신설 — `GET /signals/daily/:date` 빈 에디션(isEmpty·emptyReason∈{PENDING,QUIET,COLD_START}) 응답 `meta.fallbackBriefing[]` 추가: 그 KST 거래일(`rcpDt` 범위·`isBackfill=false`) 주요 공시 top 5({rcpNo, corpName, eventLabel, summaryLine, summarySource}). 중요도 정렬=①이벤트성(DisclosureEvent≠OTHER)→②시총(KOSPI 본판 대용 프록시)→③AI요약 존재→④rcpNo desc, 단일 `$queryRaw`. **신규 AI 호출 0**(기존 DisclosureAnalysis summary 캐시 `resultJson->>'summary'` 재사용·없으면 제목 폴백 `summarySource=TITLE`), 마이그레이션 0. ★정직 불변식: `data`(판단)·daily-editions 목록·count 무변경(빈 날 여전히 판단 0 — 브리핑은 '판단' 아님, meta 로 물리 분리). CLOSED·FUTURE 는 브리핑 미대상(undefined·조회 생략). 버전 1.49) / 이전: 2026-07-17 (DAR-553 [BE·P0·오너보고 버그] §12.4·§12.5 에디션 같은 종목 중복 카드 수정 — TradingSignal 자연키 `(corpCode,rcpNo,eventType,persona)`로 공시 1건이 최대 4장(페르소나별) 개별 신호를 만들어 같은 종목이 에디션에 중복 노출·`count`/스트립 dot 부풀림 발생하던 결함 봉인. `findDailyEditions`/`findDailyEdition` 모두 corpCode당 대표 1건(최고 buyScore, 동점 `createdAt desc → id desc`)으로 dedup, item에 `personaCount`/`otherPersonas` 메타 추가('외 N개 관점' 표기 가능). §31.6.1 edition-density에 dedup 지표 `buyGradeUniqueCorp`/`uniqueCorpBuyCount` 병기(기존 `buyGrade`/`verdict` 판정 로직 무변경 — 해석 정정용). 스키마 변경 0, 버전 1.49) / 이전: 2026-07-17 (DAR-538 [cross·고도화] §26.4 예정 이벤트 캘린더 신설 — `GET /upcoming-events?days=` (JWT): 관심기업 `DisclosureEvent.extractedData` 날짜 필드 파생 D-day 목록(7종: 배당 기준일/지급일·유상증자 청약일·신주 상장예정일·CB/BW 만기일·자사주 취득 종료일·거래재개 예정일). 정직 규약(유효 YYYY-MM-DD만·발명 금지·보호예수는 소스 부재로 v1 미지원)·정정공시 supersede·(기업,종류,날짜) dedup·읽기 전용 스키마 0·M10 무접촉. 파서 확장: 유상증자 청약(예정)일·상장예정일 라벨 추출(key-value.mapper→capital-increase). 버전 1.48) / 이전: 2026-07-17 (DAR-527 후속 문구 확정: §12.5 — 발화 측 `deepLink` 재타겟(`/signals` → `/signals?date=<editionDate>`)이 **DAR-533(PR #510)로 완료**됐음을 반영('선행 위임'→'완료·end-to-end 동작'). FE(PR #508)+BE(PR #510) 병합으로 발행 푸시 '해당 호 직행' 실동작. 문서 드리프트 0, 버전 1.47) / 이전: 2026-07-17 (DAR-527 Wave B/B3·P1: §12.5 보강 — 에디션 발행 푸시 딥링크(신호탭 '해당 호' 직행 `/signals?date=<editionDate>`·`/signals` prefix 쿼리 규칙으로 화이트리스트 통과·새 prefix/라우트 불요·`type=EDITION·refId` 타입별 폴백[3경로·DAR-90/154 재사용]·백엔드 `deepLink` 재타겟 선행[BE 소유·자식 이슈 위임·DAR-524→526 동형]) + '놓친 호' 뱃지(전적으로 클라이언트 로컬 zustand persist·expo-secure-store·**서버 스키마 0**·`editionPushEnabled` ON 시에만 노출[단일 토글 정합]). 모바일 전용·M10 무오염·마이그레이션 0, 버전 1.45) / 이전: 2026-07-17 (DAR-528 Wave C/C3·P1: §10.8 리즈닝 `resultJson.financialContext`(ANALYZED만) 신설 — '왜 움직였나' 카드 재무 맥락 한 줄. 인과 공시 규모(분자)를 `CompanyFinancial` 최신 연간 매출(분모, reprtCode=11011) 대비 비율로 규칙 기반 산출(생성 경로에서 `resultJson`에 적재, 조회 그대로 노출). 분자·분모 중 하나라도 결측/불확실(분기·반기 누적 매출 등)이면 `null`(표시 생략·수치 발명 금지). **AI 호출 0**(비용게이트/AIUsageLog 무영향)·스키마 변경 0(마이그레이션 불요)·구 APK 무해(옵셔널)·M10 무오염. 버전 1.46) / 이전: 2026-07-17 (DAR-526 Wave C/C2·P0: §10.8.1 조회 엔드포인트 `GET /api/price-move-reasonings/:refId` 신설(FE '왜 움직였나' 카드 배선) — refId(등락 이벤트) 1건 응답 `{ success, data }`, `corpName` Company 조인(미존재 null), `resultJson` status 판별 유니온, 내부 `level` 제외, 미존재 refId→404 `PRICE_MOVE_REASONING_NOT_FOUND`; 읽기 전용·마이그레이션 0·AI 무접점(비용게이트/AIUsageLog 무영향). §10.8.2 PRICE_MOVE 푸시 `deepLink` 재타겟 `/company/<corpCode>`→`/price-move/<refId>`(카드 진입). 버전 1.45) / 이전: 2026-07-17 (DAR-522 Wave C1·P0: §10.8 PRICE_MOVE 역방향 리즈닝 신설 — engine3 급변동(±5%) 발화→48h 공시 원인 역추적 AI Task(5번째). HTTP 엔드포인트 없음(engine3→engine2 큐 `price-move-reason` 트리거), 무공시 시 AI 호출 0·`'관련 공시 없음(48h)'` 포맷, 비용게이트 L0~L3 편입·일일 상한 env `PRICE_MOVE_REASONING_DAILY_USD_LIMIT`($0.5)·AIUsageLog `price-move-reasoning` 편입·refId 멱등(§43 database-schema)·AI 금지영역 무침범(출력=설명층). 마이그레이션 20260717130000_dar522_price_move_reasoning, 버전 1.44) / 이전: 2026-07-17 (DAR-516 Wave A/A6: §31.8 테스터 코호트 계측 2종 신설 — `POST /ops/tester-event`(인증·화이트리스트 8종·202 흡수·120req/min)·`GET /ops/tester-metrics`(오픈율·재방문 집계, days 1~90). PII 무수집(userId·event·ts만)·M10 무오염, 마이그레이션 20260717120000_dar516_tester_event(tester_events 단일 테이블). SSOT: 모바일 `utils/testerEvents.ts`↔`dto/record-tester-event.dto.ts`, 정본 `docs/analytics/tester-cohort-instrumentation.md`, 버전 1.43) / 이전: 2026-07-17 (§7.9 유사공시 반응 통계 `GET /disclosures/:rcpNo/event-stats` 신설 — 유형별 D+1/D+5/D+20 누적 평균수익률(실제 주가 반응)·초과수익·상승비율·표본수 n, `EventStudyObservation` 관측치 직접 집계, n<30→`stats=null`+`INSUFFICIENT_SAMPLE` 정직 규약, KST 일1회 캐시, 읽기 전용·마이그레이션 0; Wave A·A1, DAR-511, 버전 1.42) / 이전: 2026-07-17 (DAR-510 [문서] 일일 에디션 API 동기화 — §12.4·§12.5 를 구현(DAR-505)과 드리프트 0 재검증 + 에러 응답(400 BadRequest)·응답 봉투 `{ success, data, meta }`·라우트 선언 순서(`:id` catch-all 위)·PENDING↔QUIET 19:15 경계를 명시, 버전 1.41) / 이전: 2026-07-16 (갭분석 퀵윈 웨이브 신규 엔드포인트 전수 반영 — §2.3~2.6 Pro 사전신청 3종·계정 삭제(W1/W3), §7.8 미국 주식 수요 기록 + GET /search OptionalJwt(W8), §10.7 AI 커버리지 계기판(W10), §22.1 오늘의 브리핑(W14), §27.2 제목 이벤트 백필 2종(W4), §28.1 수급·공매도 수동 수집(W16), §31.6 알림 지연 계측(W5)·§31.7 온보딩 퍼널 비인증 기록(W15), §33 기술지표·수급·공매도 조회(W13/W16), §34 공개 웹 표면 — 랜딩·공유·/status·법적 고지(W3/W3b/W11), 버전 1.40) / 이전: 2026-07-07 (§12.3 신호 목록 `sinceDays` 최신성 윈도우 파라미터 문서화 — 홈 '오늘의 투자판단' 정체 해소, 버전 1.39) / 이전: 2026-07-06 (개장 체결 정렬 — §21.2·§21.3 철학·전략 forward 진입을 "저녁 예약(PENDING)→익일 개장 당일 시가 체결"로 통일: 사이클 응답 `reserved` 추가·`bought` 의미 재정의·철학 entryReady 폴백·체결 알림 출처 SSOT 16종(철학 4종 추가·`strategy:` 접두사 정규화); 같은 날 §31.5 신설 — 격주 트랙 성과 순위 리포트 `GET /api/ops/track-review` + 발송 잡 `ops.biweekly-track-review`; 같은 날 알림 이모지 제거 개정 — §8.1·§20·§20.1·부록 B 템플릿 갱신) / 이전: 2026-07-03
