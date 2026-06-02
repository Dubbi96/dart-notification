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
      "createdAt": "2026-03-07T12:00:00Z"
    },
    {
      "id": "clx...",
      "corpCode": "00164779",
      "corpName": "삼성물산",
      "createdAt": "2026-03-06T10:00:00Z"
    }
  ],
  "meta": {
    "total": 2,
    "limit": 30
  }
}
```

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

## 8. 알림 히스토리 (Notifications)

### 8.1 알림 목록 조회

**Endpoint**: `GET /notifications`

**Headers**: `Authorization: Bearer {accessToken}`

**Query Parameters**:
- `page` (optional): 페이지 번호 (기본: 1)
- `limit` (optional): 페이지당 개수 (기본: 20, 최대: 50)
- `isRead` (optional): 읽음 필터 (true | false)

**Request Example**:
```
GET /notifications?isRead=false&page=1&limit=20
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
    "unreadCount": 5
  }
}
```

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

**작성일**: 2026-04-18
**버전**: 1.1 (로그아웃 API 개선)
