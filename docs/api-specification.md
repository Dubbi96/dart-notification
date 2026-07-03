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

## 8. 알림 히스토리 (Notifications)

### 8.1 알림 목록 조회

**Endpoint**: `GET /notifications`

**Headers**: `Authorization: Bearer {accessToken}`

**Query Parameters**:
- `page` (optional): 페이지 번호 (기본: 1)
- `limit` (optional): 페이지당 개수 (기본: 20, 최대: 50)
- `isRead` (optional): 읽음 필터 (true | false)
- `type` (optional, DAR-161): 알림 타입 필터 (`DISCLOSURE` | `SIGNAL` | `EXIT` | `THESIS_VIOLATED` | `TRADE_ENTRY` | `TRADE_EXIT`). 미지정 시 전체 타입. (`TRADE_ENTRY`/`TRADE_EXIT`: DAR-424 라이브 페이퍼 체결 알림)
- `category` (optional, DAR-430): 알림 카테고리(3 버킷) 필터 — `disclosure`(공시=DISCLOSURE) | `signal`(신호=SIGNAL·EXIT·THESIS_VIOLATED) | `trade`(체결=TRADE_ENTRY·TRADE_EXIT). 미지정 시 전체. **`category` 지정 시 `type` 보다 우선**(버킷의 타입들을 `IN` 으로 묶어 조회).

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

