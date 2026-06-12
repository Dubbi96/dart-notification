# DAR-162 — 신호→진입 퍼널 화면 노출(졸업 트래커) (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-162-signal-entry-funnel-screen`

## 배경/문제
백엔드 `GET /graduation/funnel`(SignalEntryFunnelDaily, DAR-109)이 신호→진입후보→체결 전환 데이터를 제공하지만 모바일은 이를 **호출하지 않는다**(졸업 트래커는 `/graduation/metrics`만 소비). 사용자가 신호가 실제 진입으로 얼마나 이어지는지 볼 수 없다.

## 근거 (코드)
- `backend/src/engine5-trading-risk/simulation/graduation.controller.ts:35` — `@Get('funnel')` 존재(FunnelReport 반환).
- 모바일: `/graduation/metrics`만 소비, `/funnel` 호출 0건.

## 해결 방향 (구현 자유)
- 모바일 only: `useGraduationFunnel()` React Query 훅으로 `GET /graduation/funnel` 래핑. 졸업 트래커 카드에 "신호 N → 진입후보 M → 체결 K" 단계별 전환율 바(funnel bar) 추가. 각 단계 수치·전환율(%) 표시. 빈/저표본 시 LOW_SAMPLE 경고 흡수.

## 영향 파일
- `mobile/services/`(graduation funnel API), `mobile/hooks/`(useGraduationFunnel)
- 졸업 트래커 화면/컴포넌트(`mobile/app/.../graduation` 또는 해당 위치)

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] 졸업 트래커에 신호→진입후보→체결 전환율 바 노출, 저표본 경고 흡수
- [ ] 스키마 변경 없음 (모바일 only, 신규 백엔드 없음)
- [ ] AI 금지영역 미침범 · 문서 동기화(해당 시 `docs/api-specification.md` 소비 표기)
