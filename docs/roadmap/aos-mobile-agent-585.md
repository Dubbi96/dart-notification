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
- [ ] 내부 검토 APK 빌드·Draft PR 결과 기록.
- [ ] 변경 APK의 실제 휴대전화 설치·터치·네트워크 전환·백그라운드 검증.

실거래 활성화, 운영 배포, DB migration은 이번 범위에서 실행하지 않는다. 실계좌 자동매매 Agent 완성 또는 투자성과 검증 완료로 표시하지 않는다. 판단 주체를 기기에 두겠다는 요구는 유지하며, 폰이 꺼졌을 때의 보호 정책은 사용자 결정으로 남긴다.

## 디자인 기준

기존 팔레트 `#14B8A6`, `#0F766E`, `#F9FAFB`, `#FFFFFF`, `#060A18`, `#818CF8`를 사용한다. 제목 22px, 본문 16px, 보조 14px를 중심으로 하며 기존 시스템 글꼴/글자 배율을 재사용한다. 라이트 버튼은 짙은 청록색으로 흰 글자 대비를 높였다. 카드의 고정 2열 가격표는 세로 흐름으로 바꾸고 긴 회사명·근거를 자르지 않는다.

선택과 처리 상태를 즉시 표시하고, 상세 근거는 누를 때만 160ms로 나타난다. Reduced Motion에서는 효과를 생략한다. 스크롤 등장 효과나 새 애니메이션 라이브러리는 추가하지 않았다. 손절/중단 기준은 접혀 있어도 보인다.

참고: [Apple Controls](https://developer.apple.com/design/human-interface-guidelines/controls), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [템킷 인터랙션 디자인](https://temkit.kr/article/?bmode=view&idx=170510925). Apple 공식 DocC 본문과 템킷 공개 HTML 본문을 확인했다.

## 검증 기록

- Backend: production build, 전체 `tsc --noEmit`, 의존성 패치 후 전체 회귀 368 suites / 4,791 tests 통과. 기존 테스트의 타입 오류 두 파일을 실제 계약에 맞게 정정했다.
- Mobile: 최종 전체 회귀 36 suites / 275 tests / 5 snapshots 통과. 앱·테스트 타입 검사 통과, lint 오류 0(기존 경고 829), Android export 6,181 modules / 약 13 MB Hermes bundle 생성. 전체 Jest는 기존 미종료 handle 때문에 `--forceExit`를 사용했다. 앱 장시간 안정성 증거는 아니다.
- Operator: 타입 검사·production build·2 tests 통과. 공유 Rule core 17 tests와 플랫폼 경계 검사 통과.
- 합성 자체 점검: 22 / 22. 브라우저에서 동일 컴포넌트를 실행해 결과 표시 확인. 수익성/실제 계좌/현재 데이터 검증 아님.
- 시각 검토: 임시 React Native Web harness로 390px dark, 320px light + 1.5배 글자, 근거 펼치기·접기, 자체 점검·닫기 확인. 320px DOM 가로 넘침 0. Android 렌더링과 동일하다고 단정하지 않는다.
- Web harness는 native push API 미지원 오류가 있어 해당 dev overlay를 닫고 UI 컴포넌트만 검토했다. 실제 앱 Web 지원 완료 증거가 아니다. harness와 임시 Web dependency는 검토 후 제거했다.
- 스크린샷: `docs/qa/aos-585/`. 모두 명시적인 합성 데이터이며 실종목 추천이 아니다. 마지막 참고 가격 문구(`약`, `체결가 대비`)와 점검 사례 설명을 보완하기 전의 중간 시각 검토 기록이다. 최종 문구는 회귀 테스트로 확인했고 최종 APK 화면은 별도 검수한다.

### 보안과 출시 판단

최소 범위 의존성 패치로 Backend 신규 차단 advisory 12→0, Operator 2→0, Mobile 35→4로 줄였다. 새 예외나 대규모 framework 변경은 없다. Backend production audit에는 기존 예외 high 4건이 남고, Mobile은 `braces`, `node-forge`, `image-size` 관련 high advisory 4건 때문에 **보안 게이트 실패**다. 합쳐진 취약 의존성 수와 고유 advisory 수는 다르다. 세부 사유는 준비도 문서에 기록한다.

기능 검증은 통과했지만 정식 출시·병합 승인 상태가 아니다. APK는 내부 검토용 `1.0.4 (6)` / `preview`로 빌드하며 기존 `1.0.3`에 OTA를 보내지 않는다. EAS build ID: `0b81513b-cffa-4f36-b534-f3a2500ddd2a`. 빌드 완료·파일 무결성·설치 여부는 결과 확인 후 기록한다.

## 배포 시 주의

새 API 필드는 optional 소비로 기존 서버와 호환한다. GPT 문체 변경과 시세 메타데이터는 Backend 배포 후 새 응답에 적용된다. 과거 저장 분석은 자동 재작성하지 않는다. 모바일은 기존 캐시 receipt를 현재 주문 가능 근거로 쓰지 않는다.

남은 기술적 위험과 등록 절차는 [준비도 검토](aos-agent-readiness-585.md)에 정리했다. 운영 권한 상세 보안 점검은 공개 저장소 밖의 운영자용 문서로 분리했다.