> **Android 알림 채널화 (DAR-430)**: 푸시 발송 시 NotificationType → 카테고리 → 채널 ID(`disclosure`/`signal`/`trade`)를 산출해 Expo Push 메시지의 `channelId` 와 `data.channelId` 에 실어 보낸다. 모바일은 앱 시작 시 `setNotificationChannelAsync` 로 동일 ID 의 채널 3개를 등록(공시=DEFAULT 중요도, 신호·체결=HIGH·소리) → OS 가 채널별로 묶어 표시·누적·중요도를 분리한다. iOS 는 채널 개념이 없어 `channelId` 가 무시되며, 카테고리 구분은 인앱 아이콘·필터가 담당한다(크로스플랫폼 폴백). 체결 알림 제목의 `[전략]` 대괄호 프리픽스는 제거됐고, 출처는 **고유 이모지+출처명**(예: `⚡ 단타 · 삼성전자 매수`)으로 제목 앞에 표기된다(DAR-432 §20.1)·`data.source`/`data.strategyKey` 동봉.

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
      "position-thesis": { "costUsd": 0.001, "callCount": 1 }
    }
  }
}
```

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
`grade=STRONG_BUY,BUY&sort=score`로 소비한다(DAR-193).

| 쿼리 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `grade` | string | 선택 | 신호 등급 (`STRONG_BUY`\|`BUY`\|`WATCH`\|`NEUTRAL`\|`AVOID`\|`BLOCKED`). 콤마로 다중 지정 가능: `"STRONG_BUY,BUY"` |
| `personaType` | string | 선택 | 페르소나 유형 (`GROWTH`\|`VALUE`\|`MOMENTUM`\|`EVENT_DRIVEN`) |
| `eventType` | string | 선택 | 공시 이벤트 유형 (`SUPPLY_CONTRACT` 등) |
| `entryReady` | boolean | 선택 | 진입 준비 여부 (`true`/`false`) |
| `sort` | string | 선택 | 정렬 (`score`: 점수 내림차순 \| `latest`: 최신순, 기본 `latest`). `score`는 동점 시 최신순으로 안정화 |
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

> 동일 컨트롤러에는 청산 신호 목록 `GET /api/signals/exit`(JWT 필수)와 신호 상세 `GET /api/signals/:id`(JWT 필수)도 있다.

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

**인박스/푸시 내용** (DAR-432 — 출처별 이모지+출처명, 한 줄 이해, 대괄호 0):
- 매수 — title `{이모지} {출처명} · {종목명} 매수`, body `₩{체결가} × {수량}주 · 잔액 ₩{현금}`
- 매도 — title `{이모지} {출처명} · {종목명} 매도 {±수익%}`, body `손익 {±%}({청산사유}) · 평가금 ₩{전체평가금}`
- 출처(이모지+출처명)는 `strategyKey`로 SSOT(`notification-source.ts`)에서 매핑: 🤖 모의(`paper-simulation`)·⚡ 단타(`intraday-scalp`)·🎯 이벤트엣지(`event-edge`)·🛡️ 보수가치(`conservative-value`)·🚀 단기모멘텀(`short-momentum`)·💥 공격분산(`aggressive-diversified`); 미등록 키는 🔔 알림 폴백.
- 예: `⚡ 단타 · 삼성전자 매수` / `₩105,000 × 10주 · 잔액 ₩9,500,000`, `🤖 모의 · 삼성전자 매도 +2.10%` / `손익 +2.10%(TAKE_PROFIT) · 평가금 ₩10,200,000`.
- 푸시 `data`: `{ deepLink, type, refId, channelId, source, strategyKey, strategyName }` — 출처(source=SSOT 라벨)·트랙 식별자(strategyKey/strategyName)·채널을 동봉(DAR-430 채널·DAR-431 딥링크 정합). 빈 값 키는 제외(legacy 호환). `deepLink`는 인박스(`NotificationHistory.deepLink`)에도 동일 충전돼 알림 탭 탭(tap) 라우팅에 쓰인다.

**딥링크 라우팅(DAR-431)**: 체결 알림 탭은 해당 트랙 화면으로 직행한다(포트폴리오 루트 폴백 제거).
- 분봉 단타 → `/portfolio/strategy/intraday-scalp`
- 시스템 모의 → `/portfolio?tab=sim` (포트폴리오 '시스템 모의' 서브탭)
- (4종 전략 `event-edge`·`short-momentum`·`conservative-value`·`aggressive-diversified` 드릴다운은 `/portfolio/strategy/<key>` — 단, 백테스트 전용이라 라이브 체결 알림은 발행하지 않는다.)

모든 deepLink는 모바일 화이트리스트(`@utils/deeplink` `isAllowedDeepLink` — `/portfolio` prefix + 경로 경계/쿼리 규칙)를 통과하며, 임의 라우팅·외부 스킴·트래버설은 거부된다. 트랙 SSOT·역식별은 `@utils/tradeTracks`(`trackByKey`/`trackByDeepLink`). 시스템 모의 딥링크의 `?tab=sim` 은 포트폴리오 화면이 초기 서브탭으로 해석한다(`resolveInitialSubTab` — 허용 목록 밖 값은 `live` 폴백).

현금 = 초기자본 + 실현손익 − 보유 진입원가, 전체평가금 = 현금 + 보유 평가합(현재가 기준)을 체결 시점에 발행 측이 산출해 페이로드에 담는다(point-in-time 보존).

★알림은 통지일 뿐 — 주문 결정/실주문과 무관(AI 금지영역 불침범, 발행은 graceful — 실패해도 체결을 깨지 않음).

모바일: 인앱 알림 탭에 `TRADE_ENTRY`(매수·녹색·`arrow-down-circle`)·`TRADE_EXIT`(매도·주황·`arrow-up-circle`) 렌더(제목 `[{전략}]` prefix 로 트랙 식별), 설정 화면에 '체결 알림' 토글(기본 ON). 트랙별 보유·체결 분리 조회는 포트폴리오 '시스템 모의'(`?tab=sim`)·'전략' 탭(단타 `IntradayScalpSection` + 4전략 비교)·각 드릴다운으로 제공한다. (인앱 알림 탭의 체결 카테고리 내 전략 서브필터는 DAR-430 카테고리 세그먼트 위에 합성 예정.)

### 20.1 출처별 메시지 전략 재설계 (DAR-432)

푸시·인앱 알림을 "어디서 발행했는지 한눈에"(고유 이모지+출처명) 보이고 한 줄로 이해하며 탭하면 상세(DAR-431 딥링크)로 가도록 재설계. `[ ]` 대괄호 대신 이모지+`·`(점) 구분(DAR-430 정합).

**출처→이모지·출처명 SSOT**: 백엔드 `backend/src/notifications/notification-source.ts` ↔ 모바일 `mobile/utils/notificationSource.ts`(이모지·라벨 1:1 동일, `mobile/scripts/check-notification-sources.ts` 결정론 검증). DAR-430 카테고리(3 버킷=채널·필터 축)와 **상호보완**(출처=세분화된 발행원 축).

**출처별 템플릿**:
- 📢 공시(`DISCLOSURE`): title `📢 {기업명} · {공시유형}` / body `{공시명}` (탭→`/disclosure/{rcpNo}`)
- 📈 매수신호(`SIGNAL`): title `📈 {기업명} 매수신호 {등급(한국어)}` / body `{점수}점 · {근거}`
- 🔻 청산(`EXIT`): title `🔻 {기업명} 청산 권고` · ⚠️ 논리훼손(`THESIS_VIOLATED`): title `⚠️ {기업명} 투자논리 훼손`
- 체결(`TRADE_ENTRY`/`TRADE_EXIT`): 위 §20 트랙별 이모지 템플릿(🤖 모의·⚡ 단타·🎯/🛡️/🚀/💥 4전략)

**렌더**: 인앱 알림탭은 비공시 타입은 백엔드 `title`(이모지 내장)을 그대로, 공시 행은 조인 데이터(`{기업명} · {공시유형}`)에 출처 이모지(📢)를 SSOT에서 덧붙여 렌더(DAR-430 카테고리 칩과 정합). 길이 가이드: 제목 ≤ 약 40자(잠금화면 잘림 고려), 본문 한 줄. 스키마·마이그레이션 무변경(문자열 템플릿만).

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

### 21.3 전략 변형 4종 forward 모의운용 (Strategy Forward Simulation, live-readiness W1)

engine3 리플레이 트랙(§18, 과거 1년 재생)과 **별개의 forward 실운용 트랙** — 라이브 TradingSignal(isBackfill=false)에 `strategy-presets` 의 preset.params(minBuyScore·eventTypes allowlist·maxPositions·사이징)를 적용해 전략별 전용 포트폴리오(`모의운용 포트폴리오 [strategy:<key>]`, PaperTrade `styleTag='strategy:<key>'`)를 매일 운용한다. event-edge 는 EventEdgeSelector robust allowlist 를 당일 1회 해석(비면 진입 0, do-no-harm). 청산은 preset.exitRules(익절/손절/최대보유)를 Position exit 파라미터에 대입. 크론: 평일 19:45 KST(cron-health `paper.strategy-forward`). ★실주문 0·AI 0(순수 Rule).

| 엔드포인트 | 인증 | 요약 |
|---|---|---|
| `GET /paper-trading/simulation/strategies-forward/comparison` | OptionalJwt | 전략별 forward 자산곡선·성적표(승률·누적수익·표본)·랭킹 비교 — 리플레이 비교(§18)와 별개 |
| `POST /paper-trading/simulation/strategies-forward/run-once` | JWT | 전략 4종 forward 1일치 사이클 수동 실행 |

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
  "title": "📢 삼성전자 · 정기공시",
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

- 타입별 제목/본문 템플릿(출처 이모지+출처명)·`data` 필드(`deepLink`/`source`/`strategyKey` 등)는 §20·§20.1(DAR-432), Android 채널 3종(`disclosure`/`signal`/`trade`)은 §8.1(DAR-430) 참조.
- Android 푸시는 FCM V1 경유(EAS 빌드 `google-services.json` 주입).

---

**최종 수정일**: 2026-07-03
**버전**: 1.34 (2026-07-03 — 견고화 W0·P05: 일일 운영 리포트 잡 §31.4(DAR-477) — `OpsDailyReportScheduler`(cron `ops.daily-report`, 매일 20:30 KST·forward 트랙 19:40/19:45 이후) 신설: `OpsMetricsService.getMetrics` 집계를 재사용해 트랙별 손익(누적 실현=CLOSED `Position.unrealizedPnl` 합·현재 평가=OPEN 합, 포트폴리오 단위 + 분봉 단타 `IntradayScalpTrade.netPnl`)·최근 24h 체결(styleTag별)·크론 실패·오류율(`CronRunLog` FAILED/전체·총 0이면 null·freshness stale 연계)·슬리피지 요약(§31.2 재사용)을 하나의 한국어 다이제스트로 만들어 **OPS_ALERT 채널(DAR-473 `enqueueOpsAlert`)** 로 하루 1건 발송(멱등 자연키 `daily-report:<KST거래일>`)·심각도 크론 실패/정체 시 WARNING·아니면 INFO; 실행 헬스는 `CronRunLog`(`ops.daily-report`) 기록으로 cron-health `FRESHNESS_JOB_SPECS`에 등록(48h stale 임계·source CRON_RUN_LOG)·조용한 발송 정체 안전망; 겹침 가드+throw 금지(cron 유지)·발송/집계 graceful; ★read-only 관측·알림 전용 — 실주문/Kill Switch 무직결·측정 트랙 매매 행동 무변경(M10 클록 보호)·AI 금지영역 불침범; BE tsc0·build0·jest 3345/3345(신규: ops 일일 리포트 서비스 4·스케줄러 5) 회귀0; 이전 이력: 1.33 (2026-07-03 — 견고화 W0·P06(DAR-475): 전략 룰북 정본 SSOT `docs/trading/strategy-rulebook.md` 신설(전 트랙 진입/청산/사이징/한도 전값 통합·code=truth 무보정 전사·정본=문서/코드=구현 관계 명시·Wave1 신규트랙 선기재 섹션) + §18 stale 정정 — event-edge `rules.entry`를 舊 "이벤트 6종 한정·매수점수 ≥50"에서 코드 실출력 "전 이벤트 대상·매수점수 ≥35"로 교정(DAR-408 robust 동적 게이트·DAR-413 임계 재보정 반영, 舊 값은 DAR-408·413 이전 미러)·§18 서두에 룰북 SSOT 크로스링크·minBuyScore 사다리(보수가치50>단기모멘텀40>이벤트엣지35>공격분산30) 명기; 이전 이력: 1.32 (2026-07-03 — 견고화 W0·P03: 슬리피지 측정 표면 §31.2(DAR-474) — `PaperTrade.expectedPrice`(신호시점 기대가) additive nullable 보존(체결기 `fillPendingEntries`가 `entryPrice`를 체결일 시가로 덮어써 신호시점 기대가가 소실되던 원천 결함 교정 — 예약 시 `expectedPrice=신호 기준가` 기록, 체결 update는 미포함해 보존) + `GET /ops/metrics` 응답에 `data.slippage` 분포 집계 추가(read-only) — 트랙(styleTag)별·전체 합산으로 슬리피지 원가(KRW) 평균/p95 + 신호시점 기대가 대비 실현 슬리피지(bps, 실전 전환 게이트 "슬리피지 기대 이내" 소비지표·expectedPrice 보존분만·레거시=null) + 수수료+세금(totalFees)을 **슬리피지와 구분 유지**(단타 totalFees SSOT 정합)·PaperTrade(시스템/전략/철학)+IntradayScalpTrade(분봉 단타) 양 원장 집계·집계 실패 graceful null; 체결 로직(예약→익일시가 의미론)·매매 행동 무변경(관측·데이터층만)·AI 금지영역 불침범·GAP-15(체결모델 보정)와 별개; BE tsc0·build0·jest 3327/3327(신규: ops 슬리피지 6·synthetic-cycle expectedPrice 보존 assertion) 회귀0; 이전 이력: 1.31 (2026-07-03 — live-readiness W1: 전략 변형 4종 forward 모의운용 §21.3 신설(`GET/POST /paper-trading/simulation/strategies-forward/comparison·run-once` — 라이브 신호에 preset.params 적용·`styleTag='strategy:<key>'` 네임스페이스·event-edge robust allowlist 당일 1회 해석·비면 진입 0 do-no-harm·청산=preset.exitRules 대입·실주문 0·AI 0) + 철학 스타일 4트랙 크론 배선 §21.2(평일 19:40 KST — run-once 수동 경로만 있어 미가동이던 결함 교정) + cron-health 잡 키 `paper.style-simulation`/`paper.strategy-forward` 추가; 이전 이력: 1.30 2026-07-02 전면 현행화 — Base URL을 실제 prod `https://168.138.198.152.nip.io/api`(OCI 2-micro·Caddy+Let's Encrypt)로 교체; 카카오 OAuth 3종 §1.5~1.7(`POST /auth/kakao`·`GET /auth/kakao/callback` 302 딥링크 복귀·`GET /auth/kakao/result` 일회성 회수) 추가 + 이메일 signup/login dev/test 전용 표기; 미수록 컨트롤러 전수 보강 §21~§31(시스템 모의운용+철학 스타일 §21, 포트폴리오·포지션·Thesis·Exit §22, 저장한 공시 §23, 투자 철학·융합 §24, 재무지표·내부자 지분 §25, 공시 원문 파싱·정량 팩트·이벤트 §26, 수집 파이프라인·스케줄러 §27, 시세 수집·지표·종목상태 운영 §28, 백테스트·신호 정확도·신호 생성 §29, 졸업 게이트·감사 로그 §30, 운영·관측 헬스/ops/collection/storage §31) + §4.3 인기 기업·§7.6 공시 유형·§7.7 공시 AI 분석·§10.6 AI 비용게이트 헬스 추가; §10/§11 중복 번호 충돌 해소 — 구 'Rate Limiting'·'푸시 알림 Payload'를 부록 A/B로 재배치·현행화(카카오 10req/min·채널/딥링크 payload); 게스트 열람 가드 표기를 코드 기준으로 정정(companies·disclosures 등); 이전 이력: 1.29 평가자료·인과코퍼스 §16.4 — DAR-379: 공시별 [AI/Rule 사전평가(극성·신뢰도·AI분석 유무) + 실현 EventStudy 사후결과(D+5/D+20 누적초과수익) + 일치/괴리 라벨]을 결합한 라벨 코퍼스를 이벤트유형별로 집계하는 `GET /api/backtest/evaluation-corpus`(게스트 열람) 추가 — `DisclosureEvent ⨝ DisclosureAnalysis ⨝ EventStudyObservation` 을 `rcpNo` 로 결합한 read-time 파생 뷰(마이그레이션 불요)·사전 극성(POSITIVE+1/NEGATIVE-1/MIXED·UNKNOWN 0)이 사후 실현 AR 부호를 맞히면 AGREE/불일치 DIVERGE/실현결과 없음·방향예측 없음·정확히 0 은 NEUTRAL(과신 방지)·`hitRate=AGREE/(AGREE+DIVERGE)`·AI 커버리지와 실현 커버리지 분리 집계로 calibration 통계근거 산출·일봉 윈도가 깊어질수록 실현 커버리지 상승(★데이터축적A 의존)·read-only 집계(신규수집·외부호출·AI 개입 0)·★AI 금지영역 불가침(코퍼스는 참고 평가자료일 뿐 주문 직접결정 금지, Buy/Exit Score=Rule 공식·Risk·체결=Engine5 독립, `disclaimer=CORPUS_REFERENCE_ONLY` 명시; 분봉 단타 청산 시각 timebase 통일 §19.2 — DAR-435: 단타 거래 카드에서 진입>청산 시각역전·`holdMinutes=0`(CLOSED 전건)·장외 19:14 류 표시 버그 해소 — 근본원인은 `entryTs`(분봉 KST 벽시계를 UTC 컴포넌트에 담은 naive instant)와 `exitTs`(`new Date()` 진짜 UTC instant)의 **timebase 불일치**(9시간 어긋남)였음. **① 청산 ts 통일** — `closePosition`/`forceCloseAll` 가 `exitTs: now` 대신 진입 거래일(`trade.tradeDate`) 기준 청산 KST 벽시계 분봉 ts(`minuteTimestamp(tradeDate, hhmm(now)) ?? now` graceful 폴백)로 영속해 entryTs 와 동일 naive-KST timebase 로 정렬(날짜 경계 교차 차단); **② holdMinutes 재계산** — `exitTsKst − entryTs` instant 차(동일 timebase → 정확한 분 차, 0 clamp 소멸); **③ 직렬화 계약 고정** — `getTradeHistory` 가 `entryTs`/`exitTs` 를 `toISOString()`(UTC `Z`) 대신 **`+09:00` 오프셋 명시 ISO**(`kstWallClockIso`, `minute-timestamp.ts` 신규)로 직렬화 → 모바일 `new Date(iso)`+Asia/Seoul 변환의 **이중 오프셋(+9 중복→19:14)** 해소(모바일 무변경); 진입 경로는 항상 분봉 충족봉 `scan.candle.ts` 사용을 회귀로 봉인(`new Date()` 진입 영속 금지); 스키마·마이그 무변경(신규 거래부터 정상화·과거 19행은 별도 백필 후속)·AI 금지영역 불침범·Engine5 독립성 유지; BE tsc0·build0·engine5+market-data jest 736/736(신규: 청산 timebase·진입 회귀·`kstWallClockIso` 단위 spec) 회귀0; 1.27 알림 메시지 전략 재설계 §20.1 — DAR-432: 푸시·인앱 알림을 **출처별 고유 이모지+출처명**으로 한눈 구분·한 줄 이해·탭→상세(DAR-431 딥링크)로 재설계 — be↔fe **출처 SSOT 공유**(`notification-source.ts`↔`notificationSource.ts`, parity 체크 `check-notification-sources.ts`): 📢 공시·📈 매수신호·🔻 청산·⚠️ 논리훼손·🤖 모의·⚡ 단타·🎯 이벤트엣지·🛡️ 보수가치·🚀 단기모멘텀·💥 공격분산(미상 🔔 폴백·이모지 고유); 체결 title `{이모지} {출처명} · {종목명} 매수/매도 {±%}`·body 핵심 수치 한 줄(`₩{가}×{수량}·잔액`/`손익 {±%}({사유})·평가금`), 신호 `📈 {기업명} 매수신호 {등급(한국어)}`·`{점수}점·{근거}`, 공시 `📢 {기업명}·{공시유형}`(DAR-430 채널·DAR-431 딥링크 data 동봉); **`[ ]`대괄호 전면 제거**(이모지+`·` 구분, DAR-430 정합); 모바일 알림탭은 비공시는 백엔드 title 그대로·공시 행은 조인 데이터에 📢 SSOT 프리픽스; 스키마·마이그 무변경(문자열 템플릿만)·AI 무관; 1.26 알림 카테고리화 §8.1 — DAR-430: 푸시·인앱 알림을 3 버킷(공시/신호/체결)으로 카테고리화 — **Android 알림 채널 3개**(`disclosure`/`signal`/`trade`) 앱 시작 시 `setNotificationChannelAsync` 등록(공시=DEFAULT·신호/체결=HIGH·소리)·백엔드 `NotifyConsumer.sendPush` 가 NotificationType→카테고리→`channelId` 산출해 Expo Push `channelId`+`data.channelId` 지정 → OS 가 채널별 그룹화·누적·중요도 분리·iOS 는 무시(인앱 아이콘/필터 폴백); **체결 알림 제목 `[전략]` 프리픽스 제거**('[분봉 단타] 삼성전자 매수'→'삼성전자 매수')·출처는 본문 앞(`분봉 단타 · 체결…`)+`data.source`/`data.strategyKey` 로 전달; `GET /notifications?category=disclosure|signal|trade` 필터 파라미터 추가(category>type 우선·버킷 IN 조회)·응답 `meta.unreadByCategory`(3 버킷 미읽음 합산) 추가; 모바일 알림탭 상단 카테고리 칩(전체·공시·신호·체결) 필터·행 단위 타입 아이콘/색/라벨은 DAR-161 유지; 스키마 무변경(NotificationType enum 재사용·마이그 불요); 1.25 체결 알림 딥링크 라우팅 + 전략별 트랙 식별 §20 — DAR-431: 체결 알림 탭이 '포트폴리오 루트'로만 가던 버그 해소 — 시스템 모의 deepLink 를 `/portfolio`→**`/portfolio?tab=sim`**(포트폴리오 '시스템 모의' 서브탭 직행)으로 고정·분봉 단타는 기존 `/portfolio/strategy/intraday-scalp` 유지(둘 다 `@utils/deeplink` `/portfolio` prefix 화이트리스트 통과·루트 폴백 X); 푸시 `data` 에 `strategyKey`·`strategyName` 동봉(`NotifyConsumer.sendPush` extraData·빈 값 제외·legacy 호환)으로 클라이언트 전략별 라우팅/필터 지원; 포트폴리오 화면이 딥링크 `?tab=` 파라미터를 초기 서브탭으로 해석(`resolveInitialSubTab` — 허용 목록 밖/미지정은 `live` 폴백, 마운트 후 새 딥링크도 render-phase 동기화); 트랙 SSOT `@utils/tradeTracks`(5+1트랙 key/label/deepLink·`trackByKey`/`trackByDeepLink` 역식별·라이브 발행=단타·시스템 모의 2종만, 4전략은 백테스트 전용 드릴다운 경로만); 알림 제목 `[{전략}]` prefix 로 인박스 트랙 식별(기존)·트랙별 분리 조회는 포트폴리오 시스템 모의/전략 탭+드릴다운(기존); 인앱 알림 탭 전략 서브필터는 DAR-430 카테고리 세그먼트 합성으로 후속; 스키마 변경 0·실주문 0·AI 금지영역 불침범; BE tsc0·notifications jest 31/31(신규1)·engine5 paper-sim 264/264 회귀0; mobile tsc0·eslint0err·결정론 `check-trade-deeplink-routing` 45/45·`check-portfolio-tabs` 14/14 회귀0; 1.24 (시스템 모의 클린 리셋 §21 — DAR-429: `POST /api/paper-trading/simulation/reset`(JWT 필수 + `body.confirm="RESET"` 필수 — 휴먼 승인 게이트·cron 자동호출 0) 추가 — 과레버리지(DAR-426 이전 현금 -11.3M·자본초과)+리베이스로 오염된 시스템 모의 이력을 제거하고 초기상태(현금=초기자본 10,000,000·OPEN 0)로 복원('원칙만 남기고 다시 시작'); ★해당 sim 유저(`paper-sim@system.local`)의 단일 포트폴리오 범위 DELETE 만(DB 전역 파괴 금지) — `Position`(portfolioId 가드, `PositionDailySnapshot`·`ExitSignal` 캐스케이드)+`PaperTrade`(sim `positionThesisId` 한정·타 트랙 무침범)+`PortfolioRiskSnapshot`+`SignalEntryFunnelDaily`(portfolioId 범위); 멱등(재실행 0건·현금 10M 유지)·`$transaction` 전부-or-전무(부분실패 롤백); 현금은 파생 SSOT(`초기자본+실현손익−보유진입원가`)라 Position 삭제 시 10M 자동 복원; 리셋 후 cron 은 현금가드(DAR-426)+매수기준(`SIM_MIN_ENTRY_GRADE`/`buyScore`) 적용 상태로 0포지션·10M 에서 원칙적 재누적; 단타(intraday-scalp)는 별개(리셋 대상 아님)·동일 현금가드 이미 적용(`15% < 100%` 구조 안전+`cash≥0` enforce 재확인); 스키마 변경 0(데이터 정리만)·AI 금지영역 불침범·실주문 0; 1.23 (라이브 페이퍼 체결 알림 §20 — DAR-424: 모의투자 체결(분봉 단타·시스템 모의 진입/청산)을 종목별로 통지 — `NotificationType.TRADE_ENTRY`/`TRADE_EXIT` 추가(비파괴 enum ADD VALUE)·`NotificationSettings.tradePushEnabled` 토글(기본 ON·OFF면 인박스·푸시 모두 생략) 추가·엔진5 체결 직후 `NotificationProducerService.enqueueTradeEntry/Exit`→`QUEUE.NOTIFY`(`notify.trade-entry`/`notify.trade-exit`)→`NotifyConsumer`가 실 사용자 전원 브로드캐스트(합성 시스템 유저 제외)로 인박스 적재+Expo Push(토글 ON+master+토큰 시)·매수=체결가·수량·현금·평가금/매도=+손익%·청산사유 본문·멱등 `(userId,type,refId)`·발행 graceful(체결 무파손)·AI 금지영역 불침범; 모바일 인앱 알림 탭 TRADE 타입 렌더+설정 '체결 알림' 토글; 4종 백테스트 replay는 라이브 이벤트 아님 제외; 1.22 인트라데이 거래일 분리 §19 — DAR-423: 장중 분봉/단타 `tradeDate`가 어제로 라벨되던 버그 해소 — 일봉 발행 기준 `resolveLatestAvailableTradeDate()`(장중 '오늘 일봉 미게시'→직전 거래일)를 분봉/단타가 그대로 써서, 장중인데도 분봉/단타 보유가 어제(예 6/22) 기준으로 표시됐음. **인트라데이 전용 해석기 `resolveIntradayTradeDate()` 분리** — 평일이고 KST 개장(≥09:00)이면 오늘(today), 장외(개장 전·주말·휴장)면 직전 거래일 폴백; 분봉 수집기 `collectOnce`·단타 `resolveTradeDate`(진입·청산·강제청산·유니버스)가 이 해석기로 정렬; 일봉 resolver는 **무변경**(일봉 수집·EventStudy 등 일봉 맥락 유지·이중 의미 분리); 실제 휴장은 KIS 빈 분봉→유니버스 비고 거래 0 graceful; 이미 수집된 어제 라벨 데이터는 마이그레이션 불요(신규부터 today); 1.21 '최신 공시' 라벨 명확화 §7.5 — DAR-422: 모바일 홈 요약 카드 라벨을 '오늘의 공시 (MM/DD)'→**'최신 공시 (MM/DD)'**로 변경 — DART 공시 데이터 최신일(예 06/19)이 달력 today(예 06/23)보다 뒤처질 수 있어(주말·미게시 지연) '오늘' 표현이 '오늘은 today인데 왜 6/19?' 혼란을 유발했음. 집계 로직·`GET /disclosures/today-count` 응답(`date`/`count`)·숫자(건수) 모두 무변경 — 라벨/문구·accessibilityLabel('최신 공시 MM/DD 기준 N건')만 변경; 1.20 '오늘의 공시' 최신 가용일 집계 §7.5 — DAR-420: `GET /disclosures/today-count`(게스트 허용) 추가 — '오늘' = 최신 가용 공시일(`max(rcpDt)`의 날짜) 건수 반환(전체 누적 137만도, 환경시계 today 0건도 아님; 날짜 prefix `startsWith` 동일일 판정) + 모바일 홈 요약 카드 '오늘의 공시'가 무한쿼리 `meta.total`(전체 누적) 대신 이 집계를 사용·라벨에 최신일(MM/DD) 보조표기; 1.19 분봉 단타 수수료 인지 거래 §19 — DAR-418: TP/SL 청산 임계를 **순(net) 기준**으로 환산 — gross 가격수익률에서 왕복 거래비용율(`2·수수료+매도세+2·슬리피지=0.31%`, 체결 파라미터 `FillParams`에서 `roundTripCostPct()` 산출 SSOT)을 차감한 net 수익률로 익절 +2%/손절 -1.2% 판정(순 +2% 익절=gross +2.31%·순 -1.2% 손절=gross -0.89%로 과손실 방지)·`gross +2%` 소액 익절이 수수료에 먹혀 net +1.69% 적자전환하던 문제 차단; 진입 fee 허들 게이트(기대이동 < 왕복비용+최소마진 0.3% 면 진입 보류); 표시 투명화 — `status`에 `roundTripCostPct`·`takeProfitNetPct`·`stopLossNetPct`·`totalFees`, `trade-history`에 `roundTripCostPct`·행별 `grossReturnPct`·`netReturnPct`·`totalFees` 노출, 모바일 카드/타임라인 '순수익(수수료 후)' 명시; 15:20 강제청산·당일청산·리스크 하드룰 무변경; 1.18 분봉 단타 응답 계약 래핑 §19.1·§19.2 — DAR-417: `intraday-scalp` `status`·`trade-history` 컨트롤러 반환을 `{ success, data }` 로 래핑(strategy-track 등 전 엔드포인트 일관) — 모바일 `simulation.service.ts` 가 `r.data.data` 로 추출하는데 래핑이 없어 `r.data.data`=undefined → React Query `Query data cannot be undefined` 로 '전략' 탭 단타 트랙 카드가 로드 실패하던 블로킹 버그 해소; 1.17 분봉 단타 거래 타임라인 §19.2 — DAR-416: `GET /intraday-scalp/trade-history`(최신 진입순·종목명 결합·OPEN 청산필드 null·게스트 허용) 추가 + 모바일 '전략' 탭 단타 트랙 표면화(`IntradayScalpSection` 별도 섹션·`intraday-scalp.tsx` 드릴다운·실시간 모의/백테스트 불가 시각 구분); 1.16 분봉 단타 진입평가 윈도우 스캔 §19 — DAR-415: 진입 평가가 최신 1봉이 아니라 직전 사이클 이후 도착 분봉 윈도우 전체를 순회(engine3 `scanEntrySignals(candles, fromIndex)` point-in-time 첫 충족봉)·engine5 종목별 스캔 커서로 중복평가 차단·종목당 1라운드트립(OPEN/CLOSED) 과진입 차단·진입ts=충족봉 시각 — 10분 간격 평가가 사이클 사이 충족 순간을 놓쳐 거래 0이던 버그 해소; 1.15 분봉 단타 tradeDate SSOT 정렬 §19 — DAR-414: 단타 진입·청산·강제청산·유니버스가 분봉 수집기와 동일 해석기(`resolveLatestAvailableTradeDate()`, KRX 실 가용 거래일)로 거래일을 해석 — 환경시계 today 직접사용 제거로 분봉 라벨 불일치(거래 0) 버그 해소; 1.14 자산곡선 일별 flat-fill — DAR-412: backtest `buildEquityCurve` + 분봉 단타 `equityCurve` 가 변동 청산일마다 직전 달력일 flat 앵커를 추가해 거래 없는 구간 직선 보간 제거(평평→계단)·4종 전략·단타 동일 적용·표본0/저표본 graceful 유지; 1.13 분봉 단타 트랙 §19 — DAR-411: 분봉(stock_minute_prices) 기반 당일 진입·당일 청산 forward-only 페이퍼 트랙 — 거래량 폭발+돌파+VWAP 3조건 진입·익절+2%/손절-1.2%/15:20 강제청산·engine5 Risk 하드룰·★실주문 0·전용 status 엔드포인트·백테스트 불가 graceful; 1.12 전략 변형 트랙 §18 — DAR-404: 시스템 트레이딩 전략 변형 4종 다중 트랙 비교/거래내역/갱신 엔드포인트·strategyKey 그룹핑·누적수익 ranking·게스트 데모; 이벤트 스터디 분포 §16.2-b — DAR-402: 버킷 D+N 초과수익 분포(평균/중앙값/분위수) 산출로 이상치 오염 표면화 + event_study_results robust 컬럼(median/winsorized) 추가·신호 스코어 event edge 강건화; 1.11 구간 캔들 §17 — DAR-378: TimescaleDB 분봉 하이퍼테이블/연속집계 구간·해상도·페이지네이션·서버측 다운샘플; 1.10 시장지수 실시간 소스 + 신선도 정직 — DAR-371: KIS 업종지수 우선·EOD 폴백 종가 기준일 라벨·source/asOf 필드; 1.9 매매 신호 목록 조회 §12.3 + 기업별 이벤트 스터디 §16.3 문서화 — DAR-222; 1.8 EventStudy 버킷 관측치 드릴다운 — DAR-166; 1.7 시장지수 최신값 — DAR-160; 1.6 포트폴리오 리스크 — DAR-163; 1.5 종목 최신 시세 — DAR-158; 1.4 종목별 최신 신호 — DAR-159)))
