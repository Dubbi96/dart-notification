# DAR-163 — 포트폴리오 리스크 스냅샷 조회 API + 배지 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: medium · effort: medium
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-163-portfolio-risk-snapshot-api`

## 배경/문제
PortfolioRiskSnapshot(일손익 dailyPnl·집중도 topPositionPct·하드룰위반 hardRuleBreached·riskLevel)이 적재되지만 **읽는 컨트롤러가 0건**이다. 사용자는 포트폴리오의 당일 손익·집중 리스크·하드룰 위반 여부를 화면에서 확인할 수 없다.

## 근거 (코드)
- `backend/prisma/schema.prisma:1203` — `PortfolioRiskSnapshot`(dailyPnl·topPositionPct·hardRuleBreached·riskLevel) 모델 존재, 읽기 컨트롤러 없음.

## 해결 방향 (구현 자유)
- 백엔드(Engine4 portfolio): `GET /portfolio/risk/latest` 추가. 최신 스냅샷의 일손익·최대비중·하드룰 위반·riskLevel 반환. 스냅샷 없으면 빈상태(null) 흡수. AI 금지영역(Engine5 Risk 하드룰 로직)은 침범 금지 — 읽기만. 상대경로 import.
- 모바일: `usePortfolioRisk()` React Query 훅. 포트폴리오 화면 상단에 리스크 배지(일손익 색상·집중도 %·하드룰 위반 경고 칩). 데이터 없으면 배지 미표시.

## 영향 파일
- `backend/src/engine4-portfolio-exit/`(portfolio risk 컨트롤러/서비스)
- `mobile/app/.../portfolio`, `mobile/hooks/`, `mobile/services/`
- `docs/api-specification.md`

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] `GET /portfolio/risk/latest`가 일손익·집중도·하드룰위반·riskLevel 반환, 스냅샷 부재 시 빈상태
- [ ] 포트폴리오 화면에 리스크 배지 노출, 데이터 없을 때 깨지지 않음
- [ ] 스키마 변경 없음
- [ ] AI 금지영역 미침범(Engine5 Risk 독립, 읽기만) · 문서 동기화(`docs/api-specification.md`)
