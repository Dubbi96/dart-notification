# 프로젝트 일시중단 핸드오프 (2026-06-28)

> 로컬 PC 개발을 일시중단하고 **OCI prod가 데이터를 계속 축적**하도록 둔 상태. 재개 시 이 문서대로 복원하면 중단 지점에서 이어서 진행 가능.

## 1. 코드/이슈 상태 (전부 GitHub에 보존됨)

- **main = `edf00b2d`** (origin/main 동기화 완료). 로컬 미커밋 없음(예외: `.claude/settings.local.json` = 로컬 env, 커밋 안 함).
- **2차 UX HARVEST 완료**: DAR-452~468 + 470 = 18 PR(#406~#423) 상호평가(18/18 PASS)·머지 완료, 이슈 done 처리.
- **미머지 오픈 PR (재개 시 처리)**:
  | PR | 브랜치 | 내용 | 상태 |
  |---|---|---|---|
  | #424 | feat/DAR-471-collapsed-section-query-gating | 접이식 섹션 지연로딩(enabled 게이팅) | 플릿 완료·in_review |
  | #425 | feat/DAR-472-ux-2nd-review-nits | UX 2차 합의 폴리시 묶음(a11y라벨·아이콘토큰·DRY·useCallback) | 플릿 완료·in_review |
  | #388 | feat/DAR-443-kakao-callback-302-redirect | (구건) | 오픈 |
  | #389 | feat/DAR-444-intraday-exit-guardrail | (구건) | 오픈 |
- 재개 첫 작업: #424/#425를 **2-에이전트 상호평가 → 머지 → 재배포** 절차로 마무리.

## 2. OCI prod (중단 중에도 계속 가동)

- 공개 엔드포인트: `https://168.138.198.152.nip.io/api` (`/api`는 라우트 없어 404, `/api/disclosures` 등 개별 라우트 정상)
- 최신 배포: 공시온 v1.0.0 (UI 18건 반영, commit `1836bd1b` 기준 APK 배포). 백엔드 prod 라이브.
- **데이터 신선도 점검 결과(중단 시점)**: OCI 최신 공시 `rcpDt=20260626` — 로컬(20260619 정체)보다 최신 → OCI가 라이브 source-of-truth.
- 🟡 **재개 시 점검**: OCI가 당일치(오늘 날짜) 공시를 수집 중인지 `/api/disclosures?limit=1` 최신 rcpDt로 확인. 1일 이상 정체면 OCI 수집 cron 점검 필요.

## 3. 로컬 DB 백업 (검증 완료 — 복원 가능 증명됨)

- **백업 파일**: `/Users/gangjong-won/Dubbi/dart-db-backups/dart_notification_2026-06-27.dump` (430MB, pg_dump 커스텀 포맷 `-Fc`)
- **검증**: 임시 DB 테스트 복원 후 전 테이블 행수 정확히 일치(disclosures 2,567,042 / stock_daily_prices 8,568,099 / trading_signals 89,754 / disclosure_documents 2,321,624 / disclosure_events 156,632), 복원 에러 0.
- raw 문서/rawtext는 별도로 S3 오프로드 완료(DAR-395/399).
- 로컬 docker 볼륨(`postgres_data` 4.2GB, `redis_data`)은 `down -v`로 회수됨 → **데이터는 위 덤프로만 존재**. 덤프 파일 절대 삭제 금지.

### DB 복원 절차 (TimescaleDB — pre/post_restore 필수)
```bash
cd /Users/gangjong-won/Dubbi/dart-notification
# 1. 빈 DB 스택 기동 (백엔드 마이그레이션 실행 전 — 테이블 비어 있어야 함)
docker compose -f docker-compose.dev.yml up -d
sleep 8   # db healthy 대기
# 2. timescaledb 확장 + pre_restore
docker exec dart-notification-db psql -U postgres -d dart_notification -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker exec dart-notification-db psql -U postgres -d dart_notification -c "SELECT timescaledb_pre_restore();"
# 3. 덤프 복원
docker cp dart-db-backups/dart_notification_2026-06-27.dump dart-notification-db:/tmp/restore.dump
docker exec dart-notification-db pg_restore -U postgres -d dart_notification --no-owner --no-privileges /tmp/restore.dump
# 4. post_restore
docker exec dart-notification-db psql -U postgres -d dart_notification -c "SELECT timescaledb_post_restore();"
```
> 주의: `docker compose up` 후 NestJS 백엔드를 먼저 띄우면 Prisma 마이그레이션이 빈 테이블을 만들어 복원과 충돌할 수 있음 → **복원을 먼저** 하고 백엔드 기동.

## 4. 중지된 서비스 / 재기동

| 서비스 | 중지 방법(수행됨) | 재기동 |
|---|---|---|
| 로컬 dev DB/redis (docker) | `docker compose -f docker-compose.dev.yml down -v` (볼륨 회수) | `up -d` + 위 복원 절차 |
| Paperclip 플릿 | `pnpm dev:stop` + 임베디드 PG clean shutdown(SIGINT) | `cd rubberducksim-agents/paperclip && pnpm dev` |
| NestJS BE / Expo | (원래 미가동) | `cd backend && npm run start:dev` / `cd mobile && npx expo start` |

- Paperclip 임베디드 PG는 clean 종료(postmaster.pid 제거됨) → `pnpm dev` 재기동 시 자동 복구. 오케스트레이션 상태(이슈/에이전트)는 `~/.paperclip/instances/default/db`에 보존.
- launchd `com.paperclip.pr-state-monitor`는 사용자 전역 설정이라 건드리지 않음.

## 5. 정리된 디스크 (전부 재생성 가능)

- worktree 73개(`wt-DAR-*`) `git worktree remove` — 브랜치 refs는 origin/로컬에 보존, 재개 시 플릿이 재생성.
- `_nm_broken_quarantine` (108MB, 깨진 node_modules) 삭제.
- docker 빌드캐시 prune(1.39GB). **prod 이미지 `dart-notification-backend:prod`(350MB)는 보존**(다음 배포용).
- 총 회수 ≈ 11GB+ (DB볼륨 ~8.9GB + worktree ~1GB + quarantine + 빌드캐시).

## 6. 재개 체크리스트

1. `docker compose -f docker-compose.dev.yml up -d` → §3 DB 복원
2. (필요 시) `cd backend && npm run start:dev`, `cd mobile && npx expo start`
3. `cd rubberducksim-agents/paperclip && pnpm dev` (플릿 재기동)
4. OCI 데이터 신선도 점검(§2 🟡)
5. PR #424/#425(DAR-471/472) 상호평가→머지→재배포
6. OCI 축적 데이터 기준으로 추가 개발 착수
