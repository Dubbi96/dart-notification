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

## 배포 접속 (OCI 프로덕션) — SSH 키 경로 메모
- **SSH 키**: `~/.ssh/oci_instance` (2026-06-23 생성, 공개키 `~/.ssh/oci_instance.pub`).
- **접속**: `ssh -i ~/.ssh/oci_instance ubuntu@<공인IP>`  (사용자 = `ubuntu`).
  - ⚠️ `-i ~/.ssh/oci_instance` 없이 `ssh ubuntu@...` 하면 `Permission denied (publickey)` — 기본 키로는 안 됨.
- **호스트(2-micro 운영)**: micro1 앱 = `168.138.198.152` (공개), micro2 DB = 사설 `10.0.1.151:5432`.
  - 예: `ssh -i ~/.ssh/oci_instance ubuntu@168.138.198.152`
- **참고**: ARM A1(상위 무료) 확보 루프 `scripts/oci-arm-a1-retry.sh`도 동일 키(`~/.ssh/oci_instance`) 사용. 확보 성공 시 새 공인IP로 동일 방식 접속.
- ⚠️ OCI 프로덕션 배포·`prisma migrate deploy`는 **휴먼 승인(자동승인 차단)** 대상 — 실행 전 사용자 확인.
