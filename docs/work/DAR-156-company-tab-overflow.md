# DAR-156 — 기업 상세 상단 6탭 과밀 → 가로스크롤/우선순위 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: low · effort: medium
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-156-company-tab-overflow`

## 배경/증상
기업 상세 상단 서브탭이 판단/공시/재무/내부자/통계/적합도 6개를 한 줄 SegmentedButtons에 욱여넣어, 좁은 기기에서 라벨이 압축·잘리고 오탭이 발생한다.

## 근거 (코드)
- `app/company/[corpCode].tsx:400-414` — `SegmentedButtons`에 6개 탭(판단/공시/재무/내부자/통계/적합도)을 한 줄로 배치 → 좁은 폭에서 라벨 압축·오탭.

## 해결 방향 (구현 자유)
- 핵심 3~4개만 노출하고 나머지는 "더보기"로 접기, 또는
- 가로 스크롤 칩 행으로 전환 — DAR-141 포트폴리오 상단 서브탭 가로 스크롤 패턴 재사용.
- 활성 탭 시인성·터치 타깃·접근성 라벨 유지, 테마 토큰 사용.

## 영향 파일
- `app/company/[corpCode].tsx`

## 수용 기준 (DoD)
- [ ] 좁은 기기에서도 6개 탭 라벨이 잘리지 않고 선택 동작 정상
- [ ] 활성 탭 시각 구분 명확, 오탭 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
