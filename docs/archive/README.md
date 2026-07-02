# docs/archive — 완료·대체된 문서 보관소

> 신설: 2026-07-02 문서 전수 감사 (docs/roadmap/cc-resume-plan-2026-07-02.md §문서감사)
> 원칙: **삭제하지 않고 이동** — git 이력 + 원문 보존. 여기 문서는 역사 기록이며 **현재 상태 판단의 근거로 쓰지 않는다.**

## 이동 기준

- 계획·기획 문서의 전 항목이 구현 완료되어 계획 문서로서의 기능을 상실
- 특정 시점 스냅샷(QA 리포트, 졸업 리포트, 인수 시점 기준선)으로 수치가 현재와 무관
- 후속 정본 문서로 완전히 대체된 세션 핸드오프

## 보관 목록 (2026-07-02 이동, 21건)

| 문서 | 성격 | 현행 대체 정본 |
|---|---|---|
| `development-plan.md` | 2026-03 초기 4주 MVP 계획 | `docs/roadmap/01-execution-roadmap.md` |
| `feature-status.md` | 2026-06-02 인수 시점 기능 스냅샷 | 코드 + `docs/roadmap/cc-resume-plan-2026-07-02.md` |
| `mobile/ux-advancement-direction.md` | UX 고도화 방향(전 항목 구현됨) | `docs/roadmap/cc-ui-ux-audit-2026-06-27.md` |
| `mobile/ux-advancement-spec.md` | UX 고도화 실행 스펙(구현됨) — `mobile/utils/copy.ts`가 §3-3 인용 | 〃 |
| `mobile/ux-detail-plan.md` | UX 상세 기획(구현됨) — emptyStateCopy/snackbarCopy가 §2-2·§3-1 인용 | 〃 (런타임 SSOT는 코드) |
| `roadmap/m10-graduation-report.md` | 2026-06-05 E2E 졸업 게이트 스냅샷 | 재실행: `backend/src/e2e/integration-regression.ts` |
| `roadmap/cc-app-advancement-backlog.md` | 패널 백로그 v1~v5(전부 이슈 소진) | Paperclip 이슈 + `docs/work/` |
| `roadmap/cc-roadmap-2026-06-08-handoff.md` | 세션 핸드오프(해소됨) | `docs/roadmap/cc-pause-handoff-2026-06-28.md` |
| `roadmap/cc-signal-portfolio-ux-redesign.md` | 신호/포트폴리오 UX 재설계 스펙(구현됨) | 구현 코드 + UX 감사 정본 |
| `work/DAR-134·141·142·166-*.md` | 완료 이슈 작업 문서 4건 | 각 머지 커밋·구현 코드 |
| `work/m0/` 4건 · `work/m1/` 2건 · `work/m2/` 2건 | 완료 마일스톤 계약·QA·기획 | `docs/roadmap/phase-*.md` + 구현 코드 |

## 주의 (아카이브 문서의 함정)

- `work/DAR-134-*.md` §7의 omit 기각 논리는 이후 **DAR-321에서 부분 번복**됨 — 현행 정책 근거로 인용 금지(정본: `bucket-renormalization.ts` 인라인 주석).
- `work/m2/qa-report.md` MINOR-3(배당 HYBRID 미분류)는 **미수정 known-gap** — `harness/KNOWN_FAILURES.md`로 승계 기록됨.
- `roadmap/m10-graduation-report.md`의 DAR-68 확장 게이트표(G6 MDD/G7 alpha)는 현행 `integration-regression.ts`가 재현하지 못함(G6가 'AI 금지영역'으로 재정의됨) — 재실행 전 게이트 행 재반영 여부 확인.
