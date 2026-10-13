# AOS 모바일 판단 화면 개선 · #585

기준일: 2026-10-13. 시작 commit: `9cadc5d48`. 브랜치: `feat/585-aos-mobile-agent`.

## 작업 범위와 계획 확인

- [x] 기존 1.0.3 / Android build 5 첫 화면 확인. 갤럭시 SM-S938N에서 10월 6일 과거 판단이 표시되는 것을 확인했다. 사용자가 USB를 분리한 동안 기기 조작을 중단했고, 재연결·조작 허용 후 같은 설치 버전과 화면을 다시 확인했다. 새 APK 설치 검증과는 구분한다.
- [x] 기존 청록색·네이비/라벤더 톤 유지. 종합 의견 → 가격 계획/중단 기준 → 펼쳐 보는 근거로 정리.
- [x] 48dp 버튼, 누름·포커스·로딩·접힘 상태, 동작 줄이기 적용. 과거 카드 전체 투명도를 없애 글자 대비 유지.
- [x] 기기 Rule의 데이터 유효성·현재/과거 구분·통제 미확인 차단과 22개 합성 안전 점검 연결.
- [x] 시세 수집시각 메타데이터 추가. 거래소 체결시각은 알 수 없으면 null 유지.
- [x] 사람이 읽는 분석 4개 GPT task에 Humanizer 문장 지침 적용. 추가 LLM 호출·모델 교체 없음.
- [x] 실거래 준비도 및 사용자 등록 절차 문서화.
- [x] 최종 로컬 회귀·타입·번들·보안 게이트 결과 기록.
- [x] 내부 검토 APK 빌드·Draft PR 결과 기록.
- [x] 변경 APK의 실제 휴대전화 설치·로그인 유지·터치·모달 뒤로가기 검증.
- [ ] 마지막 문구 보완 OTA의 실제 기기 적용 확인, 큰 글자·네트워크 전환·백그라운드 검증.

실거래 활성화, 운영 배포, DB migration은 이번 범위에서 실행하지 않는다. 실계좌 자동매매 Agent 완성 또는 투자성과 검증 완료로 표시하지 않는다. 판단 주체를 기기에 두겠다는 요구는 유지하며, 폰이 꺼졌을 때의 보호 정책은 사용자 결정으로 남긴다.

## 디자인 기준

기존 팔레트 `#14B8A6`, `#0F766E`, `#F9FAFB`, `#FFFFFF`, `#060A18`, `#818CF8`를 사용한다. 제목 22px, 본문 16px, 보조 14px를 중심으로 하며 기존 시스템 글꼴/글자 배율을 재사용한다. 라이트 버튼은 짙은 청록색으로 흰 글자 대비를 높였다. 카드의 고정 2열 가격표는 세로 흐름으로 바꾸고 긴 회사명·근거를 자르지 않는다.

선택과 처리 상태를 즉시 표시하고, 상세 근거는 누를 때만 160ms로 나타난다. Reduced Motion에서는 효과를 생략한다. 스크롤 등장 효과나 새 애니메이션 라이브러리는 추가하지 않았다. 손절/중단 기준은 접혀 있어도 보인다.

