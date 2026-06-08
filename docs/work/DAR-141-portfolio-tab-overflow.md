# DAR-141 — 포트폴리오 상단 서브탭 라벨 잘림·우측 클리핑 (bug)

> 등록: 2026-06-08 (사용자 리포트, Android 에뮬레이터 실측) · layer: mobile · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-141-portfolio-tab-overflow`

## 증상
포트폴리오 화면 상단 서브탭(`실전 / 모의 / 모의운용 / 페르소나 / 스타일`)이 한 줄에 균등 분할되며 **라벨이 잘림**. 실제 렌더: `실전`, `모의`, `모의…`(모의운용 truncate), `페르…`(페르소나 truncate), `스타일`(우측 가장자리 클리핑).

## 재현
1. 로그인 → 하단탭 `포트폴리오` 진입
2. 상단 서브탭 바 확인 → 5개 라벨이 `…`로 잘리고 마지막 탭이 화면 밖으로 클리핑됨

## 원인 가설
`mobile/app/(tabs)/portfolio/index.tsx:234-245` 의 RN Paper `SegmentedButtons`에 5개 버튼(아이콘 + 한글 라벨). `SegmentedButtons`는 가로 폭을 **균등 분할**하고 스크롤되지 않으므로, 한글 라벨 5개 + 아이콘이 화면 폭 초과 → truncate / 클리핑.

## 해결 방향 (구현 자유)
- `SegmentedButtons`(균등 분할·비스크롤) 대신 **가로 스크롤 탭/칩 바**(horizontal ScrollView + 칩, 신호탭 `FilterChipRow` 패턴과 일관)로 교체하거나, 5개가 폭에 맞도록 라벨/아이콘 압축.
- 어떤 화면폭(소형 기기 포함)에서도 5개 탭 라벨이 잘리지 않고 모두 접근 가능.
- 테마 토큰 사용(하드코딩 색/spacing 금지), 터치 영역 ≥44pt, `accessibilityRole="button"`·선택상태 라벨 유지.

## 영향 파일
- `mobile/app/(tabs)/portfolio/index.tsx` (`styles.tabs` 포함)

## 수용 기준 (DoD)
- [ ] 5개 서브탭 라벨이 어떤 기기 폭에서도 잘리지 않음(소형 기기에서 가로 스크롤 등으로 전부 접근)
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽에서 탭 바·각 탭 화면 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
- [ ] 탭 전환 동작·선택 표시 정상
