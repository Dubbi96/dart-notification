# AOS Mobile On-device Rule — Phase A7

Issue #574의 구현 정본이다. 모바일은 `판단 → 포지션 → 알림 → 제어` 네 영역만 전면에 두고,
종가 후 후보의 Rule/Risk 재평가를 서버 호출 없이 기기 프로세스에서 수행한다.

## 사용자 결정과 권한 경계

기존 컨텍스트 문서의 “모바일은 receipt 검증만 수행” 권고는 이후 사용자의 명시적 결정인
“Rule 계산을 디바이스에서 계속 수행”으로 변경됐다. 이를 다음 두 경계로 구현한다.

- 모바일 표시·Shadow 계획: 동일한 순수 `packages/aos-rule-engine`을 Android/iOS에서 직접 실행한다.
- 서버 영속 원장·Shadow 체결·향후 주문: 서버 Rule/Risk Gate만 상태를 변경한다.

즉, 앱은 종가 입력이 바뀔 때마다 즉시 다시 계산하지만 주문을 생성하지 않는다. AI는 공시 요약과
점수 입력을 제공할 수 있을 뿐, `BLOCKED`, 가격 결측, Risk flag를 우회할 수 없다. 향후 실거래는
Phase A9의 별도 승인 전까지 범위 밖이다.

## 계산 계약

| 항목 | 현재 버전/값 | 동작 |
|---|---|---|
| Strategy | `mobile-shadow-short-momentum.v1` | 국내주식 Long Only, 2~5거래일 Shadow |
| Risk | `mobile-shadow-risk.v1` | 가격 결측·Risk flag·blocked 신호 fail-safe |
| 진입 관심 구간 | 기준 종가 -2% ~ 기준 종가 | `READY`에서만 표시 |
| 부분 익절 | 진입 상단 대비 +10%, 50% | 주문이 아닌 조건부 계획 |
| 손절 | 진입 상단 대비 -5% | 계획 중단 기준과 함께 표시 |
| 최대 보유 | 5거래일 | 기존 short-momentum rulebook과 일치 |

기준 가격은 에디션 거래일 이하 최신 `StockDailyPrice` 종가다. 백엔드는 종목들을 한 번에 조회해
`referencePrice { tradeDate, closePrice, highPrice, lowPrice, source }`를 추가한다. 가격이 없으면 앱은
숫자를 추정하지 않고 `가격 확인 전 대기`로 표시한다. Rule parameter, Strategy/Risk config, Feature
Snapshot, canonical receipt는 SHA-256 hash로 식별한다.

## 화면 구조

1. `종가 후 운영 브리핑`: 결론, 계획/조건확인/대기 건수, Strategy Version, 기준일과 receipt.
2. 실행 카드: 회사·이벤트는 한 줄로 제한하고, 결론과 두 줄 논리를 먼저 표시한다.
3. Rule/Risk가 모두 통과한 카드만 진입 구간·부분익절·손절·보유기한을 표시한다.
4. 원시 공시·AI·지표는 `근거 보기` 상세로 이동한다.
5. 포지션 화면은 보유·손익·Risk만 남긴다. 모의 비교·백테스트·운영 상세는 Admin으로 이관한다.

과거 날짜는 `당시 기준`과 stale 배너를 표시한다. 네트워크 실패 시 SecureStore에 저장한 마지막
version/hash/상태 요약만 보여 주며, 전체 가격 입력이나 민감 데이터를 영속하지 않는다.

## 모바일 비상 제어

- 로그인한 사용자가 화면에 진입했을 때만 운영자 권한을 조회한다.
- `EMERGENCY_CONTROL` 권한과 서버 mutation flag가 모두 있어야 활성화된다.
- 사유와 비밀번호 재확인 후 1.2초 길게 눌러 `NEW_ENTRY/FULL_HALT`만 요청한다.
- 서버가 발급한 5분·1회용 Step-up 토큰을 명령 한 건에 소비한다.
- 성공 후 적용 시각과 append-only Kill event receipt hash를 표시한다.
- 자동 해제, 전체 주문 중단, Rule/Weight 편집은 모바일에 없다. 복구는 Admin에서 검토한다.

## 경량화 결과

- Android Expo export module: 6,260 → 6,182 (-78)
- Hermes bundle: 약 14MB → 13,215,749 bytes
- 변경 diff: +737 / -7,047, net -6,310 lines
- 기존 홈, 6개 포트폴리오 비교/모의, 모바일 백테스트·운영비용·수집·철학·이벤트 탐색 화면은
  데이터를 삭제하지 않고 경량 호환 redirect로 전환했다.

기기 수치는 동일 개발 머신의 clean Android export 기준이다. Android/iOS 실기기 font scale과
시각 회귀는 연결된 기기가 없어 EAS 내부 배포 APK에서 후속 확인한다.

## 검증

- shared evaluator package build/test
- mobile typecheck/lint, 전체 Jest
- backend build와 daily edition 계약 테스트
- Android clean export
- 긴 문자열은 `numberOfLines`, `flexShrink`, `minWidth: 0`, wrap grid로 방어
- 숫자 계획은 결측/Risk/미충족 조건 테스트에서 미노출 확인

운영 DB migration과 OCI 배포는 이 Phase에 포함하지 않는다.
