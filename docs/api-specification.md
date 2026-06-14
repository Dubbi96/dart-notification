# API 명세서

## 목차
1. [인증 (Auth)](#1-인증-auth)
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

---

## 공통 사항

### Base URL
```
Development: http://localhost:3000/api
Production: https://api.dart-notification.com/api
```

### 인증 방식
- **JWT Bearer Token** (대부분의 API)
- Authorization Header: `Bearer {accessToken}`

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

### 1.1 회원가입

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

### 1.2 로그인

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

**Headers**: `Authorization: Bearer {accessToken}`

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

**Headers**: `Authorization: Bearer {accessToken}`

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
- `isEnabled`: Boolean

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

**Headers**: `Authorization: Bearer {accessToken}`

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

**Headers**: `Authorization: Bearer {accessToken}`

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

**Headers**: `Authorization: Bearer {accessToken}`

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

## 8. 알림 히스토리 (Notifications)

### 8.1 알림 목록 조회

**Endpoint**: `GET /notifications`

**Headers**: `Authorization: Bearer {accessToken}`

**Query Parameters**:
- `page` (optional): 페이지 번호 (기본: 1)
- `limit` (optional): 페이지당 개수 (기본: 20, 최대: 50)
- `isRead` (optional): 읽음 필터 (true | false)
- `type` (optional, DAR-161): 알림 타입 필터 (`DISCLOSURE` | `SIGNAL` | `EXIT` | `THESIS_VIOLATED`). 미지정 시 전체 타입.

**Request Example**:
```
GET /notifications?isRead=false&page=1&limit=20
GET /notifications?type=SIGNAL&page=1&limit=20
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
      "THESIS_VIOLATED": 0
    }
  }
}
```

> `unreadByType` (DAR-161): 타입별 미읽음 카운트. **타입 필터와 무관하게 사용자 전체(미읽음) 기준**으로 집계되어, 모바일 세그먼트 칩의 타입별 unread 배지가 현재 선택과 독립적으로 동작한다. 모든 타입 키는 항상 존재(미읽음 없으면 0).

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

## 10. Rate Limiting

### 전역 제한
- **60 requests / 분** (IP 기준)

### 인증 엔드포인트 제한
- **5 requests / 분** (IP 기준)
  - `POST /auth/signup`
  - `POST /auth/login`

### Headers
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1678190400
```

---

## 11. 푸시 알림 Payload

**Expo Push Notification 형식**:
```json
{
  "to": "ExponentPushToken[...]",
  "sound": "default",
  "title": "새 공시: 삼성전자",
  "body": "주주총회소집공고",
  "data": {
    "type": "disclosure",
    "disclosureRcpNo": "20260307000123"
  }
}
```

**Deep Link**:
- 앱 내 라우팅: `disclosure/:rcpNo`

---

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
      "scoreBreakdown": [],
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
| `data[].scoreBreakdown[]` | object | 점수 구성 항목별 분해(표본수 포함) |
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

KOSPI(0001)·KOSDAQ(1001)의 최신 종가지수 + 전일대비 등락폭·등락률(%) + 거래일을 반환한다.
홈 헤더 '시장 한눈에' 배지·신호 화면 시장국면 맥락에 쓰인다. 시장 데이터는 비개인 공개정보이므로
게스트도 열람 가능(컨트롤러 기본 JWT 가드를 메서드 단위 OptionalJwt 로 덮음).

**응답** (`data`: 배열, 미적재 지수는 생략됨)

```json
{
  "success": true,
  "data": [
    {
      "indexCode": "0001",
      "indexName": "KOSPI",
      "market": "KOSPI",
      "tradeDate": "20260611",
      "closeIndex": 2727.0,
      "prevCloseIndex": 2700.0,
      "change": 27.0,
      "changePercent": 1.0
    },
    {
      "indexCode": "1001",
      "indexName": "KOSDAQ",
      "market": "KOSDAQ",
      "tradeDate": "20260611",
      "closeIndex": 792.0,
      "prevCloseIndex": 800.0,
      "change": -8.0,
      "changePercent": -1.0
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `indexCode` | string | 지수코드 (0001=KOSPI, 1001=KOSDAQ) |
| `market` | `'KOSPI' \| 'KOSDAQ'` | 시장 구분 |
| `tradeDate` | string (YYYYMMDD) | 최신 거래일 |
| `closeIndex` | number | 최신 종가지수 |
| `prevCloseIndex` | number \| null | 전일 종가지수 (없으면 null) |
| `change` | number \| null | 전일대비 등락폭(포인트) |
| `changePercent` | number \| null | 전일대비 등락률(%) |

> 전일 데이터가 1건뿐이면 `prevCloseIndex`·`change`·`changePercent`는 `null`. 데이터가 전혀 없으면 빈 배열(홈 배지 미표시).

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

---

**작성일**: 2026-06-14
**버전**: 1.9 (매매 신호 목록 조회 §12.3 + 기업별 이벤트 스터디 §16.3 문서화 — DAR-222; 1.8 EventStudy 버킷 관측치 드릴다운 — DAR-166; 1.7 시장지수 최신값 — DAR-160; 1.6 포트폴리오 리스크 — DAR-163; 1.5 종목 최신 시세 — DAR-158; 1.4 종목별 최신 신호 — DAR-159)
