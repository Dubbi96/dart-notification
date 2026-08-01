# AOS Operator Console — Phase A6

Issue #572의 구현 정본이다. 이 단계의 목적은 모바일에 편집 기능을 얹지 않고, 전략 버전과
백테스트·Shadow 원장·비상 통제를 감사 가능한 웹 제어면으로 분리하는 것이다.

## 제공 범위

- React/Vite 기반 독립 `operator-web/` 앱
- 운영 요약, 전략/룰 버전, 백테스트 수용기준, Shadow/Paper 계좌·주문·대사,
  50/30/20 확정이익 배분 계획, 감사 타임라인, Worker 상태, Kill Switch 화면
- `VIEWER`, `EDITOR`, `APPROVER`, `RISK_OFFICER`, `ADMIN` 역할 분리
- 범위별 5분 Step-up 비밀번호 재인증과 단일 사용 토큰
- 모든 변경 명령의 request/result hash 및 append-only receipt
- 읽기 전용 기본값과 개발용 정적 데모 데이터

## 안전 불변식

1. `AOS_OPERATOR_MUTATIONS_ENABLED=false`가 기본값이며 OFF에서는 Step-up 토큰도 소비하지 않는다.
2. 설정 작성과 승인은 역할로 분리되고 동일 사용자의 자기 승인은 거부한다.
3. 전략 활성화는 승인된 버전만 KRX 거래일 종가 후 시각에 예약한다.
4. Kill Switch 발동은 신규 진입 `FULL_HALT`만 지원한다. 해제 명령은 검토 원장만 만들고
   실제 상태를 자동 해제하지 않는다.
5. Admin 콘솔은 LIVE 주문이나 브로커 연결을 제공하지 않는다.
6. command receipt와 Step-up grant는 DB trigger로 수정·삭제·truncate를 차단한다.
7. 자산배분은 계획·승인·취소·재발행만 제공하며 송금·FX·브로커 주문을 실행하지 않는다.

## 운영 준비

현재 단계는 코드와 로컬 DB 검증까지다. 운영 배포 전에는 CORS allowlist, CSP, 운영자 멤버십,
SSO/비밀번호 정책, 감사 보존·백업 정책을 별도로 승인해야 한다. 운영 DB migration과 OCI 배포는
휴먼 승인 없이는 실행하지 않는다.

## 검증 기준

- 새 TimescaleDB에서 전체 77개 migration 적용
- RBAC/read-only/Step-up 단위 테스트
- backend 전체 build/test, operator typecheck/test/build
- production dependency audit
- 375px 모바일 폭과 데스크톱 브라우저에서 전 메뉴, overflow, console error 검수

## 환경 변수

| 변수                             |                      기본값 | 역할                                |
| -------------------------------- | --------------------------: | ----------------------------------- |
| `AOS_OPERATOR_MUTATIONS_ENABLED` |                     `false` | Admin 변경 명령 전역 잠금           |
| `AOS_OPERATOR_BOOTSTRAP_EMAILS`  |                       빈 값 | 최초 운영자용 쉼표 구분 이메일 목록 |
| `VITE_API_BASE_URL`              | `http://localhost:3000/api` | Admin 웹 API base URL               |
| `VITE_AOS_OPERATOR_DEMO`         |                         `0` | 백엔드 없는 읽기 전용 UI 검수       |
