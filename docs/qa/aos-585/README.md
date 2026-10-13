# #585 시각 검토 기록

현재 배포 상태: 2026-10-13 12:10 KST `867ba7dd7`을 사용자 승인 범위인 Android preview/runtime `1.0.4`에 게시했다. 최종 group `22aa1730-eaef-4335-bd39-bbc8dc07515e`. 12:10 다운로드·재시작 후 최종 배지 실행을 확인했다. 앞서 설명 접기 `9fd158352`도 11:45 실제 실행을 확인했다. 아래 실기기 기록과 합성 Web 미리보기는 구분하며, 이전 절의 미배포·미검증 상태는 당시 기록이다. [최신 배포·검수 기록](../../roadmap/aos-mobile-agent-585.md#최신-실기기-검수).

## 실기기 검수 (2026-10-13 11:48~12:12 KST)

SM-S938N, 1080×2340 / density 450 / 시스템 font scale 1.0에서 검수했다. 앱 글자 배율만 1.0·1.25·1.5로 바꿨으며 시스템 글자 확대 검증은 하지 않았다.

- 기기 점검의 인라인 `?` 열기·접기, 22/22 합성 사례 실행, 사례별 상세 토글, Android 뒤로가기를 확인했다.
- 종합 의견 도움말은 기본 및 앱 1.5배, 설정 도움말은 dark / 앱 1.0배와 light / 앱 1.5배에서 확인했다. 설정의 현재값·정렬은 앱 1.25·1.5배에서 확인했다.
- 포지션은 light / 앱 1.5배의 금액·카드 줄바꿈, 알림은 dark / 앱 1.0·1.5배의 로딩 후 긴 본문을 확인했다.
- 최종 배지는 dark / 앱 1.0·1.25·1.5배와 light / 앱 1.5배에서 숫자 잘림과 아이콘 가림 개선을 확인했다. 상단·가로 잘림 없이 벨과 숫자가 식별된다.
- 모든 재검수 후 원래의 dark / 시스템 따름 설정으로 복원했음을 확인했다. 판단 탭을 열어 두었고 시스템 설정·비상 제어·실주문은 조작하지 않았다.

실제 계정 캡처는 `/tmp/aos-585-qa/native-disclosure/`에만 보관한다. 공개 저장소·PR에 업로드하지 않으며, 아래 `disclosure/`·`readability/` 합성 캡처로 대체하지 않는다.

하단 알림 배지 `99+`가 앱 1.25·1.5배에서 `9...`로 잘리는 현상을 발견해 크기와 위치를 최소 수정했다. 최종 45 suites / 332 tests / 5 snapshots, 앱·테스트 TypeScript, Android export 6,182 modules / 13,273,932 bytes 통과. 변경 파일 lint는 오류 0·기존 layout 경고 2건이다. 최종 source `867ba7dd7`의 실기기 캡처는 로컬 `final-badge-dark-100.png`, `final-badge-dark-125.png`, `final-badge-dark-150.png`, `final-badge-light-150.png`, `final-settings-restored.png`다. GitHub CI는 기능·시크릿 검사 4개 통과, 보안 감사 실패다.

네트워크 전환, 잠금/Doze, 장시간 운용, TalkBack, 실거래는 미검증이다. 22/22는 합성 분기 점검 결과이며 수익성·실데이터 검증이 아니다. 보안 게이트는 Mobile 고유 high advisory 4건으로 계속 실패하고, 정식 출시·병합은 보류한다.

## 후속 설명 접기 검수 — 2026-10-13

사용자가 상시 설명을 줄이고 `?`로 모아 달라고 요청했다. `disclosure/`는 기존 색상·글자 크기를 유지한 실제 React Native 컴포넌트의 Web 렌더링이다. 합성 데이터이며 실종목 추천이나 Android 캡처가 아니다.

| 캡처 | 검수 조건·확인 항목 |
| --- | --- |
| `disclosure/decision-dark-390.png` | 390×844 / dark / 1.0, 핵심 의견·가격·중단 기준 상시 표시 |
| `disclosure/help-dark-390.png` | 종합 의견 `?`에서 계산 방식·참고 가격 설명 |
| `disclosure/decision-light-320-large.png` | 320×800 / light / 1.5, 의견·가격 자연 줄바꿈 |
| `disclosure/allocation-light-320-large.png` | 실제 비중·배분액·손실 보전 금지 보존, 도움말 상단 정렬 |
| `disclosure/help-light-320-large.png` | 배분 원리·실행 제한 전체 표시, 닫기 확인 |
| `disclosure/settings-light-320-large.png` | 반복 메뉴 설명 제거, 비상 제어 목적 유지 |
| `disclosure/selfcheck-dark-390.png` | 22/22 합성 점검, 성공 사례 반복 설명 기본 접기 |
| `disclosure/selfcheck-light-320-large.png` | 큰 글자에서 결과 한계·닫기·사례별 상세 접근 |

종합 의견·배분·설정·면책 도움말 열기/닫기와 기기 점검의 인라인 설명 토글·사례별 상세 열기/접기를 직접 확인했다. 320px/1.5에서 측정한 판단·배분·설정 도움말·점검 화면의 문서 가로 넘침 및 leaf 텍스트 가로 잘림은 0이었다. 작은 화면에서는 자연 줄바꿈과 세로 스크롤을 유지하며, 모든 정보가 한 화면에 들어간다는 뜻은 아니다.

확인한 차이는 정상 종합 의견의 계산 과정 단락, 설정 8개 반복 부제, 배분 배경 설명, 면책 전문, 성공 사례별 반복 설명의 상시 노출 제거다. 데이터 누락 이유·실패 설명·중단 기준·손절·종가 기반 모의 상태는 계속 표시한다. 별도 Modal 안의 기기 점검 도움말은 인라인으로 펼쳐 중첩 Modal을 만들지 않는다.

localhost와 합성 서비스만 사용했고, native push API 미지원 dev overlay는 닫고 검수했다. 임시 route와 Web-only 의존성은 제거한 뒤 잠금 파일로 복원했다. Mobile 44 suites / 324 tests / 5 snapshots, 앱·테스트 타입 검사, Android export 통과. 이 Web 기록은 native 글꼴·TalkBack·시스템 뒤로가기 실측을 대신하지 않는다. 사용자 승인 후 진행한 실기기 결과는 위 별도 절과 작업 기록을 따른다.

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

검수 URL은 localhost, API 목적지는 연결 실패를 재현한 localhost 폐쇄 포트였다. 임시 route와 Web-only 의존성은 제거하고 잠금 파일로 복원했다. native push API 미지원 오류를 닫고 시각 검수했으며, 실제 기기에서 같은 픽셀/안전 영역을 보장하는 증거는 아니다. 이 가독성 검수 당시에는 사용자 요청에 따라 추가 기기 조작·APK/OTA 배포를 하지 않았다. 이후 게시와 실기기 확인 결과는 문서 상단을 따른다.

## 최초 중간 캡처

실제 React Native 컴포넌트를 임시 Web harness에서 실행한 합성 데이터 화면이다. Android 실기기 화면이나 실종목 추천이 아니다. 임시 harness와 Web dependency는 빌드 전에 제거했다.

- `decision-dark-390.jpg`: 390px dark, 종합 판단·가격 계획·근거 펼치기.
- `decision-light-320-large.jpg`: 320px light + 1.5배 글자, 가로 넘침 0 확인.
- `selfcheck-dark-390.jpg`: 합성 안전 점검 22/22 결과.

이 캡처 이후 참고 가격에 `약`·`체결가 대비`를 명시하고, 각 점검 사례의 설명과 현재 통제 조회 실패 안내를 추가했다. 따라서 최종 APK 픽셀 검수 증거로 사용하지 않는다. 최종 검증과 설치 상태는 [작업 기록](../../roadmap/aos-mobile-agent-585.md)을 따른다.
