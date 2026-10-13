# #585 시각 검토 기록

## 후속 가독성 검수 — 2026-10-13

`readability/`는 이번 UI 변경의 React Native Web 렌더링이다. 실제 앱 컴포넌트와 하단 탭을 사용했지만, 데이터는 합성 fixture이며 Android 실기기 캡처가 아니다. `example.invalid` 프로필과 검수 기업·금액은 실제 사용자/투자 데이터가 아니다.

| 캡처 | 검수 조건·확인 항목 |
| --- | --- |
| `readability/decision-light-320-large.png` | 320px / light / 1.5, 가격 범위·손절·중단 기준 줄바꿈 |
| `readability/decision-dark-390.png` | 390px / dark / 1.0, 종합 의견·카드 정보 위계 |
| `readability/selfcheck-light-320-large.png` | 320px / light / 1.5, 닫기 분리·22/22 결과·설명 |
| `readability/settings-light-320-large.png` | 320px / light / 1.5, 설정값과 제목의 공간 분리 |
| `readability/notifications-light-320-large.png` | 320px / light / 1.5, 긴 위험 문구 전체 표시 |
| `readability/notifications-dark-320-large.png` | 320px / dark / 1.5, 실제 알림 탭 전환 |
| `readability/portfolio-dark-390.png` | 390px / dark / 1.0, 포지션·Risk·배분 정렬 |
| `readability/portfolio-dark-320-large.png` | 320px / dark / 1.5, 큰 금융 숫자·위험 설명 |
| `readability/tabs-dark-320-large.png` | 320px / dark / 1.5, 실제 하단 탭 4개; 각 80×65px |
| `readability/error-dark-320-large.png` | 320px / dark / 1.5, 합성 연결 실패 상태·재시도 접근 |

문서 가로 넘침 및 측정한 leaf 텍스트 가로 잘림 0. 스크롤 영역 바깥으로 잘린 화면 가장자리는 스크롤 위치에 따른 캡처이며, 고정 말줄임과 구분한다. 기본 화면에서 핵심 조건을 읽고 근거만 펼치는 흐름을 유지했다.

검수 URL은 localhost, API 목적지는 연결 실패를 재현한 localhost 폐쇄 포트였다. 임시 route와 Web-only 의존성은 제거하고 잠금 파일로 복원했다. native push API 미지원 오류를 닫고 시각 검수했으며, 실제 기기에서 같은 픽셀/안전 영역을 보장하는 증거는 아니다. 휴대전화는 사용자 요청에 따라 추가 조작하지 않았다. 이번 UI는 아직 APK/OTA에 배포하지 않았다.

## 최초 중간 캡처

실제 React Native 컴포넌트를 임시 Web harness에서 실행한 합성 데이터 화면이다. Android 실기기 화면이나 실종목 추천이 아니다. 임시 harness와 Web dependency는 빌드 전에 제거했다.

- `decision-dark-390.jpg`: 390px dark, 종합 판단·가격 계획·근거 펼치기.
- `decision-light-320-large.jpg`: 320px light + 1.5배 글자, 가로 넘침 0 확인.
- `selfcheck-dark-390.jpg`: 합성 안전 점검 22/22 결과.

이 캡처 이후 참고 가격에 `약`·`체결가 대비`를 명시하고, 각 점검 사례의 설명과 현재 통제 조회 실패 안내를 추가했다. 따라서 최종 APK 픽셀 검수 증거로 사용하지 않는다. 최종 검증과 설치 상태는 [작업 기록](../../roadmap/aos-mobile-agent-585.md)을 따른다.
