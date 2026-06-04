# 워크플로 규약

## 브랜치/PR
- 작업 단위 = GitHub Issue 1건.
- 브랜치: feat/<issue-id>-<slug>, origin/main 기준 worktree.
- 작업 완료 시 gh pr create. PR 본문에 검증 증거 첨부.

## worktree
- 생성: git worktree add ../wt-<issue-id> -b feat/<issue-id>-<slug> origin/main
- 제거: git worktree remove ../wt-<issue-id>
- 주 작업 디렉터리 브랜치 변경 금지.

## 통지
- PR 생성 후 Orchestrator에 issue-id, PR URL, 검증 통과 여부 보고.

## 개입 기록
- 인간 개입이 발생하면 무엇을·왜를 PR 코멘트에 기록.