참고: [Apple Controls](https://developer.apple.com/design/human-interface-guidelines/controls), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [템킷 인터랙션 디자인](https://temkit.kr/article/?bmode=view&idx=170510925). Apple 공식 DocC 본문과 템킷 공개 HTML 본문을 확인했다.

## 검증 기록

- Backend: production build, 전체 `tsc --noEmit`, 의존성 패치 후 전체 회귀 368 suites / 4,791 tests 통과. 기존 테스트의 타입 오류 두 파일을 실제 계약에 맞게 정정했다.
- Mobile: 실기기 문구 보완 후 최종 전체 회귀 37 suites / 277 tests / 5 snapshots 통과. 앱·테스트 타입 검사 통과, lint 오류 0(기존 경고 829), Android export 6,181 modules / 약 13 MB Hermes bundle 생성. 전체 Jest는 기존 미종료 handle 때문에 `--forceExit`를 사용했다. 앱 장시간 안정성 증거는 아니다.
- Operator: 타입 검사·production build·2 tests 통과. 공유 Rule core 17 tests와 플랫폼 경계 검사 통과.
- 합성 자체 점검: 22 / 22. 브라우저에서 동일 컴포넌트를 실행해 결과 표시 확인. 수익성/실제 계좌/현재 데이터 검증 아님.
- 시각 검토: 임시 React Native Web harness로 390px dark, 320px light + 1.5배 글자, 근거 펼치기·접기, 자체 점검·닫기 확인. 320px DOM 가로 넘침 0. Android 렌더링과 동일하다고 단정하지 않는다.
- Web harness는 native push API 미지원 오류가 있어 해당 dev overlay를 닫고 UI 컴포넌트만 검토했다. 실제 앱 Web 지원 완료 증거가 아니다. harness와 임시 Web dependency는 검토 후 제거했다.
- 스크린샷: `docs/qa/aos-585/`. 모두 명시적인 합성 데이터이며 실종목 추천이 아니다. 마지막 참고 가격 문구(`약`, `체결가 대비`)와 점검 사례 설명을 보완하기 전의 중간 시각 검토 기록이다. 최종 문구는 회귀 테스트로 확인했고 최종 APK 화면은 별도 검수한다.

### 보안과 출시 판단

최소 범위 의존성 패치로 Backend 신규 차단 advisory 12→0, Operator 2→0, Mobile 35→4로 줄였다. 새 예외나 대규모 framework 변경은 없다. Backend production audit에는 기존 예외 high 4건이 남고, Mobile은 `braces`, `node-forge`, `image-size` 관련 high advisory 4건 때문에 **보안 게이트 실패**다. 합쳐진 취약 의존성 수와 고유 advisory 수는 다르다. 세부 사유는 준비도 문서에 기록한다.

기능 검증은 통과했지만 정식 출시·병합 승인 상태가 아니다. APK는 내부 검토용 `1.0.4 (6)` / `preview`다. [Draft PR #586](https://github.com/Dubbi96/dart-notification/pull/586)은 병합하지 않았다. 첫 commit과 마지막 기능 commit `3c5349126`의 GitHub 검증 모두 Backend·Mobile·Operator·gitleaks 통과, 보안 감사 실패(4/5)다.

### APK와 실기기 검수

- EAS build `0b81513b-cffa-4f36-b534-f3a2500ddd2a`: 2026-10-13 10:21 KST **FINISHED**. [내부 APK](https://expo.dev/artifacts/eas/cI7nkXowyASYvENGVTkpoajI_ImNJ3uhZnAEa44_1JI.apk), 117,533,652 bytes. ZIP 무결성 검사 통과.
- SHA-256: `39b0847a6307b0adeef6c1f622276e2ad252ea3b4fd7eeb5a0ab175bced5b09d`.
- 업로드 당시 기능 소스는 첫 commit `7e8546bc2`에 기록한 작업트리 내용이다(빌드 메타데이터 Git SHA는 업로드 직전 기반 commit을 가리킴). APK에 이후 문구 보완은 포함돼 있지 않다.
- 사용자가 미해결 보안 항목 안내 후 내부 APK 설치를 승인했다. `adb install -r` 성공, 설치 버전 `1.0.4 / versionCode 6` 확인. 삭제·재가입 없이 기존 로그인과 에디션 선택이 유지됐다.
- 갤럭시 SM-S938N, 1080×2340 / density 450 / 시스템 font scale 1.0에서 dark 화면 확인. 하단 탭 글자·간격, 카드 본문 줄바꿈, 근거 펼치기, 합성 안전 점검 **22/22**, Android 뒤로가기로 모달 닫기를 확인했다. 실계좌/투자 성과 검증이 아니다.
- 실기기에서 미충족 진입 조건이 중단 조건처럼 읽히는 문구와 중복 경고 아이콘을 발견해 commit `3c5349126`에서 표시만 보완했다. 판단 로직·Rule version·receipt·면책 본문은 그대로다.
- 이 보완은 Android **preview / runtime 1.0.4**에만 EAS Update로 배포했다. group `1281f2cf-6af9-44cf-93e8-2a7cd663ca5c`, update `01a132e1-5a64-7d3b-bc3f-4d90fbd8c62e`, 10:29 KST. 기존 `1.0.3` 및 production 채널에는 배포하지 않았다. 온라인 재시작 후 적용되는 작은 문구 보완이며 기본 APK 단독과 구분한다.
- 검수 도중 다른 앱이 전면으로 전환되어 추가 조작을 중단하고 사용 가능 여부를 요청했다. 다른 앱의 내용은 검수하지 않았다. 최종 OTA 적용·큰 글자·네트워크 전환·잠금/Doze·장시간 운용은 아직 실기기 미검증이다. 실기기 캡처는 공개 저장소가 아닌 로컬 검수 폴더에 보관한다.

## 배포 시 주의

새 API 필드는 optional 소비로 기존 서버와 호환한다. GPT 문체 변경과 시세 메타데이터는 Backend 배포 후 새 응답에 적용된다. 과거 저장 분석은 자동 재작성하지 않는다. 모바일은 기존 캐시 receipt를 현재 주문 가능 근거로 쓰지 않는다.

남은 기술적 위험과 등록 절차는 [준비도 검토](aos-agent-readiness-585.md)에 정리했다. 운영 권한 상세 보안 점검은 공개 저장소 밖의 운영자용 문서로 분리했다.

## 2026-10-13 후속: 가독성·레이아웃 검수

사용자가 추가로 제시한 [Figma UI 디자인 원칙](https://www.figma.com/ko-kr/resource-library/ui-design-principles/)의 정보 위계·점진적 공개·일관성·대비·접근성·근접성·정렬을 체크리스트로 사용했다. 같은 #585/PR #586 범위에서 UI만 보완했다.

### 계획 → 검토 → 적용

기존 톤을 유지하는 색상 기준은 배경 `#F9FAFB`, 밝은 표면 `#FFFFFF`, 본문 `#111827`, 읽기용 청록 `#0F766E`, 어두운 배경 `#060A18`, 어두운 강조 `#818CF8`이다. System/Roboto와 기존 한국어 fallback을 유지한다. 제목 22, 본문 16, 설명·조작 라벨 14 기준으로 앱 배율 1.0~1.5를 적용한다. 색상·글꼴·라이브러리를 새로 도입하는 재설계는 하지 않았다.

좁은 화면에서 정보가 경쟁하던 두 배치를 비교하고, 중요한 내용을 축소하지 않는 세로 흐름을 선택했다.

```text
기존                          적용
[회사명… | 상태 | >]           [회사명 전체             >]
[가격 자동 축소]               [상태]
[위험 설명 두 줄…]             [가격 · 자연 줄바꿈]
                              [중단 기준 전체]
                              [근거 펼치기]
```

정렬은 카드 본문 좌측, 상세 헤더는 기존 중앙 정렬을 유지한다. 위험 설명은 접지 않고, 추가 근거만 펼치도록 기존 동작을 보존했다. 숫자를 작게 줄여 맞추는 방식은 제거했다. 포지션·배분의 금융 수치와 알림 위험 문구는 전체 내용이 읽혀야 한다는 기준을 우선했다.

### 적용 내용

- 공통 헤더·접이식 카드·공시 브리핑·위험 알림의 한 줄/두 줄 재단 제거. 제목·설명·상태·수량의 폭 경쟁을 줄였다.
- 가격 범위는 금액 단위로 줄바꿈하고, 배분 3열은 세로 목록으로 바꿨다. 큰 총액은 축소 대신 자연 높이로 표시한다.
- 날짜 칩은 글자 배율에 맞춰 넓어지며, 탭 라벨은 12→14 기준과 배율 연동 높이를 사용한다. 탭의 자동 글자 축소는 제거했다.
- 설정 프로필과 메뉴를 한 스크롤로 묶고 설정값을 제목 아래로 이동했다. 앱 버전은 고정 문자열 대신 실제 Expo config를 읽는다.
- 에디션 알림 신청 배너를 리스트 안으로 옮겼다. 좁은 화면에서 배너가 본문을 밀어내지 않고 함께 스크롤된다. 오류·재시도 화면도 스크롤 가능하다.
- 오프라인 배너는 헤더를 덮는 절대 배치 대신 독립 행이다. Stack에 실제 SafeAreaProvider를 두어 이미 배너가 소비한 상단 inset을 다시 더하지 않게 했다. 해당 native 전환은 실기기 확인 대기다.
- 밝은 테마의 강조·설명·위험 색상을 같은 계열의 진한 색으로 조정했다. 기본/보조 표면 및 상태 표면의 지정 텍스트 조합은 4.5:1 이상을 회귀 검사한다. 앱 전체 WCAG 인증을 뜻하지 않는다.
- 포지션 카드 안 손익 칩은 정적 표시로 바꿔 중첩 버튼을 없앴다. 카드 전체의 상세 이동은 유지하고 독립 손익 칩의 설명 시트는 유지한다. 공통 오류 버튼은 기존 공통 Button을 재사용한다.

### 검증과 배포 경계

- 임시 React Native Web harness에서 실제 컴포넌트·실제 탭을 합성 데이터로 렌더했다. 390×844 dark/1.0 및 320×800 light·dark/1.5를 확인했다. 각 측정 화면의 문서 폭은 viewport와 같고, leaf 텍스트의 가로 잘림은 0이었다. 내부 가로 스크롤 필터는 의도된 동작이다.
- 긴 한국어 회사명·설명, 1,234,567,890원 배분 총액, 알림 위험 문구, 설정값, 22/22 점검 결과, 근거 펼치기, 닫기, 실제 탭 전환, 연결 실패 안내·재시도를 확인했다. 320px/1.5 실제 탭의 터치 영역은 각 80×65px이었다.
- 웹 전용 검수에서는 native push API 미지원 dev overlay를 닫고 화면을 검사했다. 기존 중첩 button 경고는 정적 손익 칩으로 수정 후 사라졌다. 전체 Web 앱 지원 완료나 native push 검증으로 보고하지 않는다.
- 최종 잠금 파일 복원 후 Mobile 43 suites / 312 tests / 5 snapshots, 앱·테스트 TypeScript 통과. lint 0 errors / 기존 경고 816. 기존 Jest 미종료 handle 때문에 `--forceExit`를 사용했다.
- Android export 완료(약 13 MB Hermes bundle), 알림 배너 배치 가드 45/45 통과. 모바일 보안 게이트를 다시 실행했으며 기존 high advisory 4건으로 실패한다. 새 예외·의존성 변경은 없다.
- 임시 route·fixture·RN Web 의존성은 제거했다. package.json/package-lock.json 변경 없음. 화면 증거는 [검수 기록](../qa/aos-585/README.md)의 `readability/`에 보관한다.
- 사용자가 휴대전화 사용 중이라 **우선 개발·미리보기 검수**를 요청했다. 이후 기기는 조작하지 않았다. 이번 변경은 기존 APK/OTA에 아직 배포하지 않았고, 새 APK·실기기 적용 완료라고 표시하지 않는다.
- 운영 서버·DB·Rule/Risk 판단·실주문은 변경하지 않았다. Android의 한글 받침, 시스템 글자 배율, 노치/내비게이션 안전 영역, 오프라인 전환은 다음 실기기 검수 항목이다. 기존 보안 차단 문제는 디자인 수정과 별개다.
